#!/usr/bin/env node

'use strict';

/**
 * UserPromptExpansion hook for /code-review-loop and /continue-loop.
 *
 * Fires when the user types ANY slash command (the plugin-level hook is
 * registered without a matcher in hooks/hooks.json so we don't depend on
 * the host's matcher semantics). This script then filters internally on
 * `command_name` and only writes a sidecar for the two slash commands
 * that actually need session binding.
 *
 * Reads the hook input on stdin (carries `session_id`, `cwd`,
 * `command_name`), writes the session_id to a sidecar file under the
 * workspace's .claude/ directory. The slash command's body
 * (reviewer.js or continue.js) reads the sidecar at startup via the
 * shared helper consumePendingSessionId in iterate.js, records the
 * session_id into state, and deletes the sidecar.
 *
 * Why a sidecar instead of writing state directly:
 *   - At hook firing time, neither reviewer.js nor continue.js has run
 *     yet, so the state file may not exist (reviewer.js path) or is in
 *     a state that shouldn't be mutated by an outside process
 *     (continue.js path). A sidecar is a clean, single-shot pickup
 *     channel that decouples hook timing from state lifecycle.
 *   - The sidecar is always under .claude/ regardless of --mode,
 *     because mode is unknown at hook time (it's a flag passed to
 *     reviewer.js). The downstream consumer reads from the same fixed
 *     path.
 *
 * Diagnostic: when CODE_REVIEW_DEBUG is set, writes a one-line trace to
 * .claude/code-review.bind-session.log on every invocation. This lets a
 * user verify whether the hook is actually firing — the log line is
 * appended whether or not we ended up writing the sidecar (e.g. because
 * the slash command wasn't ours, or session_id was missing).
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
const DEBUG_LOG_REL = path.join('.claude', 'code-review.bind-session.log');

// Slash commands that should claim the loop. Anything else is a no-op so
// the same plugin-level hook can be registered without a matcher.
const TARGETED_COMMANDS = new Set(['code-review-loop', 'continue-loop']);

function readHookInput() {
  try {
    const raw = fs.readFileSync(0, 'utf8').trim();
    if (!raw) return {};
    return JSON.parse(raw);
  } catch (_) {
    return {};
  }
}

function appendDebugLog(cwd, line) {
  if (!process.env.CODE_REVIEW_DEBUG) return;
  try {
    const logPath = path.join(cwd, DEBUG_LOG_REL);
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.appendFileSync(
      logPath,
      `[${new Date().toISOString()}] ${line}\n`,
      'utf8'
    );
  } catch (_) { /* best-effort */ }
}

function main() {
  const input = readHookInput();
  const sessionId = (typeof input.session_id === 'string' && input.session_id)
    ? input.session_id
    : null;
  const cwd = (typeof input.cwd === 'string' && input.cwd)
    ? input.cwd
    : process.cwd();
  const commandName = (typeof input.command_name === 'string')
    ? input.command_name
    : '';
  const expansionType = (typeof input.expansion_type === 'string')
    ? input.expansion_type
    : '';

  appendDebugLog(
    cwd,
    `fire expansion_type=${expansionType} command_name=${commandName} ` +
    `has_session=${!!sessionId}`
  );

  if (!TARGETED_COMMANDS.has(commandName)) {
    // Not our slash command. Stay out of the way.
    process.exit(0);
  }

  if (!sessionId) {
    // Targeted command but the host didn't supply session_id. Downstream
    // falls back to legacy claim-on-first-stop behavior.
    appendDebugLog(cwd, 'skip: no session_id in input');
    process.exit(0);
  }

  const sidecarPath = path.join(cwd, SIDECAR_REL);
  try {
    fs.mkdirSync(path.dirname(sidecarPath), { recursive: true });
    fs.writeFileSync(sidecarPath, sessionId, 'utf8');
    appendDebugLog(cwd, `wrote sidecar session_id=${sessionId}`);
  } catch (err) {
    // Best-effort. Don't block the slash command on a write failure.
    process.stderr.write(
      `[code-review] bind-session: failed to write sidecar (${err.message}); ` +
      `falling back to claim-on-first-stop.\n`
    );
    appendDebugLog(cwd, `ERROR write sidecar: ${err.message}`);
  }

  process.exit(0);
}

main();
