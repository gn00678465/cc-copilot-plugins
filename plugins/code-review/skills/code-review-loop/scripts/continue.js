#!/usr/bin/env node

'use strict';

/**
 * /continue-loop entry point.
 *
 * Resumes a suspended code-review loop:
 *   - Reads state from .<mode>/code-review.local.md (mode persisted in state).
 *   - Optionally raises max_iterations.
 *   - Runs one Copilot reviewer pass on the writer's latest diff.
 *   - Persists the new report atomically and advances state.
 *
 * State lifecycle is unchanged: only reviewer APPROVAL clears state. All
 * rejection paths preserve state.
 */

const fs = require('fs');
const path = require('path');
const iterate = require(path.resolve(__dirname, 'iterate.js'));

const HELP_TEXT = `Continue Loop — resume a suspended code-review loop

USAGE:
  /continue-loop [--max-iterations N]

OPTIONS:
  --max-iterations <N>   New cap (> current iteration; 0 = unlimited).
                         Required if loop is at its cap.
  -h, --help
`;

function exitWithError(msg) {
  process.stderr.write(`❌ ${msg}\n`);
  process.exit(1);
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const out = { maxIterations: null };

  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    if (arg === '-h' || arg === '--help') {
      process.stdout.write(HELP_TEXT);
      process.exit(0);
    } else if (arg === '--max-iterations') {
      if (i + 1 >= args.length || args[i + 1].startsWith('--')) {
        exitWithError('--max-iterations requires a numeric value');
      }
      const raw = args[++i].trim();
      if (!/^\d+$/.test(raw)) exitWithError(`--max-iterations must be ≥ 0, got: ${raw}`);
      out.maxIterations = parseInt(raw, 10);
    } else {
      exitWithError(`Unknown argument: ${arg}. See --help.`);
    }
    i += 1;
  }
  return out;
}

function loadActiveState(root) {
  for (const mode of ['claude', 'copilot']) {
    const dotDir = `.${mode}`;
    const stateFile = iterate.resolveStateFile(root, dotDir);
    if (!fs.existsSync(stateFile)) continue;
    try {
      const state = iterate.loadState(stateFile);
      return { state, stateFile, dotDir, mode };
    } catch (err) {
      exitWithError(
        `Failed to parse ${path.join(dotDir, 'code-review.local.md')}: ${err.message}. ` +
        `Inspect manually or run /cancel-review.`
      );
    }
  }
  return null;
}

// Refresh state.session_id from the UserPromptExpansion sidecar so Stop-hook
// isolation keeps tracking the most recently active session. Race protection
// lives in session-stop.js; this is a synchronous user action so we just
// refresh the binding silently.
function refreshSessionBinding({ state, stateFile, root }) {
  const incoming = iterate.consumePendingSessionId(root);
  if (!incoming) return state;
  if (state.session_id === incoming) return state;
  const next = { ...state, session_id: incoming };
  iterate.saveState(stateFile, next);
  const action = state.session_id ? 'rebound to' : 'bound to';
  process.stderr.write(`🔒 Code review loop ${action} session ${incoming.slice(0, 8)}…\n`);
  return next;
}

function validateResume(state, flags) {
  if (state.active !== true) exitWithError('Loop is not active (state.active != true).');

  const iteration = typeof state.iteration === 'number' ? state.iteration : 0;
  const stateMax = typeof state.max_iterations === 'number' ? state.max_iterations : 0;

  let effectiveMax = stateMax;
  if (flags.maxIterations !== null) {
    if (flags.maxIterations !== 0 && flags.maxIterations <= iteration) {
      exitWithError(
        `--max-iterations must be > current iteration (${iteration}), got ${flags.maxIterations}.`
      );
    }
    effectiveMax = flags.maxIterations;
  } else if (stateMax > 0 && iteration >= stateMax) {
    exitWithError(
      `Loop at cap (${iteration}/${stateMax}). Pass --max-iterations N (N > ${iteration}).`
    );
  }
  return { iteration, effectiveMax };
}

function printBanner({ iteration, max, model, mode, report }) {
  const cap = max > 0 ? `cap: ${max}` : 'cap: unlimited';
  process.stdout.write([
    '🔄 Code Review Loop — continued',
    '',
    `  Iteration: ${iteration}  (${cap})  |  Model: ${model}  |  Mode: .${mode}/`,
    '',
    'ROLE: you are the WRITER/FIXER. Do NOT emit `<promise>APPROVAL</promise>`.',
    '',
  ].join('\n'));

  if (report) {
    process.stdout.write([
      '─── Reviewer report ───',
      report,
      '─── End of report ───',
      '',
      'Next: fix every Critical / Important finding, `git commit`, exit your turn.',
      '',
    ].join('\n'));
  } else {
    process.stdout.write(
      '⚠️  Reviewer invocation failed. State advanced; stale report cleared. ' +
      'Re-run /continue-loop after checking copilot availability.\n'
    );
  }
}

function main() {
  const flags = parseArgs(process.argv);
  const root = process.cwd();

  const found = loadActiveState(root);
  if (!found) exitWithError('No active code review loop. Run /code-review-loop to start one.');

  const state = refreshSessionBinding({ state: found.state, stateFile: found.stateFile, root });
  const { iteration, effectiveMax } = validateResume(state, flags);

  const range = iterate.computeNextRange(state, root);
  if (range.reason === 'no-diff') {
    exitWithError(`No new changes since iteration ${iteration}. Address the reviewer's findings first.`);
  }
  if (!range.base || !range.head) {
    exitWithError('Unable to resolve base_revision (no HEAD commit).');
  }

  const model = state.model || iterate.DEFAULT_REVIEWER_MODEL;
  const prompt = iterate.composeIterationPrompt({
    base: range.base,
    head: range.head,
    iteration: iteration + 1,
    maxIterations: effectiveMax,
  });

  const report = iterate.invokeReviewer({ workspaceRoot: root, model, prompt });

  const reportFile = iterate.resolveReportFile(root, found.dotDir);
  if (report) iterate.writeReportFile(reportFile, report);
  else iterate.clearReportFile(reportFile);

  const nextState = {
    ...state,
    iteration: iteration + 1,
    base_revision: range.base,
    head_sha: range.head,
  };
  if (flags.maxIterations !== null) nextState.max_iterations = flags.maxIterations;
  iterate.saveState(found.stateFile, nextState);

  printBanner({
    iteration: iteration + 1,
    max: effectiveMax,
    model,
    mode: found.mode,
    report,
  });

  if (!report) process.exit(1);
}

main();
