#!/usr/bin/env node

'use strict';

/**
 * UserPromptExpansion hook for /code-review-loop and /continue-loop.
 *
 * Fires when the user types one of those slash commands. Reads the hook
 * input on stdin (carries `session_id` and `cwd`), and writes the
 * session_id to a sidecar file under the workspace's .claude/ directory.
 * The slash command's body (reviewer.js or continue.js) reads the sidecar
 * at startup, records the session_id into state, and deletes the sidecar.
 *
 * Why a sidecar instead of writing state directly:
 *   - At hook firing time, neither reviewer.js nor continue.js has run
 *     yet, so the state file may not exist (reviewer.js path) or is in a
 *     state that shouldn't be mutated by an outside process (continue.js
 *     path). A sidecar is a clean, single-shot pickup channel that
 *     decouples hook timing from state lifecycle.
 *   - The sidecar is always under .claude/ regardless of --mode, because
 *     mode is unknown at hook time (it's a flag passed to reviewer.js).
 *     The downstream consumer reads from the same fixed path.
 *
 * The hook is best-effort: any failure (missing session_id, IO error)
 * exits 0 silently so a slash command invocation never gets blocked by
 * a malfunctioning binder. The downstream falls back to the existing
 * "claim on first Stop event" path when no sidecar is present, which
 * matches the pre-binding behavior.
 */

const fs = require('fs');
const path = require('path');

const SIDECAR_REL = path.join('.claude', 'code-review.pending-session.txt');

function readHookInput() {
  try {
    const raw = fs.readFileSync(0, 'utf8').trim();
    if (!raw) return {};
    return JSON.parse(raw);
  } catch (_) {
    return {};
  }
}

function main() {
  const input = readHookInput();
  const sessionId = (typeof input.session_id === 'string' && input.session_id)
    ? input.session_id
    : null;
  const cwd = (typeof input.cwd === 'string' && input.cwd)
    ? input.cwd
    : process.cwd();

  if (!sessionId) {
    // Nothing to bind. Exit silently — downstream falls back to legacy
    // claim-on-first-stop behavior.
    process.exit(0);
  }

  const sidecarPath = path.join(cwd, SIDECAR_REL);
  try {
    fs.mkdirSync(path.dirname(sidecarPath), { recursive: true });
    fs.writeFileSync(sidecarPath, sessionId, 'utf8');
  } catch (err) {
    // Best-effort. Don't block the slash command on a write failure.
    process.stderr.write(
      `[code-review] bind-session: failed to write sidecar (${err.message}); ` +
      `falling back to claim-on-first-stop.\n`
    );
  }

  process.exit(0);
}

main();
