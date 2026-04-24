#!/usr/bin/env node

'use strict';

/**
 * /continue-loop entry point.
 *
 * Resumes a suspended code-review loop. Usage:
 *
 *   node continue.js [--max-iterations N]
 *
 * Reads state from .<mode>/code-review.local.md (mode persisted in state),
 * validates that a resume is permitted, optionally raises max_iterations,
 * runs one Copilot reviewer pass on the writer's latest diff, and persists
 * the new iteration + report atomically.
 *
 * State lifecycle is unchanged: only reviewer APPROVAL clears state. All
 * rejection paths preserve state exactly as found.
 */

const fs = require('fs');
const path = require('path');

const iterate = require(path.resolve(__dirname, 'iterate.js'));

const HELP_TEXT = `Continue Loop — resume a suspended code-review loop

USAGE:
  /continue-loop [--max-iterations N]

OPTIONS:
  --max-iterations <N>   New absolute max_iterations (N > current iteration;
                         N = 0 for unlimited). Optional when the loop is not
                         yet at its cap.
  -h, --help             Show this help message

BEHAVIOR:
  Reads .<mode>/code-review.local.md (mode persisted in state). Rejects
  with a clear message and exit code 1 when:
    - no active loop is found,
    - the loop is at its cap and --max-iterations is omitted,
    - --max-iterations N <= current iteration,
    - no new diff exists since the last review.

  Otherwise: runs one Copilot reviewer pass on the incremental diff,
  persists the report, atomically updates state (iteration++, new cap if
  given, new base/head), and prints a banner + the reviewer's report.

EXAMPLES:
  /continue-loop --max-iterations 5
  /continue-loop
`;

function exitWithError(message) {
  process.stderr.write(`❌ ${message}\n`);
  process.exit(1);
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const result = { maxIterations: null };

  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    if (arg === '-h' || arg === '--help') {
      process.stdout.write(HELP_TEXT);
      process.exit(0);
    } else if (arg === '--max-iterations') {
      if (i + 1 >= args.length || args[i + 1].startsWith('--')) {
        exitWithError('--max-iterations requires a numeric value (e.g. --max-iterations 5)');
      }
      const raw = args[i + 1].trim();
      const n = parseInt(raw, 10);
      if (isNaN(n) || n < 0 || String(n) !== raw) {
        exitWithError(`--max-iterations must be a non-negative integer, got: ${args[i + 1]}`);
      }
      result.maxIterations = n;
      i += 2;
    } else {
      exitWithError(
        `Unknown argument: ${arg}. /continue-loop does not accept positional args or other flags. ` +
        `Use --help for usage.`
      );
    }
  }

  return result;
}

function resolveDotDir(mode) {
  return mode === 'copilot' ? '.copilot' : '.claude';
}

function loadActiveState(workspaceRoot) {
  for (const mode of ['claude', 'copilot']) {
    const dotDir = resolveDotDir(mode);
    const stateFile = iterate.resolveStateFile(workspaceRoot, dotDir);
    if (fs.existsSync(stateFile)) {
      let state;
      try {
        state = iterate.loadState(stateFile);
      } catch (err) {
        exitWithError(
          `Failed to parse ${path.join(dotDir, 'code-review.local.md')}: ${err.message}. ` +
          `Inspect manually or run /cancel-review to discard.`
        );
      }
      return { state, stateFile, dotDir, mode };
    }
  }
  return null;
}

function validateResumePreconditions(state, flags) {
  if (state.active !== true) {
    exitWithError(`Code review loop is not active (state.active != true).`);
  }

  const iteration = typeof state.iteration === 'number' ? state.iteration : 0;
  const stateMax = typeof state.max_iterations === 'number' ? state.max_iterations : 0;

  let effectiveMax = stateMax;
  if (flags.maxIterations !== null) {
    if (flags.maxIterations !== 0 && flags.maxIterations <= iteration) {
      exitWithError(
        `--max-iterations must be greater than current iteration (${iteration}), ` +
        `got ${flags.maxIterations}.`
      );
    }
    effectiveMax = flags.maxIterations;
  } else if (stateMax > 0 && iteration >= stateMax) {
    exitWithError(
      `Loop is at its cap (iteration ${iteration} / max ${stateMax}). ` +
      `Pass --max-iterations N (N > ${iteration}) to raise.`
    );
  }

  return { iteration, effectiveMax };
}

function printBanner({ iteration, max, model, mode, report }) {
  const capLabel = max > 0 ? `cap: ${max}` : 'cap: unlimited';
  const sep = '─'.repeat(63);

  const lines = [
    '🔄 Code Review Loop continued!',
    '',
    `Iteration: ${iteration}  (${capLabel})`,
    `Reviewer model: ${model}`,
    `Mode: ${mode} (.${mode}/)`,
    '',
    sep,
    'ROLE SEPARATION — STRICT',
    sep,
    '  You are the writer/fixer. The reviewer is the Copilot CLI subagent.',
    '  You MUST NOT emit <promise>APPROVAL</promise> — that token is',
    '  reviewer-exclusive. The stop hook inspects the reviewer\'s',
    '  persisted report, not your messages.',
    sep,
    '',
  ];
  process.stdout.write(lines.join('\n') + '\n');

  if (report) {
    process.stdout.write(`─── Reviewer report ───\n${report}\n─── End of report ───\n\n`);
    process.stdout.write([
      'Your job now:',
      '  1. Fix every Critical and Important finding above.',
      '  2. Exit your turn; the stop hook continues the loop or suspends',
      '     on the new cap.',
      '',
    ].join('\n'));
  } else {
    process.stdout.write(
      '⚠️  Copilot reviewer invocation failed. State has been advanced to the ' +
      'next iteration and the stale report was cleared; re-run /continue-loop ' +
      'or inspect copilot availability.\n'
    );
  }
}

function main() {
  const flags = parseArgs(process.argv);
  const workspaceRoot = process.cwd();

  const found = loadActiveState(workspaceRoot);
  if (!found) {
    exitWithError('No active code review loop found. Run /code-review-loop to start one.');
  }

  const { state, stateFile, dotDir, mode } = found;
  const { iteration, effectiveMax } = validateResumePreconditions(state, flags);

  const range = iterate.computeNextRange(state, workspaceRoot);
  if (range.reason === 'no-diff') {
    exitWithError(
      `No new changes since iteration ${iteration}. Address the reviewer's last ` +
      `findings before continuing.`
    );
  }
  if (!range.base || !range.head) {
    exitWithError(
      `Unable to resolve base_revision (no HEAD commit). Cannot continue.`
    );
  }

  const reviewerModel = (typeof state.model === 'string' && state.model)
    ? state.model
    : iterate.DEFAULT_REVIEWER_MODEL;

  const prompt = iterate.composeIterationPrompt({
    base: range.base,
    head: range.head,
    iteration: iteration + 1,
    maxIterations: effectiveMax,
  });

  const report = iterate.invokeReviewer({
    workspaceRoot,
    model: reviewerModel,
    prompt,
  });

  const reportFile = iterate.resolveReportFile(workspaceRoot, dotDir);
  if (report) {
    iterate.writeReportFile(reportFile, report);
  } else {
    iterate.clearReportFile(reportFile);
  }

  const nextState = {
    ...state,
    iteration: iteration + 1,
    base_revision: range.base,
    head_sha: range.head,
  };
  if (flags.maxIterations !== null) {
    nextState.max_iterations = flags.maxIterations;
  }
  iterate.saveState(stateFile, nextState);

  printBanner({
    iteration: iteration + 1,
    max: effectiveMax,
    model: reviewerModel,
    mode,
    report,
  });

  if (!report) {
    process.exit(1);
  }
}

main();
