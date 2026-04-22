#!/usr/bin/env node

'use strict';

/**
 * Code Review Stop Hook
 *
 * Runs when Claude Code tries to exit. Checks if a review loop is active,
 * evaluates whether the Reviewer has issued <promise>APPROVAL</promise>, and
 * either allows the session to end or blocks the exit with a continuation prompt.
 *
 * Hook input (stdin): {
 *   "transcript_path": "/path/to/transcript.jsonl",
 *   "cwd": "/path/to/project",
 *   "last_assistant_message": "...",
 *   ...
 * }
 * Hook output (stdout): JSON block decision, or empty to allow exit.
 *
 * Usage: node session-stop.js [claude|copilot]   (default: claude)
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Matches <promise>APPROVAL</promise> emitted by the agent to signal completion
const APPROVAL_PATTERN = /<promise>\s*APPROVAL\s*<\/promise>/i;

// ---------------------------------------------------------------------------
// Git helpers
// ---------------------------------------------------------------------------

const { execSync } = require('child_process');

function gitStashCreate(cwd) {
  try {
    return execSync('git stash create', { cwd, encoding: 'utf8' }).trim();
  } catch (_) {
    return '';
  }
}

function gitHeadCommit(cwd) {
  try {
    return execSync('git rev-parse HEAD', { cwd, encoding: 'utf8' }).trim();
  } catch (_) {
    return '';
  }
}

// ---------------------------------------------------------------------------
// Hook input
// ---------------------------------------------------------------------------

function readHookInput() {
  const raw = fs.readFileSync(0, 'utf8').trim();
  if (!raw) return {};
  return JSON.parse(raw);
}

// ---------------------------------------------------------------------------
// Workspace / state resolution
// ---------------------------------------------------------------------------

function resolveWorkspaceRoot(cwd) {
  return cwd || process.cwd();
}

function resolveStateFile(workspaceRoot, dotDir) {
  return path.join(workspaceRoot, dotDir, 'code-review.local.md');
}

// ---------------------------------------------------------------------------
// State I/O
// ---------------------------------------------------------------------------

function parseFrontmatter(raw) {
  const lines = raw.split('\n');
  if (lines[0].trim() !== '---') return { state: {}, body: raw };

  const closeIdx = lines.findIndex((l, i) => i > 0 && l.trim() === '---');
  if (closeIdx === -1) return { state: {}, body: raw };

  const state = {};
  for (const line of lines.slice(1, closeIdx)) {
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim();
    let val = line.slice(colon + 1).trim();
    if (val === 'true') state[key] = true;
    else if (val === 'false') state[key] = false;
    else if (val === 'null' || val === '~' || val === '') state[key] = null;
    else if (/^-?\d+$/.test(val)) state[key] = parseInt(val, 10);
    else state[key] = val.replace(/^["']|["']$/g, '');
  }

  const body = lines.slice(closeIdx + 1).join('\n').trim();
  if (body) state.prompt = body;
  return { state, body };
}

function serializeFrontmatter(state) {
  const { prompt, ...fields } = state;
  const lines = ['---'];
  for (const [k, v] of Object.entries(fields)) {
    if (v === null) lines.push(`${k}: null`);
    else if (typeof v === 'string') lines.push(`${k}: "${v}"`);
    else lines.push(`${k}: ${v}`);
  }
  lines.push('---', '', prompt ?? '', '');
  return lines.join('\n');
}

function loadState(stateFile) {
  const raw = fs.readFileSync(stateFile, 'utf8');
  return parseFrontmatter(raw).state;
}

function saveState(stateFile, state) {
  const uniqueSuffix = Date.now() + Math.random().toString(36).slice(2);
  const tmpPath = `${stateFile}.tmp.${uniqueSuffix}`;
  try {
    fs.writeFileSync(tmpPath, serializeFrontmatter(state), 'utf8');
    fs.renameSync(tmpPath, stateFile);
  } catch (err) {
    try { fs.unlinkSync(tmpPath); } catch (_) {}
    throw err;
  }
}

function clearState(stateFile) {
  try { fs.unlinkSync(stateFile); } catch (_) {}
}

// ---------------------------------------------------------------------------
// Transcript parsing (fallback when last_assistant_message is unavailable)
// ---------------------------------------------------------------------------

function parseJsonl(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  return raw.split('\n')
    .filter((line) => line.trim())
    .flatMap((line) => {
      try { return [JSON.parse(line)]; } catch (_) { return []; }
    });
}

function extractLastAssistantText(transcriptPath) {
  const entries = parseJsonl(transcriptPath);
  const assistantEntries = entries.filter((e) => e && e.role === 'assistant');

  if (assistantEntries.length === 0) {
    throw new Error('No assistant messages found in transcript');
  }

  const last = assistantEntries[assistantEntries.length - 1];
  const content = (last.message && Array.isArray(last.message.content))
    ? last.message.content
    : [];

  const text = content
    .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('\n');

  if (!text) {
    throw new Error('Assistant message contained no text content');
  }
  return text;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function expandTilde(filePath) {
  if (filePath.startsWith('~/') || filePath === '~') {
    return path.join(os.homedir(), filePath.slice(1));
  }
  return filePath;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const mode = (process.argv[2] === 'copilot') ? 'copilot' : 'claude';
  const dotDir = `.${mode}`; // '.claude' or '.copilot'

  const input = readHookInput();
  const workspaceRoot = resolveWorkspaceRoot(input.cwd);
  const stateFile = resolveStateFile(workspaceRoot, dotDir);

  if (!fs.existsSync(stateFile)) {
    return; // No active review loop — allow exit silently
  }

  let state;
  try {
    state = loadState(stateFile);
  } catch (err) {
    process.stderr.write(`⚠️  Code review loop: Failed to parse state file: ${err.message}\n`);
    clearState(stateFile);
    return;
  }

  if (!state.active) return;

  const iteration = typeof state.iteration === 'number' ? state.iteration : 0;
  const maxIterations = typeof state.max_iterations === 'number' ? state.max_iterations : 0;

  if (maxIterations > 0 && iteration >= maxIterations) {
    process.stdout.write('🛑 Code review loop: Max iterations reached.\n');
    clearState(stateFile);
    return;
  }

  // Resolve last assistant text: prefer direct hook field, fall back to transcript.
  // Transcript errors are non-fatal — treat as not-approved and continue loop.
  let lastAssistantText = '';

  if (typeof input.last_assistant_message === 'string' && input.last_assistant_message.trim()) {
    lastAssistantText = input.last_assistant_message;
  } else {
    const rawTranscriptPath = input.transcript_path || '';
    if (rawTranscriptPath) {
      const transcriptPath = path.resolve(expandTilde(rawTranscriptPath));
      if (fs.existsSync(transcriptPath)) {
        try {
          lastAssistantText = extractLastAssistantText(transcriptPath);
        } catch (_) {
          // Transcript unreadable — treat as not-approved and continue loop
        }
      }
    }
  }

  if (lastAssistantText && APPROVAL_PATTERN.test(lastAssistantText)) {
    process.stdout.write('✅ Code review loop: Approval detected. Session complete.\n');
    clearState(stateFile);
    return;
  }

  // Not approved — snapshot working tree, roll sliding window, block the stop

  // 1) Snapshot current working tree.
  //    If working tree is clean (stash create returns empty), check whether HEAD
  //    moved since the last iteration — the agent may have committed their changes.
  let snapshot = gitStashCreate(workspaceRoot);

  if (!snapshot) {
    const currentHead = gitHeadCommit(workspaceRoot);
    const prevRef = (typeof state.head_sha === 'string' && state.head_sha)
      ? state.head_sha
      : (typeof state.initial_head === 'string' && state.initial_head)
      ? state.initial_head
      : null;

    if (currentHead && prevRef && currentHead !== prevRef) {
      // Agent committed changes — use HEAD as the snapshot reference
      snapshot = currentHead;
    } else {
      process.stderr.write(
        '⚠️  Code review loop: No changes detected ' +
        '(working tree clean, HEAD unchanged). Stopping.\n'
      );
      clearState(stateFile);
      return;
    }
  }

  // 2) Sliding window: base = previous head_sha (or HEAD commit on first rotation),
  //    head = new snapshot
  const prevHead = (typeof state.head_sha === 'string' && state.head_sha)
    ? state.head_sha
    : null;
  const newBase = prevHead ?? gitHeadCommit(workspaceRoot);
  const newHead = snapshot;

  if (!newBase) {
    process.stderr.write(
      '⚠️  Code review loop: Unable to resolve base_revision ' +
      '(no HEAD commit). Aborting loop.\n'
    );
    clearState(stateFile);
    return;
  }

  // 3) Persist updated state
  const nextIteration = iteration + 1;
  saveState(stateFile, {
    ...state,
    iteration: nextIteration,
    base_revision: newBase,
    head_sha: newHead,
  });

  // 4) Replace prompt with range instruction for the next round
  const rangePrompt =
    `Review the incremental changes in this git range: ` +
    `\`${newBase}..${newHead}\`.\n\n` +
    `Run \`git diff ${newBase}..${newHead}\` to see exactly what changed ` +
    `since the previous review iteration. Apply the same multi-axis ` +
    `review (correctness / quality / security / performance) focused ` +
    `ONLY on these changes.`;

  process.stdout.write(
    JSON.stringify({
      decision: 'block',
      reason: rangePrompt,
      systemMessage:
        `🔄 Code Review iteration ${nextIteration} | ` +
        `Range: ${newBase.slice(0, 7)}..${newHead.slice(0, 7)}`,
    }, null, 2) + '\n'
  );
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
