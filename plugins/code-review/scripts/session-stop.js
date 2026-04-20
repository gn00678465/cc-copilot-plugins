#!/usr/bin/env node

'use strict';

/**
 * Code Review Stop Hook
 *
 * Runs when Claude Code tries to exit. Checks if a review loop is active,
 * evaluates whether the Reviewer has issued "> **Approval**", and either
 * allows the session to end or blocks the exit with a continuation prompt.
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

// Matches the exact Approval format from code-review-master agent: > **Approval**
const APPROVAL_PATTERN = /(?:^|\n)\s*>\s*\*\*Approval\*\*\s*$/;

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
  return path.join(workspaceRoot, dotDir, 'review-state.json');
}

// ---------------------------------------------------------------------------
// State I/O
// ---------------------------------------------------------------------------

function loadState(stateFile) {
  const raw = fs.readFileSync(stateFile, 'utf8');
  return JSON.parse(raw);
}

function saveState(stateFile, state) {
  const uniqueSuffix = Date.now() + Math.random().toString(36).slice(2);
  const tmpPath = `${stateFile}.tmp.${uniqueSuffix}`;
  try {
    fs.writeFileSync(tmpPath, JSON.stringify(state, null, 2) + '\n', 'utf8');
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
// Transcript parsing
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
    process.stderr.write(`\u26A0\uFE0F  Code review loop: Failed to parse state file: ${err.message}\n`);
    clearState(stateFile);
    return;
  }

  if (!state.active) return;

  const iteration = typeof state.iteration === 'number' ? state.iteration : 0;
  const maxIterations = typeof state.max_iterations === 'number' ? state.max_iterations : 0;

  if (maxIterations > 0 && iteration >= maxIterations) {
    process.stdout.write('\uD83D\uDED1 Code review loop: Max iterations reached.\n');
    clearState(stateFile);
    return;
  }

  const rawTranscriptPath = input.transcript_path || '';
  if (!rawTranscriptPath) {
    process.stderr.write('\u26A0\uFE0F  Code review loop: No transcript_path in hook input. Stopping.\n');
    clearState(stateFile);
    return;
  }

  const transcriptPath = path.resolve(expandTilde(rawTranscriptPath));
  if (!fs.existsSync(transcriptPath)) {
    process.stderr.write(`\u26A0\uFE0F  Code review loop: Transcript not found: ${transcriptPath}. Stopping.\n`);
    clearState(stateFile);
    return;
  }

  let lastAssistantText;
  try {
    lastAssistantText = extractLastAssistantText(transcriptPath);
  } catch (err) {
    process.stderr.write(`\u26A0\uFE0F  Code review loop: ${err.message}. Stopping.\n`);
    clearState(stateFile);
    return;
  }

  if (APPROVAL_PATTERN.test(lastAssistantText)) {
    process.stdout.write('\u2705 Code review loop: Approval detected. Session complete.\n');
    clearState(stateFile);
    return;
  }

  // Not approved — increment iteration and block the stop
  const nextIteration = iteration + 1;
  saveState(stateFile, { ...state, iteration: nextIteration });

  process.stdout.write(
    JSON.stringify({
      decision: 'block',
      reason: state.prompt ?? '',
      systemMessage:
        `\uD83D\uDD04 Code Review iteration ${nextIteration} | Reviewer has not yet issued Approval. ` +
        'Continue addressing feedback.',
    }, null, 2) + '\n'
  );
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
