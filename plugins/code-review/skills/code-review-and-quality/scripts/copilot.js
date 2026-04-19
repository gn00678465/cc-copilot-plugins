#!/usr/bin/env node

'use strict';

/**
 * Code Review Loop Initialization Script
 *
 * Starts a code-review session by writing state to .claude/review-state.json
 * and printing a mission start message.
 *
 * Usage:
 *   node copilot.js PROMPT [--max-iterations N] [--model MODEL_NAME]
 *
 * PROMPT is positional — all non-flag words are joined as the prompt.
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
    promptParts: [],
  };

  let i = 0;
  while (i < args.length) {
    const arg = args[i];

    if (arg === '--model') {
      if (i + 1 >= args.length || args[i + 1].startsWith('--')) {
        exitWithError('--model requires a value (e.g. --model claude-opus-4-5)');
      }
      result.model = args[i + 1];
      i += 2;
    } else if (arg === '--max-iterations') {
      if (i + 1 >= args.length || args[i + 1].startsWith('--')) {
        exitWithError('--max-iterations requires a numeric value (e.g. --max-iterations 5)');
      }
      const n = parseInt(args[i + 1], 10);
      if (isNaN(n) || n < 1) {
        exitWithError(`--max-iterations must be a positive integer, got: ${args[i + 1]}`);
      }
      result.maxIterations = n;
      i += 2;
    } else {
      // Positional argument — collect as part of the prompt
      result.promptParts.push(arg);
      i += 1;
    }
  }

  return {
    model: result.model,
    maxIterations: result.maxIterations,
    prompt: result.promptParts.join(' '),
  };
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

  if (!opts.prompt.trim()) {
    exitWithError(
      'A prompt is required. Provide the review context, e.g.:\n' +
        '  /code-review-and-quality Review the staged changes for quality'
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
