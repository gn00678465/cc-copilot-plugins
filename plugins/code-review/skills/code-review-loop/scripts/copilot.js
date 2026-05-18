'use strict';

/**
 * Copilot CLI reviewer runner.
 *
 * Spawns `copilot` with the user/iteration prompt + APPROVAL_PROTOCOL_SUFFIX,
 * tees stdout chunks to the parent process (so the writer sees the report in
 * real time), and resolves with the captured stdout on success. The caller
 * is responsible for persisting the report file — copilot.js never writes
 * to disk.
 */

const { spawn } = require('child_process');
const { resolve } = require('path');

const { APPROVAL_PROTOCOL_SUFFIX } = require('./prompts.js');

function resolvePluginPath() {
  return resolve(__dirname, '..', 'reference', 'plugin');
}

function wrapReviewerPrompt(userPrompt) {
  return `${userPrompt}${APPROVAL_PROTOCOL_SUFFIX}`;
}

function runCopilot({ prompt, model }) {
  return new Promise((resolveP, rejectP) => {
    const pluginPath = resolvePluginPath();
    const fullPrompt = wrapReviewerPrompt(prompt);

    const child = spawn('copilot', [
      '-p', fullPrompt,
      '--model', model,
      '--plugin-dir', pluginPath,
      '--allow-all-tools',
      '--yolo',
      '--no-custom-instructions',
      '--silent',
    ], { stdio: 'pipe' });

    let stdoutData = '';
    let stderrData = '';

    child.stdout?.on('data', (chunk) => {
      stdoutData += chunk.toString();
      process.stdout.write(chunk);
    });
    child.stderr?.on('data', (chunk) => {
      stderrData += chunk.toString();
    });

    child.on('error', rejectP);
    child.on('close', (code) => {
      if (code === 0) resolveP(stdoutData.trim());
      else rejectP(new Error(`copilot exited with code ${code}\n${stderrData}`));
    });
  });
}

module.exports = { wrapReviewerPrompt, runCopilot };

// --- CLI entry: used by iterate.js / reviewer.js via execFile/spawn ---
function parseCliArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if ((a === '--prompt' || a === '-p') && argv[i + 1]) out.prompt = argv[++i];
    else if ((a === '--model' || a === '-m') && argv[i + 1]) out.model = argv[++i];
    else if (a === '--help' || a === '-h') out.help = true;
  }
  return out;
}

if (require.main === module) {
  const cli = parseCliArgs(process.argv);
  if (cli.help) {
    process.stdout.write('Usage: node copilot.js --prompt "..." --model "gpt-5-mini"\n');
    process.exit(0);
  }
  if (!cli.prompt) {
    process.stderr.write('Error: --prompt is required\n');
    process.exit(1);
  }
  runCopilot({ prompt: cli.prompt, model: cli.model || 'gpt-5-mini' })
    .then(() => process.exit(0))
    .catch((err) => {
      process.stderr.write(`${err.message}\n`);
      process.exit(1);
    });
}
