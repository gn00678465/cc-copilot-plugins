'use strict';

/**
 * Shared iteration helpers for the code-review loop.
 *
 * Consumed by session-stop.js (iteration 2+ from Stop hook) and continue.js
 * (manual resume via /continue-loop). Extracted so both entry points use the
 * same state I/O, git snapshot, and reviewer-invocation semantics.
 */

const fs = require('fs');
const path = require('path');
const { execSync, execFileSync } = require('child_process');

// ---------------------------------------------------------------------------
// Approval detection
// ---------------------------------------------------------------------------

const APPROVAL_LINE_PATTERN = /^\s*<promise>\s*APPROVAL\s*<\/promise>\s*$/i;

function hasApprovalInReport(text) {
  if (typeof text !== 'string' || !text.trim()) return false;
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  let i = lines.length - 1;
  while (i >= 0 && lines[i].trim() === '') i--;
  if (i < 0) return false;
  return APPROVAL_LINE_PATTERN.test(lines[i]);
}

// ---------------------------------------------------------------------------
// Git helpers
// ---------------------------------------------------------------------------

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
// Workspace / path resolution
// ---------------------------------------------------------------------------

function resolveWorkspaceRoot(cwd) {
  return cwd || process.cwd();
}

function resolveStateFile(workspaceRoot, dotDir) {
  return path.join(workspaceRoot, dotDir, 'code-review.local.md');
}

function resolveReportFile(workspaceRoot, dotDir) {
  return path.join(workspaceRoot, dotDir, 'code-review.last-report.md');
}

// ---------------------------------------------------------------------------
// Report file I/O
// ---------------------------------------------------------------------------

function readReportFile(reportFile) {
  try {
    return fs.readFileSync(reportFile, 'utf8');
  } catch (_) {
    return '';
  }
}

function writeReportFile(reportFile, text) {
  try {
    fs.writeFileSync(reportFile, text ?? '', 'utf8');
  } catch (err) {
    process.stderr.write(
      `⚠️  Code review loop: failed to persist reviewer report: ${err.message}\n`
    );
  }
}

function clearReportFile(reportFile) {
  try { fs.unlinkSync(reportFile); } catch (_) {}
}

// ---------------------------------------------------------------------------
// State frontmatter parse / serialize
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
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  APPROVAL_LINE_PATTERN,
  hasApprovalInReport,
  gitStashCreate,
  gitHeadCommit,
  resolveWorkspaceRoot,
  resolveStateFile,
  resolveReportFile,
  readReportFile,
  writeReportFile,
  clearReportFile,
  parseFrontmatter,
  serializeFrontmatter,
  loadState,
  saveState,
  clearState,
};
