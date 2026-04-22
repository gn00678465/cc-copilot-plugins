#!/usr/bin/env node

'use strict';

/**
 * Code Review Loop Initialization Script
 *
 * Starts a code-review session by writing state to .<mode>/code-review.local.md
 * and printing a mission start message.
 *
 * Usage:
 *   node reviewer.js PROMPT [--max-iterations N] [--model MODEL_NAME] [--mode claude|copilot]
 *
 * PROMPT is positional — all non-flag words are joined as the prompt.
 * --mode determines the dot-directory: 'claude' → .claude, 'copilot' → .copilot (default: claude)
 * completion_promise is always fixed to "APPROVAL"
 */

const fs = require('fs');
const path = require('path');
const { spawn, execSync } = require('child_process');

function getInitialHead() {
  try {
    return execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
  } catch (_) {
    return null;
  }
}

const COMPLETION_PROMISE = 'APPROVAL';
const DEFAULT_MODEL = 'gpt-5.4';
const DEFAULT_MAX_ITERATIONS = 0;
const DEFAULT_MODE = 'claude';

const HELP_TEXT = `Code Review Loop - Iterative review loop with Approval gate

USAGE:
  /code-review-loop [PROMPT...] [OPTIONS]

ARGUMENTS:
  PROMPT...    Review context / task description (can be multiple words without quotes)

OPTIONS:
  --max-iterations <n>   Maximum iterations before auto-stop (0 = unlimited, default: 0)
  --model <name>         Model name to record in state (default: ${DEFAULT_MODEL})
  --mode claude|copilot  Dot-directory to use (default: claude)
  -h, --help             Show this help message

DESCRIPTION:
  Starts a code-review loop in the current session. The stop hook prevents
  exit and feeds output back as input until the reviewer approves or the
  iteration limit is reached.

  To signal completion, output this EXACT tag:
    <promise>${COMPLETION_PROMISE}</promise>

EXAMPLES:
  /code-review-loop Review the staged changes for quality
  /code-review-loop Fix auth bug --max-iterations 10
  /code-review-loop Refactor cache layer --mode copilot

MONITORING:
  head -10 .claude/code-review.local.md
`;

function exitWithError(message) {
  process.stderr.write(`❌ Error: ${message}\n`);
  process.exit(1);
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const result = {
    model: DEFAULT_MODEL,
    maxIterations: DEFAULT_MAX_ITERATIONS,
    mode: DEFAULT_MODE,
    promptParts: [],
  };

  let i = 0;
  while (i < args.length) {
    const arg = args[i];

    if (arg === '-h' || arg === '--help') {
      process.stdout.write(HELP_TEXT);
      process.exit(0);
    } else if (arg === '--model') {
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
      if (isNaN(n) || n < 0) {
        exitWithError(`--max-iterations must be a non-negative integer, got: ${args[i + 1]}`);
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

function findProjectRoot() {
  let dir = process.cwd();
  while (true) {
    if (fs.existsSync(path.join(dir, '.git'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return process.cwd();
    dir = parent;
  }
}

function writeStateFile(opts) {
  const { maxIterations, mode, prompt } = opts;
  const root = findProjectRoot();
  const dotDir = path.join(root, `.${mode}`);
  fs.mkdirSync(dotDir, { recursive: true });

  const startedAt = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const initialHead = getInitialHead();
  const frontmatter = [
    '---',
    'active: true',
    'iteration: 1',
    `max_iterations: ${maxIterations}`,
    `completion_promise: "${COMPLETION_PROMISE}"`,
    `started_at: "${startedAt}"`,
    'base_revision: null',
    'head_sha: null',
    `initial_head: ${initialHead ? `"${initialHead}"` : 'null'}`,
    '---',
    '',
    prompt,
    '',
  ].join('\n');

  const statePath = path.join(dotDir, 'code-review.local.md');
  fs.writeFileSync(statePath, frontmatter, 'utf8');
  return statePath;
}

function printMissionStart(opts) {
  const { model, maxIterations, prompt, mode } = opts;
  const iterLabel = maxIterations > 0 ? String(maxIterations) : 'unlimited';

  process.stdout.write(
    [
      '🔄 Code Review Loop activated in this session!',
      '',
      `Iteration: 1`,
      `Max iterations: ${iterLabel}`,
      `Model: ${model}`,
      `Mode: ${mode} (.${mode}/)`,
      `Completion promise: ${COMPLETION_PROMISE} (ONLY output when TRUE - do not lie!)`,
      '',
      'The stop hook is now active. On the first exit the original prompt is replayed.',
      'Subsequent iterations receive a git diff range review prompt focused on changes',
      'since the previous iteration. The loop continues until Approval or max iterations.',
      '',
      `To monitor: head -10 .${mode}/code-review.local.md`,
      '',
      '⚠️  WARNING: This loop cannot be stopped manually! It will run infinitely',
      '    unless you set --max-iterations.',
      '',
      '🔄',
      '',
      prompt,
      '',
      '═'.repeat(63),
      'CRITICAL - Code Review Loop Completion Promise',
      '═'.repeat(63),
      '',
      'To complete this loop, output this EXACT text:',
      `  <promise>${COMPLETION_PROMISE}</promise>`,
      '',
      'STRICT REQUIREMENTS (DO NOT VIOLATE):',
      '  ✓ Use <promise> XML tags EXACTLY as shown above',
      '  ✓ The statement MUST be completely and unequivocally TRUE',
      '  ✓ Do NOT output false statements to exit the loop',
      '  ✓ Do NOT lie even if you think you should exit',
      '',
      'IMPORTANT - Do not circumvent the loop:',
      '  Even if you believe you\'re stuck or the task is impossible,',
      '  you MUST NOT output a false promise statement. The loop is',
      '  designed to continue until the promise is GENUINELY TRUE.',
      '═'.repeat(63),
      '',
    ].join('\n')
  );
}

function runCopilotScript(opts) {
  return new Promise((resolve, reject) => {
    const copilotScript = path.join(__dirname, 'copilot.js');
    const child = spawn(
      process.execPath,
      [copilotScript, '--prompt', opts.prompt, '--model', opts.model],
      { stdio: 'inherit' }
    );
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`copilot.js exited with code ${code}`));
    });
  });
}

async function main() {
  const opts = parseArgs(process.argv);

  if (!opts.prompt.trim()) {
    exitWithError(
      'A prompt is required. Provide the review context, e.g.:\n' +
        '  /code-review-and-quality Review the staged changes for quality'
    );
  }

  writeStateFile(opts);
  printMissionStart(opts);

  try {
    await runCopilotScript(opts);
  } catch (err) {
    exitWithError(`copilot.js failed: ${err.message}`);
  }
}

main();
