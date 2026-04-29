#!/usr/bin/env node

'use strict';

/**
 * Code Review Stop Hook
 *
 * Runs when Claude Code tries to exit. Checks if a review loop is active,
 * determines whether the Reviewer (Copilot CLI) has issued
 * <promise>APPROVAL</promise> on the final non-empty line of its persisted
 * report, and either allows the session to end or blocks the exit by
 * re-invoking the reviewer on the incremental diff.
 *
 * The writer/fixer session does NOT participate in the approval decision —
 * its last message is intentionally ignored. Only the reviewer's report
 * (code-review.last-report.md) can terminate the loop.
 *
 * State file lifecycle:
 *   code-review.local.md carries iteration state across Stop events. It is
 *   cleared ONLY on confirmed reviewer APPROVAL — the one moment the loop
 *   is genuinely ending. Every other outcome (max-iterations hit, no diff
 *   since last iteration, parse errors, unresolved base commit) preserves
 *   the state so the next iteration has a reference to resume from. Users
 *   can discard a stuck loop explicitly via /cancel-review.
 *
 * Hook input (stdin): {
 *   "cwd": "/path/to/project",
 *   ...
 * }
 * Hook output (stdout): JSON block decision, or empty to allow exit.
 *
 * Usage: node session-stop.js [claude|copilot]   (default: claude)
 */

const fs = require('fs');
const path = require('path');

const {
  DEFAULT_REVIEWER_MODEL,
  hasApprovalInReport,
  resolveWorkspaceRoot,
  resolveStateFile,
  resolveReportFile,
  readReportFile,
  writeReportFile,
  clearReportFile,
  loadState,
  saveState,
  clearState,
  computeNextRange,
  invokeReviewer,
  composeIterationPrompt,
} = require(
  path.resolve(__dirname, '..', 'skills', 'code-review-loop', 'scripts', 'iterate.js')
);

// ---------------------------------------------------------------------------
// Hook input
// ---------------------------------------------------------------------------

function readHookInput() {
  const raw = fs.readFileSync(0, 'utf8').trim();
  if (!raw) return {};
  return JSON.parse(raw);
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
  const reportFile = resolveReportFile(workspaceRoot, dotDir);

  if (!fs.existsSync(stateFile)) {
    return; // No active review loop — allow exit silently
  }

  let state;
  try {
    state = loadState(stateFile);
  } catch (err) {
    // State is corrupt but may represent user work in progress — DO NOT
    // auto-delete. Warn and let the user inspect or run /cancel-review.
    process.stderr.write(
      `⚠️  Code review loop: failed to parse .${mode}/code-review.local.md ` +
      `(${err.message}). The state file is corrupt — inspect it manually or ` +
      `run /cancel-review to discard it.\n`
    );
    return;
  }

  if (!state.active) return;

  // ---------------------------------------------------------------------
  // Session isolation
  //
  // The state file is project-level and shared across every Claude Code
  // session in the same workspace, but only ONE session is actually
  // driving the loop (the one that ran /code-review-loop). When other
  // sessions exit, their Stop event must not interfere with that loop.
  //
  // Binding strategy:
  //   - state.session_id null  →  unbound; the FIRST Stop event with a
  //                               session_id claims the loop. A clear
  //                               stderr notice is emitted so the user
  //                               can /cancel-review if the wrong
  //                               session claimed it.
  //   - state.session_id set   →  bound; only matching session_id may
  //                               drive the loop. Mismatching sessions
  //                               return silently (allow exit, do not
  //                               re-invoke reviewer).
  //
  // Fail-closed when the hook input lacks session_id but state is bound:
  // do NOT interfere — better to let an exit through than to drive a
  // bound loop using anonymous events.
  // ---------------------------------------------------------------------
  const incomingSessionId = (typeof input.session_id === 'string' && input.session_id)
    ? input.session_id
    : null;

  if (typeof state.session_id === 'string' && state.session_id) {
    if (!incomingSessionId) {
      // Bound, but this Stop event has no identity. Don't risk driving
      // the loop on behalf of an unknown session.
      return;
    }
    if (incomingSessionId !== state.session_id) {
      // Foreign session exiting. Allow it to exit silently; do not
      // touch the loop.
      return;
    }
    // Matching session — fall through to the loop's normal flow.
  } else if (incomingSessionId) {
    // Unbound state + identifiable Stop event → claim the loop.
    try {
      saveState(stateFile, { ...state, session_id: incomingSessionId });
      state = { ...state, session_id: incomingSessionId };
      process.stderr.write(
        `🔒 Code review loop bound to session ${incomingSessionId.slice(0, 8)}…\n` +
        `   If this session is not the one driving the loop, run /cancel-review\n` +
        `   and re-run /code-review-loop from the correct session.\n`
      );
    } catch (err) {
      process.stderr.write(
        `⚠️  Code review loop: failed to record session_id (${err.message}). ` +
        `Continuing without binding; future Stop events from other sessions ` +
        `may interfere.\n`
      );
    }
  }
  // else: unbound state + no incoming session_id → legacy fall-through;
  // behavior matches pre-isolation versions (best-effort, no isolation).

  // Approval check — SOURCE OF TRUTH is the reviewer's persisted report, NOT
  // the writer's last message. The reviewer is the only party authorized to
  // emit the terminator token, so we inspect only its output. This prevents
  // the writer from falsely terminating the loop by quoting or paraphrasing
  // ambiguous reviewer prose (e.g. "not recommended to approve").
  //
  // APPROVAL is also the ONLY path that clears state — see module doc.
  const latestReport = readReportFile(reportFile);
  if (hasApprovalInReport(latestReport)) {
    process.stdout.write(
      '✅ Code review loop: Reviewer issued APPROVAL in its latest report. ' +
      'Session complete.\n'
    );
    clearState(stateFile);
    clearReportFile(reportFile);
    return;
  }

  const iteration = typeof state.iteration === 'number' ? state.iteration : 0;
  const maxIterations = typeof state.max_iterations === 'number' ? state.max_iterations : 0;

  if (maxIterations > 0 && iteration >= maxIterations) {
    // Loop is suspended, not terminated. State is preserved so the user can
    // resume via /continue-loop or discard via /cancel-review. We do NOT
    // auto-clear state here.
    process.stdout.write(
      `🛑 Code review loop: max iterations (${maxIterations}) reached at ` +
      `iteration ${iteration}. Loop suspended; state preserved.\n` +
      `  - To continue, run /continue-loop --max-iterations <N>  (N > ${iteration}).\n` +
      `  - To discard state, run /cancel-review.\n`
    );
    return;
  }

  // Not approved — compute the incremental diff range and block the stop.
  const range = computeNextRange(state, workspaceRoot);
  if (range.reason === 'no-diff') {
    process.stderr.write(
      `⚠️  Code review loop: no new changes detected since iteration ${iteration}.\n` +
      `\n` +
      `   If you already made fixes but didn't commit them, the working tree\n` +
      `   matches the previous iteration's snapshot — the reviewer can't see\n` +
      `   them. Commit and exit again:\n` +
      `       git add <changed files>\n` +
      `       git commit -m "fix: <short description>"\n` +
      `\n` +
      `   If you haven't started fixing yet, address the reviewer's findings\n` +
      `   first, then commit before exiting.\n` +
      `\n` +
      `   To discard this loop entirely, run /cancel-review. State preserved.\n`
    );
    return;
  }

  const newBase = range.base;
  const newHead = range.head;

  if (!newBase) {
    // Environmental error — no HEAD commit. Don't nuke state; let the user
    // correct the repo state or explicitly cancel.
    process.stderr.write(
      `⚠️  Code review loop: unable to resolve base_revision (no HEAD commit). ` +
      `Run /cancel-review if this loop should be discarded. State preserved.\n`
    );
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

  // 4) Re-invoke the Copilot reviewer for the new range. The writer/fixer
  //    (the main session) must NEVER review the diff themselves — this hook
  //    owns the reviewer role to preserve writer/reviewer separation.
  const reviewerModel = (typeof state.model === 'string' && state.model)
    ? state.model
    : DEFAULT_REVIEWER_MODEL;

  const reviewerPrompt = composeIterationPrompt({
    base: newBase,
    head: newHead,
    iteration: nextIteration,
    maxIterations,
  });

  const reviewerReport = invokeReviewer({
    workspaceRoot,
    model: reviewerModel,
    prompt: reviewerPrompt,
  });

  // Persist the reviewer's latest report — this is the sole source of truth
  // the next stop-hook invocation will consult for the approval verdict.
  // When the invocation failed, explicitly clear the previous report so a
  // stale APPROVAL from an earlier iteration cannot trigger false completion.
  if (reviewerReport) {
    writeReportFile(reportFile, reviewerReport);
  } else {
    clearReportFile(reportFile);
  }

  const reason = reviewerReport
    ? [
        `The Copilot reviewer produced the following report for git range \`${newBase}..${newHead}\`.`,
        `You are the writer/fixer — DO NOT conduct your own review; act only on this report.`,
        '',
        '---',
        reviewerReport,
        '---',
        '',
        'Your job now:',
        '  1. Fix every Critical and Important finding above.',
        '  2. DO NOT emit `<promise>APPROVAL</promise>` yourself — that token',
        '     is reserved for the reviewer. The stop hook inspects the',
        '     persisted reviewer report, not your messages.',
        '  3. When done, exit your turn; the stop hook will either detect',
        '     the reviewer\'s APPROVAL on its next check or re-invoke the',
        '     reviewer on the new diff for another iteration.',
      ].join('\n')
    : [
        `The Copilot reviewer could not be invoked for git range \`${newBase}..${newHead}\`.`,
        'Do NOT review the diff yourself. Do NOT emit the approval token.',
        'Re-invoke the reviewer by running:',
        '',
        `  node \${CLAUDE_PLUGIN_ROOT}/skills/code-review-loop/scripts/copilot.js \\`,
        `    --prompt "Review incremental changes in git range ${newBase}..${newHead}" \\`,
        `    --model ${reviewerModel}`,
        '',
        'Then fix what that report flags. Only the reviewer can terminate the loop.',
      ].join('\n');

  process.stdout.write(
    JSON.stringify({
      decision: 'block',
      reason,
      systemMessage:
        `🔄 Code Review iteration ${nextIteration} | ` +
        `Range: ${newBase.slice(0, 7)}..${newHead.slice(0, 7)} | ` +
        `Reviewer: ${reviewerReport ? 'Copilot report persisted' : 'invocation failed — report cleared'}`,
    }, null, 2) + '\n'
  );
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
