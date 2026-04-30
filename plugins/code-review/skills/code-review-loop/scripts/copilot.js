'use strict';

/**
 * Copilot CLI subagent runner.
 *
 * Prompt fragments (APPROVAL_PROTOCOL_SUFFIX, scope clauses, loop-context
 * suffix) live in ./prompts.js after the Phase A consolidation. This file
 * keeps only the spawn-time wiring and re-exports the relevant fragments
 * for any external consumer that still imports from here.
 */

const { spawn } = require('child_process');
const { resolve } = require('path');

const {
    APPROVAL_PROTOCOL_SUFFIX,
    buildExclusionClause,
    buildDefaultScopeClause,
    buildLoopContextSuffix,
} = require('./prompts.js');

function resolvePluginPath() {
    return resolve(__dirname, "..", "reference", "plugin");
}

function wrapReviewerPrompt(userPrompt) {
    return `${userPrompt}${APPROVAL_PROTOCOL_SUFFIX}`;
}

function runCopilot(args) {
    return new Promise((resolve, reject) => {
        const pluginPath = resolvePluginPath();
        const fullPrompt = wrapReviewerPrompt(args.prompt);
        const copilotProcess = spawn("copilot", [
            '-p', fullPrompt,
            '--model', args.model,
            '--plugin-dir', pluginPath,
            '--allow-all-tools',
            '--yolo',
            "--no-custom-instructions",
            "--silent"
        ],
        {
            // use pipe so we can capture stdout/stderr programmatically
            stdio: "pipe",
        });

        let stdoutData = '';
        let stderrData = '';

        if (copilotProcess.stdout) {
            copilotProcess.stdout.on('data', (data) => {
                stdoutData += data.toString();
                // Tee each chunk so parent processes (e.g. reviewer.js) can
                // surface reviewer output in real time instead of waiting for
                // the whole buffer at exit.
                process.stdout.write(data);
            });
        }

        if (copilotProcess.stderr) {
            copilotProcess.stderr.on('data', (data) => {
                stderrData += data.toString();
            });
        }

        copilotProcess.on('error', (err) => {
            reject(err);
        });

        copilotProcess.on('close', (code) => {
            if (code === 0) {
                resolve(stdoutData.trim());
            } else {
                reject(new Error(`進程退出，代碼: ${code}\n錯誤訊息: ${stderrData}`));
            }
        });
    });
}

module.exports = {
    APPROVAL_PROTOCOL_SUFFIX,
    wrapReviewerPrompt,
    buildExclusionClause,
    buildDefaultScopeClause,
    buildLoopContextSuffix,
    runCopilot,
};

// --- CLI entry for quick verification ---
function parseCliArgs(argv) {
    const out = {};
    for (let i = 2; i < argv.length; i++) {
        const a = argv[i];
        if ((a === '--prompt' || a === '-p') && argv[i + 1]) {
            out.prompt = argv[++i];
        } else if ((a === '--model' || a === '-m') && argv[i + 1]) {
            out.model = argv[++i];
        } else if (a === '--help' || a === '-h') {
            out.help = true;
        }
    }
    return out;
}

if (require.main === module) {
    const cli = parseCliArgs(process.argv);
    if (cli.help) {
        console.log('Usage: node copilot.js --prompt "your prompt" --model "gpt-5-mini"');
    }

    if (cli.prompt) {
        // runCopilot tees stdout chunks directly to process.stdout, so the
        // CLI entry must not re-print the buffered result or it will double.
        runCopilot({ prompt: cli.prompt, model: cli.model || 'gpt-5-mini' })
            .then(() => process.exit(0))
            .catch((err) => {
                console.error(err);
                process.exit(1);
            });
    }
}
