#!/usr/bin/env node

'use strict';

/**
 * Code Review Loop Initialization Script
 *
 * Starts a code-review session by writing state to .claude/review-state.json
 * and printing a mission start message.
 *
 * Usage:
 *   node copilot.js --model claude-opus-4-5 --max-iterate 3 --prompt "Review this code"
 */

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------
const DEFAULT_MODEL = 'claude-opus-4-5';
const DEFAULT_MAX_ITERATIONS = 5;

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const args = argv.slice(2); // drop node + script path
  const result = {
    model: DEFAULT_MODEL,
    maxIterations: DEFAULT_MAX_ITERATIONS,
    prompt: null,
  };

  let i = 0;
  while (i < args.length) {
    const arg = args[i];

    switch (arg) {
      case '--model':
        if (i + 1 >= args.length || args[i + 1].startsWith('--')) {
          exitWithError('--model requires a value (e.g. --model claude-opus-4-5)');
        }
        result.model = args[i + 1];
        i += 2;
        break;

      case '--max-iterate':
        if (i + 1 >= args.length || args[i + 1].startsWith('--')) {
          exitWithError('--max-iterate requires a numeric value (e.g. --max-iterate 5)');
        }
        const n = parseInt(args[i + 1], 10);
        if (isNaN(n) || n < 1) {
          exitWithError(`--max-iterate must be a positive integer, got: ${args[i + 1]}`);
        }
        result.maxIterations = n;
        i += 2;
        break;

      case '--prompt':
        if (i + 1 >= args.length || args[i + 1].startsWith('--')) {
          exitWithError('--prompt requires a text value (e.g. --prompt "Review staged changes")');
        }
        result.prompt = args[i + 1];
        i += 2;
        break;

      default:
        exitWithError(`Unknown argument: ${arg}`);
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function exitWithError(message) {
  process.stderr.write(`\u274C Error: ${message}\n`);
  process.exit(1);
}

function writeStateFile(state) {
  fs.mkdirSync('.claude', { recursive: true });
  const statePath = path.join('.claude', 'review-state.json');
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2) + '\n', 'utf8');
}

function printMissionStart(opts) {
  const { model, maxIterations, prompt } = opts;

  process.stdout.write(
    [
      '\uD83D\uDD0D Code Review Loop activated!',
      '',
      `Iteration: 1`,
      `Max iterations: ${maxIterations}`,
      `Model: ${model}`,
      '',
      'The stop hook is now active. When you stop this session, the Reviewer',
      'model will evaluate the code and either Approve or request changes.',
      '',
      '\u26A0\uFE0F  Loop exits when Reviewer outputs "Approval" or max iterations reached.',
      '',
      '\uD83D\uDD0D',
      '',
      prompt,
      '',
    ].join('\n')
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
function main() {
  const opts = parseArgs(process.argv);

  if (!opts.prompt) {
    exitWithError(
      '--prompt is required. Provide the review context, e.g.:\n' +
        '  node copilot.js --prompt "Review the staged changes for quality"'
    );
  }

  const state = {
    active: true,
    iteration: 1,
    max_iterations: opts.maxIterations,
    model: opts.model,
    prompt: opts.prompt,
    started_at: new Date().toISOString(),
  };

  writeStateFile(state);
  printMissionStart(opts);
}

main();
