#!/usr/bin/env node

'use strict';

/**
 * Code Review Stop Hook (iteration 2+ driver).
 *
 * Runs on every Claude Code Stop event. If a review loop is active AND this
 * Stop event came from the session that owns the loop, decides:
 *   - reviewer report ends with APPROVAL → clear state + clear report → allow exit
 *   - max_iterations hit                  → suspend (preserve state) → allow exit
 *   - no new diff since last iteration    → tell writer to commit/fix → allow exit
 *   - otherwise                            → spawn reviewer on incremental
 *                                            diff, persist report atomically,
 *                                            block exit with the report fed back
 *
 * State lifecycle: only APPROVAL clears code-review.local.md. Every other
 * outcome preserves it so the next iteration has context to resume from.
 *
 * Session isolation: when state.session_id is set, only the matching
 * incoming session_id may drive the loop; foreign sessions return silently.
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
  buildIterationReason,
} = require(
  path.resolve(__dirname, '..', 'skills', 'code-review-loop', 'scripts', 'iterate.js')
);

function readHookInput() {
  const raw = fs.readFileSync(0, 'utf8').trim();
  return raw ? JSON.parse(raw) : {};
}

async function main() {
  const mode = process.argv[2] === 'copilot' ? 'copilot' : 'claude';
  const dotDir = `.${mode}`;

  const input = readHookInput();
  const root = resolveWorkspaceRoot(input.cwd);
  const stateFile = resolveStateFile(root, dotDir);
  const reportFile = resolveReportFile(root, dotDir);

  if (!fs.existsSync(stateFile)) return; // no active loop

  let state;
  try {
    state = loadState(stateFile);
  } catch (err) {
    // Corrupt state may represent user work-in-progress — do NOT auto-delete.
    process.stderr.write(
      `⚠️  Code review loop: failed to parse .${mode}/code-review.local.md ` +
      `(${err.message}). Inspect manually or run /cancel-review.\n`
    );
    return;
  }

  if (!state.active) return;

  // --- Session isolation --------------------------------------------------
  // state.session_id null → first Stop event with an id claims the loop.
  // state.session_id set  → only matching session may drive; others silent.
  // Fail-closed: bound state + anonymous Stop event → return without acting.
  const incoming = (typeof input.session_id === 'string' && input.session_id)
    ? input.session_id : null;

  if (typeof state.session_id === 'string' && state.session_id) {
    if (!incoming || incoming !== state.session_id) return;
  } else if (incoming) {
    try {
      state = { ...state, session_id: incoming };
      saveState(stateFile, state);
      process.stderr.write(
        `🔒 Code review loop bound to session ${incoming.slice(0, 8)}…\n` +
        `   If this is not the driving session, /cancel-review and re-run.\n`
      );
    } catch (err) {
      process.stderr.write(
        `⚠️  Code review loop: failed to record session_id (${err.message}). ` +
        `Continuing without binding.\n`
      );
    }
  }
  // else: unbound + no incoming id → legacy behavior, no isolation.

  // --- APPROVAL check (single source of truth: reviewer's persisted report)
  if (hasApprovalInReport(readReportFile(reportFile))) {
    process.stdout.write(
      '✅ Code review loop: Reviewer issued APPROVAL. Session complete.\n'
    );
    clearState(stateFile);
    clearReportFile(reportFile);
    return;
  }

  const iteration = typeof state.iteration === 'number' ? state.iteration : 0;
  const maxIter = typeof state.max_iterations === 'number' ? state.max_iterations : 0;

  if (maxIter > 0 && iteration >= maxIter) {
    process.stdout.write(
      `🛑 Code review loop: max iterations (${maxIter}) reached at ` +
      `iteration ${iteration}. Loop suspended; state preserved.\n` +
      `  - Continue: /continue-loop --max-iterations <N>  (N > ${iteration}).\n` +
      `  - Discard:  /cancel-review.\n`
    );
    return;
  }

  // --- Incremental range
  const range = computeNextRange(state, root);
  if (range.reason === 'no-diff') {
    process.stderr.write(
      `⚠️  Code review loop: no new changes since iteration ${iteration}.\n` +
      `\n` +
      `   If you already fixed something, commit it so the reviewer can see it:\n` +
      `       git add <changed files>\n` +
      `       git commit -m "fix: <short description>"\n` +
      `\n` +
      `   Otherwise address the reviewer's findings first.\n` +
      `   /cancel-review discards the loop; state preserved otherwise.\n`
    );
    return;
  }
  if (!range.base) {
    process.stderr.write(
      `⚠️  Code review loop: unable to resolve base_revision (no HEAD commit). ` +
      `State preserved; run /cancel-review to discard.\n`
    );
    return;
  }

  // --- Advance state + run reviewer
  const next = iteration + 1;
  saveState(stateFile, {
    ...state,
    iteration: next,
    base_revision: range.base,
    head_sha: range.head,
  });

  const reviewerModel = state.model || DEFAULT_REVIEWER_MODEL;
  const reviewerPrompt = composeIterationPrompt({
    base: range.base,
    head: range.head,
    iteration: next,
    maxIterations: maxIter,
  });

  const reviewerReport = invokeReviewer({
    workspaceRoot: root,
    model: reviewerModel,
    prompt: reviewerPrompt,
  });

  // Atomic persist; clear on failure so a stale APPROVAL from an earlier
  // iteration cannot trigger false completion on the next Stop event.
  if (reviewerReport) writeReportFile(reportFile, reviewerReport);
  else clearReportFile(reportFile);

  const reason = buildIterationReason({
    base: range.base,
    head: range.head,
    reviewerReport,
  });

  process.stdout.write(JSON.stringify({
    decision: 'block',
    reason,
    systemMessage:
      `🔄 Code Review iteration ${next} | ` +
      `Range: ${range.base.slice(0, 7)}..${range.head.slice(0, 7)} | ` +
      `Reviewer: ${reviewerReport ? 'report persisted' : 'invocation failed — report cleared'}`,
  }, null, 2) + '\n');
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
