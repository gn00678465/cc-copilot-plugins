#!/usr/bin/env node

'use strict';

/**
 * Smoke test: verifies session_id isolation in session-stop.js.
 *
 * Scenario: a code-review loop is bound to session_id "owner". A Stop
 * event from session_id "foreign" must NOT touch the state file or
 * invoke the reviewer.
 *
 * Usage:
 *   node plugins/code-review/scripts/test/test-session-isolation.js
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const PLUGIN_ROOT = path.resolve(__dirname, '..', '..');
const STOP_HOOK = path.join(PLUGIN_ROOT, 'scripts', 'session-stop.js');

function makeTmpWorkspace() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'code-review-isolation-'));
  fs.mkdirSync(path.join(dir, '.git'), { recursive: true });
  fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
  return dir;
}

function writeState(workspace, sessionId) {
  const state = [
    '---',
    'active: true',
    'iteration: 1',
    'max_iterations: 3',
    'completion_promise: "APPROVAL"',
    'started_at: "2026-05-18T00:00:00Z"',
    'model: "gpt-5.4"',
    'mode: "claude"',
    'base_revision: null',
    'head_sha: null',
    'initial_head: null',
    `session_id: "${sessionId}"`,
    '---',
    '',
    'test prompt',
    '',
  ].join('\n');
  const file = path.join(workspace, '.claude', 'code-review.local.md');
  fs.writeFileSync(file, state, 'utf8');
  return file;
}

function runStopHook(workspace, hookInput) {
  return spawnSync(process.execPath, [STOP_HOOK, 'claude'], {
    cwd: workspace,
    input: JSON.stringify(hookInput),
    encoding: 'utf8',
  });
}

function assert(label, condition) {
  if (!condition) {
    process.stderr.write(`❌ FAIL: ${label}\n`);
    process.exit(1);
  }
  process.stdout.write(`✅ ${label}\n`);
}

function main() {
  const workspace = makeTmpWorkspace();
  const stateFile = writeState(workspace, 'owner-session-xyz');
  const stateBefore = fs.readFileSync(stateFile, 'utf8');

  // Case 1: foreign session must NOT modify state.
  const foreignResult = runStopHook(workspace, {
    cwd: workspace,
    session_id: 'foreign-session-abc',
  });
  const stateAfterForeign = fs.readFileSync(stateFile, 'utf8');
  assert(
    'foreign session does not modify state file',
    stateAfterForeign === stateBefore
  );
  assert(
    'foreign session does not emit stdout (no decision block)',
    foreignResult.stdout.trim() === ''
  );

  // Case 2: anonymous Stop event against a bound loop must NOT modify state.
  const anonResult = runStopHook(workspace, { cwd: workspace });
  const stateAfterAnon = fs.readFileSync(stateFile, 'utf8');
  assert(
    'anonymous (no session_id) Stop event does not modify state',
    stateAfterAnon === stateBefore
  );
  assert(
    'anonymous Stop event does not emit stdout',
    anonResult.stdout.trim() === ''
  );

  // Case 3: unbound state + incoming session_id → state gets bound.
  const stateFile2 = path.join(workspace, '.claude', 'code-review.local.md');
  fs.writeFileSync(
    stateFile2,
    fs.readFileSync(stateFile2, 'utf8').replace(
      'session_id: "owner-session-xyz"',
      'session_id: null'
    ),
    'utf8'
  );
  // Note: this run also attempts to compute the diff range; with no real git
  // history it will fall through to no-diff and return without writing
  // anything except the session_id binding.
  runStopHook(workspace, {
    cwd: workspace,
    session_id: 'new-claimer-123',
  });
  const stateAfterClaim = fs.readFileSync(stateFile2, 'utf8');
  assert(
    'unbound state + Stop event with session_id binds the loop',
    /session_id: "new-claimer-123"/.test(stateAfterClaim)
  );

  // Cleanup
  fs.rmSync(workspace, { recursive: true, force: true });
  process.stdout.write('\n🎉 Session isolation smoke test passed.\n');
}

main();
