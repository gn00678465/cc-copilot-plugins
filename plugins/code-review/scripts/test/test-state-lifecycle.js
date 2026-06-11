#!/usr/bin/env node

'use strict';

/**
 * Smoke test: verifies state-clearing lifecycle.
 *
 * Per docs/flow.md and the user's bug report:
 *   - APPROVAL in the reviewer report → state IS cleared.
 *   - Anything else (no-diff, max-iter, reviewer-fail, mid-iteration) → state is PRESERVED.
 *
 * Usage:
 *   node plugins/code-review/scripts/test/test-state-lifecycle.js
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const PLUGIN_ROOT = path.resolve(__dirname, '..', '..');
const STOP_HOOK = path.join(PLUGIN_ROOT, 'scripts', 'session-stop.js');

function tmpWorkspace() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'code-review-lifecycle-'));
  fs.mkdirSync(path.join(dir, '.git'), { recursive: true });
  fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
  return dir;
}

function writeState(workspace, overrides = {}) {
  const fields = {
    active: 'true',
    iteration: '1',
    max_iterations: '3',
    completion_promise: '"APPROVAL"',
    started_at: '"2026-05-18T00:00:00Z"',
    model: '"gpt-5.4"',
    mode: '"claude"',
    base_revision: 'null',
    head_sha: 'null',
    initial_head: 'null',
    session_id: '"sess-test"',
    ...overrides,
  };
  const state = [
    '---',
    ...Object.entries(fields).map(([k, v]) => `${k}: ${v}`),
    '---',
    '',
    'test prompt',
    '',
  ].join('\n');
  fs.writeFileSync(path.join(workspace, '.claude', 'code-review.local.md'), state, 'utf8');
}

function writeReport(workspace, body) {
  fs.writeFileSync(path.join(workspace, '.claude', 'code-review.last-report.md'), body, 'utf8');
}

function runStopHook(workspace) {
  return spawnSync(process.execPath, [STOP_HOOK, 'claude'], {
    cwd: workspace,
    input: JSON.stringify({ cwd: workspace, session_id: 'sess-test' }),
    encoding: 'utf8',
  });
}

function assert(label, condition) {
  if (!condition) { process.stderr.write(`❌ FAIL: ${label}\n`); process.exit(1); }
  process.stdout.write(`✅ ${label}\n`);
}

function exists(p) { try { fs.statSync(p); return true; } catch (_) { return false; } }

function main() {
  // Case 1: report ends with APPROVAL → state cleared.
  {
    const ws = tmpWorkspace();
    writeState(ws);
    writeReport(ws,
      'All looks good.\n\n<promise>APPROVAL</promise>\n'
    );
    const result = runStopHook(ws);
    const stateFile = path.join(ws, '.claude', 'code-review.local.md');
    const reportFile = path.join(ws, '.claude', 'code-review.last-report.md');
    assert('APPROVAL → state cleared', !exists(stateFile));
    assert('APPROVAL → report cleared', !exists(reportFile));
    assert('APPROVAL → stdout announces completion',
      /Session complete/.test(result.stdout));
    fs.rmSync(ws, { recursive: true, force: true });
  }

  // Case 2: report does NOT end with APPROVAL → state preserved.
  // (no real git, computeNextRange returns no-diff, hook returns without clearing)
  {
    const ws = tmpWorkspace();
    writeState(ws);
    writeReport(ws,
      'Critical: foo is broken.\n\n(no terminator here)\n'
    );
    const stateBefore = fs.readFileSync(
      path.join(ws, '.claude', 'code-review.local.md'),
      'utf8'
    );
    runStopHook(ws);
    const stateFile = path.join(ws, '.claude', 'code-review.local.md');
    assert('non-approval → state file still present', exists(stateFile));
    assert('non-approval → state file unchanged (no advance because no-diff)',
      fs.readFileSync(stateFile, 'utf8') === stateBefore);
    fs.rmSync(ws, { recursive: true, force: true });
  }

  // Case 3: prose mentions approval but tag is backticked → state preserved.
  {
    const ws = tmpWorkspace();
    writeState(ws);
    writeReport(ws,
      'Cannot say `<promise>APPROVAL</promise>` yet — please fix X.\n'
    );
    runStopHook(ws);
    assert('backticked terminator does NOT trigger approval',
      exists(path.join(ws, '.claude', 'code-review.local.md')));
    fs.rmSync(ws, { recursive: true, force: true });
  }

  // Case 4: max-iterations reached → state preserved.
  {
    const ws = tmpWorkspace();
    writeState(ws, { iteration: '3', max_iterations: '3' });
    writeReport(ws, 'Findings.\n');
    const result = runStopHook(ws);
    assert('max-iterations → state preserved',
      exists(path.join(ws, '.claude', 'code-review.local.md')));
    assert('max-iterations → stdout announces suspension',
      /Loop suspended/.test(result.stdout));
    fs.rmSync(ws, { recursive: true, force: true });
  }

  process.stdout.write('\n🎉 State lifecycle smoke test passed.\n');
}

main();
