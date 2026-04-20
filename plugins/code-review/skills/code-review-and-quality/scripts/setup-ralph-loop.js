#!/usr/bin/env node

'use strict';

/**
 * Code Review Loop Initialization Script
 *
 * Starts a code-review session by writing state to .<mode>/review-state.json
 * and printing a mission start message.
 *
 * Usage:
 *   node copilot.js PROMPT [--max-iterations N] [--model MODEL_NAME] [--mode claude|copilot]
 *
 * PROMPT is positional — all non-flag words are joined as the prompt.
 * --mode determines the dot-directory: 'claude' → .claude, 'copilot' → .copilot (default: claude)
 */

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------
const DEFAULT_MODEL = 'gpt-5.4';
const DEFAULT_MAX_ITERATIONS = 5;
const DEFAULT_MODE = 'claude';

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const args = argv.slice(2); // drop node + script path
  const result = {
    model: DEFAULT_MODEL,
    maxIterations: DEFAULT_MAX_ITERATIONS,
    mode: DEFAULT_MODE,
    promptParts: [],
  };

  let i = 0;
  while (i < args.length) {
    const arg = args[i];

    if (arg === '--model') {
      if (i + 1 >= args.length || args[i + 1].startsWith('--')) {
        exitWithError('--model requires a value (e.g. --model gpt-5.4)');
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
    } else if (arg === '--mode') {
      if (i + 1 >= args.length || args[i + 1].startsWith('--')) {
        exitWithError("--mode requires a value: 'claude' or 'copilot'");
      }
      const m = args[i + 1].toLowerCase();
      if (m !== 'claude' && m !== 'copilot') {
        exitWithError(`--mode must be 'claude' or 'copilot', got: ${args[i + 1]}`);
      }
      result.mode = m;
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
    mode: result.mode,
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

function findProjectRoot() {
  let dir = process.cwd();
  while (true) {
    if (fs.existsSync(path.join(dir, '.git'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return process.cwd();
    dir = parent;
  }
}

function writeStateFile(state, mode) {
  const root = findProjectRoot();
  const dotDir = path.join(root, `.${mode}`);
  fs.mkdirSync(dotDir, { recursive: true });
  const statePath = path.join(dotDir, 'review-state.json');
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2) + '\n', 'utf8');
}

function printMissionStart(opts) {
  const { model, maxIterations, prompt, mode } = opts;

  process.stdout.write(
    [
      '\uD83D\uDD0D Code Review Loop activated!',
      '',
      `Iteration: 1`,
      `Max iterations: ${maxIterations}`,
      `Model: ${model}`,
      `Mode: ${mode} (.${mode}/)`,
      '',
      'The stop hook is now active. When you stop this session, the Reviewer',
      'model will evaluate the code and either Approve or request changes.',
      '',
      '\u26A0\uFE0F  Loop exits when Reviewer outputs "> **Approval**" or max iterations reached.',
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
    mode: opts.mode,
    prompt: opts.prompt,
    started_at: new Date().toISOString(),
  };

  writeStateFile(state, opts.mode);
  printMissionStart(opts);
}

main();
