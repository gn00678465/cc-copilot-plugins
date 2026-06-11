'use strict';

/**
 * Shared iteration helpers for the code-review loop.
 *
 * Consumed by session-stop.js (iteration 2+) and continue.js (manual resume).
 * State I/O, git snapshot, reviewer invocation, and prompt composition all
 * live here so both entry points behave identically.
 */

const fs = require('fs');
const path = require('path');
const { execSync, execFileSync } = require('child_process');

const {
  composeIterationPrompt,
  buildIterationReason,
} = require('./prompts.js');

// ---------------------------------------------------------------------------
// Approval detection
// ---------------------------------------------------------------------------

const APPROVAL_LINE_PATTERN = /^<promise>APPROVAL<\/promise>$/;

function hasApprovalInReport(text) {
  if (typeof text !== 'string' || !text.trim()) return false;
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  let i = lines.length - 1;
  while (i >= 0 && lines[i].trim() === '') i--;
  return i >= 0 && APPROVAL_LINE_PATTERN.test(lines[i]);
}

// ---------------------------------------------------------------------------
// Git helpers
// ---------------------------------------------------------------------------

function gitStashCreate(cwd) {
  try {
    return execSync('git stash create', { cwd, encoding: 'utf8' }).trim();
  } catch (_) { return ''; }
}

function gitHeadCommit(cwd) {
  try {
    return execSync('git rev-parse HEAD', { cwd, encoding: 'utf8' }).trim();
  } catch (_) { return ''; }
}

// Tree-hash via `git show -s --format=%T` is Windows-safe.
// `git rev-parse <sha>^{tree}` triggers cmd.exe caret-escape on Git-for-Windows
// shims and silently breaks; this form has no shell metacharacters.
function gitTreeHash(ref, cwd) {
  if (!ref) return '';
  try {
    return execFileSync(
      'git',
      ['show', '-s', '--format=%T', ref],
      { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
    ).trim();
  } catch (_) { return ''; }
}

// ---------------------------------------------------------------------------
// Workspace / path resolution
// ---------------------------------------------------------------------------

function resolveWorkspaceRoot(cwd) { return cwd || process.cwd(); }
function resolveStateFile(root, dotDir) { return path.join(root, dotDir, 'code-review.local.md'); }
function resolveReportFile(root, dotDir) { return path.join(root, dotDir, 'code-review.last-report.md'); }

// ---------------------------------------------------------------------------
// Pending-session sidecar
//
// UserPromptExpansion hook writes the activating session_id to
// .claude/code-review.pending-session.txt before reviewer.js / continue.js
// runs. The body consumes (read + unlink) it once and records the id into
// state so the Stop hook can later enforce session isolation.
// ---------------------------------------------------------------------------

const PENDING_SESSION_REL = path.join('.claude', 'code-review.pending-session.txt');

function resolvePendingSessionFile(root) {
  return path.join(root, PENDING_SESSION_REL);
}

function consumePendingSessionId(root) {
  const file = resolvePendingSessionFile(root);
  try {
    const raw = fs.readFileSync(file, 'utf8').trim();
    fs.unlinkSync(file);
    return raw || null;
  } catch (_) { return null; }
}

// ---------------------------------------------------------------------------
// Atomic file I/O
//
// Both state and report files use tmp+rename. The report file is the
// critical one: the writer/fixer reads it mid-loop, and the previous
// implementation could expose partial content if the reviewer (running
// with --allow-all-tools) wrote to it directly before the script's
// final overwrite. Atomic rename guarantees readers only see the
// fully-captured stdout.
// ---------------------------------------------------------------------------

function atomicWrite(filePath, contents) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${filePath}.tmp.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}`;
  try {
    fs.writeFileSync(tmp, contents, 'utf8');
    fs.renameSync(tmp, filePath);
  } catch (err) {
    try { fs.unlinkSync(tmp); } catch (_) {}
    throw err;
  }
}

function readReportFile(reportFile) {
  try { return fs.readFileSync(reportFile, 'utf8'); }
  catch (_) { return ''; }
}

function writeReportFile(reportFile, text) {
  try { atomicWrite(reportFile, text ?? ''); }
  catch (err) {
    process.stderr.write(
      `⚠️  Code review loop: failed to persist reviewer report: ${err.message}\n`
    );
  }
}

function clearReportFile(reportFile) {
  try { fs.unlinkSync(reportFile); } catch (_) {}
}

// ---------------------------------------------------------------------------
// State frontmatter parse / serialise
// ---------------------------------------------------------------------------

function parseFrontmatter(raw) {
  const lines = raw.split('\n');
  if (lines[0].trim() !== '---') return { state: {} };
  const closeIdx = lines.findIndex((l, i) => i > 0 && l.trim() === '---');
  if (closeIdx === -1) return { state: {} };

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
  return { state };
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
  return parseFrontmatter(fs.readFileSync(stateFile, 'utf8')).state;
}

function saveState(stateFile, state) {
  atomicWrite(stateFile, serializeFrontmatter(state));
}

function clearState(stateFile) {
  try { fs.unlinkSync(stateFile); } catch (_) {}
}

// ---------------------------------------------------------------------------
// Incremental diff range
//
// Returns { base, head } for the next iteration. Preference order:
//   1. Working-tree snapshot via `git stash create` (uncommitted fixes).
//   2. Current HEAD if it has advanced since last iteration (writer committed).
//   3. Nothing new → { reason: 'no-diff' }.
//
// Stash-to-stash empty diff guard: when prevRef and the new stash share the
// same tree hash, the writer didn't actually change anything. Drop to no-diff
// so we don't run a pointless reviewer pass.
// ---------------------------------------------------------------------------

function computeNextRange(state, root) {
  const prevRef = (typeof state.head_sha === 'string' && state.head_sha)
    ? state.head_sha
    : (typeof state.initial_head === 'string' && state.initial_head)
    ? state.initial_head
    : null;

  const snapshot = gitStashCreate(root);
  if (snapshot) {
    if (prevRef) {
      const prevTree = gitTreeHash(prevRef, root);
      const newTree = gitTreeHash(snapshot, root);
      if (prevTree && newTree && prevTree === newTree) {
        return { base: null, head: null, reason: 'no-diff' };
      }
    }
    return { base: prevRef || gitHeadCommit(root), head: snapshot };
  }

  const currentHead = gitHeadCommit(root);
  if (currentHead && prevRef && currentHead !== prevRef) {
    return { base: prevRef, head: currentHead };
  }

  return { base: null, head: null, reason: 'no-diff' };
}

// ---------------------------------------------------------------------------
// Reviewer invocation
// ---------------------------------------------------------------------------

const DEFAULT_REVIEWER_MODEL = 'gpt-5.4';

function invokeReviewer({ workspaceRoot, model, prompt }) {
  const copilotScript = path.resolve(__dirname, 'copilot.js');
  try {
    const out = execFileSync(
      process.execPath,
      [copilotScript, '--prompt', prompt, '--model', model || DEFAULT_REVIEWER_MODEL],
      {
        cwd: workspaceRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        maxBuffer: 20 * 1024 * 1024,
      }
    );
    return (out || '').trim();
  } catch (err) {
    process.stderr.write(
      `⚠️  Code review loop: Copilot reviewer invocation failed: ${err.message}\n`
    );
    return null;
  }
}

module.exports = {
  APPROVAL_LINE_PATTERN,
  DEFAULT_REVIEWER_MODEL,
  hasApprovalInReport,
  gitStashCreate,
  gitHeadCommit,
  gitTreeHash,
  resolveWorkspaceRoot,
  resolveStateFile,
  resolveReportFile,
  resolvePendingSessionFile,
  consumePendingSessionId,
  readReportFile,
  writeReportFile,
  clearReportFile,
  parseFrontmatter,
  serializeFrontmatter,
  loadState,
  saveState,
  clearState,
  computeNextRange,
  invokeReviewer,
  composeIterationPrompt,
  buildIterationReason,
};
