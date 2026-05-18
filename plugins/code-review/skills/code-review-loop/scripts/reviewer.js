#!/usr/bin/env node

'use strict';

/**
 * /code-review-loop entry point — iteration 1.
 *
 * Writes the initial state file (.<mode>/code-review.local.md), prints a
 * compact mission banner, then spawns copilot.js with the user prompt +
 * read-only/scope/protocol clauses. The captured reviewer report is
 * persisted atomically to .<mode>/code-review.last-report.md after the
 * subprocess closes.
 */

const fs = require('fs');
const path = require('path');
const { spawn, execSync } = require('child_process');

const {
  consumePendingSessionId,
  writeReportFile,
  resolveReportFile,
} = require('./iterate.js');
const { composeInitialReviewerPrompt } = require('./prompts.js');

const COMPLETION_PROMISE = 'APPROVAL';
const DEFAULT_MODEL = 'gpt-5.4';
const DEFAULT_MAX_ITERATIONS = 3;
const DEFAULT_MODE = 'claude';

const HELP_TEXT = `Code Review Loop — iterative review loop with APPROVAL gate

USAGE:
  /code-review-loop PROMPT [OPTIONS]

OPTIONS:
  --max-iterations <n>   0 = unlimited (default: ${DEFAULT_MAX_ITERATIONS})
  --model <name>         Reviewer model (default: ${DEFAULT_MODEL})
  --mode claude|copilot  State dir (default: ${DEFAULT_MODE} → .claude/)
  -h, --help

EXAMPLES:
  /code-review-loop Review the staged changes for quality
  /code-review-loop Fix auth bug --max-iterations 10
`;

function exitWithError(msg) {
  process.stderr.write(`❌ Error: ${msg}\n`);
  process.exit(1);
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const out = {
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
        exitWithError('--model requires a value');
      }
      out.model = args[++i];
    } else if (arg === '--max-iterations') {
      if (i + 1 >= args.length || args[i + 1].startsWith('--')) {
        exitWithError('--max-iterations requires a numeric value');
      }
      const n = parseInt(args[++i], 10);
      if (isNaN(n) || n < 0) exitWithError(`--max-iterations must be ≥ 0, got: ${args[i]}`);
      out.maxIterations = n;
    } else if (arg === '--mode') {
      if (i + 1 >= args.length || args[i + 1].startsWith('--')) {
        exitWithError("--mode requires 'claude' or 'copilot'");
      }
      const m = args[++i].toLowerCase();
      if (m !== 'claude' && m !== 'copilot') exitWithError(`--mode must be 'claude' or 'copilot', got: ${m}`);
      out.mode = m;
    } else {
      out.promptParts.push(arg);
    }
    i += 1;
  }

  return {
    model: out.model,
    maxIterations: out.maxIterations,
    mode: out.mode,
    prompt: out.promptParts.join(' '),
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

function getInitialHead() {
  try { return execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim(); }
  catch (_) { return null; }
}

function writeStateFile({ maxIterations, mode, prompt, model, root }) {
  const dotDir = path.join(root, `.${mode}`);
  fs.mkdirSync(dotDir, { recursive: true });

  const startedAt = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const initialHead = getInitialHead();
  const sessionId = consumePendingSessionId(root);

  // Per flow.md: base_revision and head_sha start null; iteration-1 reviewer
  // gets the raw prompt, no range. They get filled by the stop hook on
  // iteration 2 from `git stash create`.
  const frontmatter = [
    '---',
    'active: true',
    'iteration: 1',
    `max_iterations: ${maxIterations}`,
    `completion_promise: "${COMPLETION_PROMISE}"`,
    `started_at: "${startedAt}"`,
    `model: "${model}"`,
    `mode: "${mode}"`,
    'base_revision: null',
    'head_sha: null',
    `initial_head: ${initialHead ? `"${initialHead}"` : 'null'}`,
    `session_id: ${sessionId ? `"${sessionId}"` : 'null'}`,
    '---',
    '',
    prompt,
    '',
  ].join('\n');

  fs.writeFileSync(path.join(dotDir, 'code-review.local.md'), frontmatter, 'utf8');
}

function printMissionStart({ model, maxIterations, prompt, mode }) {
  const cap = maxIterations > 0 ? String(maxIterations) : 'unlimited';
  const lines = [
    '🔄 Code Review Loop — iteration 1',
    '',
    `  Cap: ${cap}  |  Model: ${model}  |  Mode: .${mode}/`,
    '',
    'ROLE: you are the WRITER/FIXER. The Copilot CLI is the REVIEWER.',
    '  - Read the reviewer report below; fix Critical / Important findings.',
    '  - `git commit` your fixes before exiting (uncommitted diffs may snapshot empty).',
    '  - NEVER emit `<promise>APPROVAL</promise>` — that token is reviewer-only.',
    '  - Exit your turn; the stop hook loops or detects approval.',
    '',
    `Monitor: head -10 .${mode}/code-review.local.md`,
    `Cancel:  /cancel-review  (clears .${mode}/code-review.local.md and report)`,
    '',
    '─── Reviewer report follows ───',
    '',
  ];
  process.stdout.write(lines.join('\n'));
}

function runReviewer({ prompt, model, maxIterations, mode, root }) {
  return new Promise((resolveP, rejectP) => {
    const copilotScript = path.join(__dirname, 'copilot.js');
    const enriched = composeInitialReviewerPrompt({ userPrompt: prompt, maxIterations });

    const child = spawn(
      process.execPath,
      [copilotScript, '--prompt', enriched, '--model', model],
      { stdio: ['inherit', 'pipe', 'inherit'] }
    );

    let buffered = '';
    child.stdout.on('data', (chunk) => {
      buffered += chunk.toString();
      process.stdout.write(chunk);
    });

    child.on('error', rejectP);
    child.on('close', (code) => {
      // Persist atomically AFTER the subprocess closes. tmp+rename guarantees
      // any concurrent reader sees only the final captured stdout, never a
      // partial chunk or an intermediate file the reviewer might have written.
      const reportFile = resolveReportFile(root, `.${mode}`);
      writeReportFile(reportFile, buffered.trim());
      if (code === 0) resolveP();
      else rejectP(new Error(`copilot.js exited with code ${code}`));
    });
  });
}

async function main() {
  const opts = parseArgs(process.argv);
  if (!opts.prompt.trim()) {
    exitWithError(
      'A prompt is required.\n  e.g. /code-review-loop Review the staged changes for quality'
    );
  }

  const root = findProjectRoot();
  writeStateFile({ ...opts, root });
  printMissionStart(opts);

  try {
    await runReviewer({ ...opts, root });
  } catch (err) {
    exitWithError(`reviewer failed: ${err.message}`);
  }
}

main();
