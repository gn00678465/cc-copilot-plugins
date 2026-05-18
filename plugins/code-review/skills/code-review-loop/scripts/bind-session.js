#!/usr/bin/env node

'use strict';

/**
 * UserPromptExpansion hook for /code-review-loop and /continue-loop.
 *
 * Fires when the user types ANY slash command. We filter internally on
 * `command_name` and only write a sidecar when one of our two slash
 * commands triggers. The sidecar carries the activating session_id to
 * the slash-command body so the loop can be bound at activation time
 * (not race-claimed on the first Stop event).
 *
 * Best-effort: missing session_id or write failure exits 0 silently so a
 * malfunctioning binder never blocks a slash command.
 */

const fs = require('fs');
const path = require('path');

const SIDECAR_REL = path.join('.claude', 'code-review.pending-session.txt');

// Both bare and plugin-prefixed forms are accepted because Claude Code's
// command_name format varies by host version. Other-plugin namespaces are
// intentionally excluded so a same-named skill elsewhere can't bind us.
const TARGETED_COMMANDS = new Set([
  'code-review-loop',
  'code-review:code-review-loop',
  'continue-loop',
  'code-review:continue-loop',
]);

function readHookInput() {
  try {
    const raw = fs.readFileSync(0, 'utf8').trim();
    return raw ? JSON.parse(raw) : {};
  } catch (_) { return {}; }
}

function main() {
  const input = readHookInput();
  const sessionId = typeof input.session_id === 'string' ? input.session_id : '';
  const cwd = typeof input.cwd === 'string' && input.cwd ? input.cwd : process.cwd();
  const commandName = typeof input.command_name === 'string' ? input.command_name : '';

  if (!TARGETED_COMMANDS.has(commandName)) return;
  if (!sessionId) return;

  const sidecar = path.join(cwd, SIDECAR_REL);
  try {
    fs.mkdirSync(path.dirname(sidecar), { recursive: true });
    fs.writeFileSync(sidecar, sessionId, 'utf8');
  } catch (err) {
    process.stderr.write(
      `[code-review] bind-session: failed to write sidecar (${err.message}); ` +
      `falling back to claim-on-first-stop.\n`
    );
  }
}

main();
