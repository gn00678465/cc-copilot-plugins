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
const { execFileSync } = require('child_process');

const {
  hasApprovalInReport,
  gitStashCreate,
  gitHeadCommit,
  resolveWorkspaceRoot,
  resolveStateFile,
  resolveReportFile,
  readReportFile,
  writeReportFile,
  clearReportFile,
  loadState,
  saveState,
  clearState,
} = require(
  path.resolve(__dirname, '..', 'skills', 'code-review-loop', 'scripts', 'iterate.js')
);

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_REVIEWER_MODEL = 'gpt-5.4';

// ---------------------------------------------------------------------------
// Copilot invocation (migrated to iterate.js in a follow-up task)
// ---------------------------------------------------------------------------

function resolveCopilotScript() {
  return path.resolve(
    __dirname,
    '..',
    'skills',
    'code-review-loop',
    'scripts',
    'copilot.js'
  );
}

function runCopilotReviewer({ workspaceRoot, model, prompt }) {
  const copilotScript = resolveCopilotScript();
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
    // inspect the last iteration, raise max_iterations to continue, or run
    // /cancel-review to discard. We do NOT auto-clear state here.
    process.stdout.write(
      `🛑 Code review loop: max iterations (${maxIterations}) reached at ` +
      `iteration ${iteration}. Loop suspended; state preserved.\n` +
      `  - To discard state, run /cancel-review.\n` +
      `  - To continue, raise max_iterations in .${mode}/code-review.local.md.\n`
    );
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
      // No diff to review this round. The writer may still be mid-fix.
      // Preserve state AND the existing reviewer report (still authoritative
      // for the next Stop event); do not bump iteration.
      process.stderr.write(
        `⚠️  Code review loop: no changes detected since iteration ${iteration}. ` +
        `Address the reviewer's findings before exiting, or run /cancel-review ` +
        `to end the loop. State preserved.\n`
      );
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

  // Compose the iteration 2+ reviewer prompt with:
  //   - the range-focused review instruction,
  //   - an exclusion clause for our own state files (so reviewer ignores
  //     .claude/code-review.*.md if they happen to be tracked in git),
  //   - emotional-stimuli context when we're in the final iteration window
  //     (research suggests this lifts accuracy and decisiveness on the last
  //     call — see copilot.js::buildLoopContextSuffix).
  const { buildExclusionClause, buildLoopContextSuffix } = require(
    path.resolve(__dirname, '..', 'skills', 'code-review-loop', 'scripts', 'copilot.js')
  );

  const reviewerPrompt =
    `Review the incremental changes in this git range: ` +
    `\`${newBase}..${newHead}\`.\n\n` +
    `Run \`git diff ${newBase}..${newHead}\` to see exactly what changed ` +
    `since the previous review iteration. Apply the same multi-axis ` +
    `review (correctness / quality / security / performance) focused ` +
    `ONLY on these changes.` +
    buildExclusionClause() +
    buildLoopContextSuffix(nextIteration, maxIterations);

  const reviewerReport = runCopilotReviewer({
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
