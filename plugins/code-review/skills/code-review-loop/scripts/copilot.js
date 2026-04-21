'use strict';

const { spawn } = require('child_process');
const { resolve } = require('path');

function resolvePluginPath() {
    return resolve(__dirname, "..", "reference", "plugin");
}

function runCopilot(args) {
    return new Promise((resolve, reject) => {
        const pluginPath = resolvePluginPath();
        const copilotProcess = spawn("copilot", [
            '-p', args.prompt,
            '--model', args.model,
            '--plugin-dir', pluginPath,
            '--allow-all-tools',
            '--yolo'
        ],
        {
            // use pipe so we can capture stdout/stderr programmatically
            stdio: "pipe",
        });

        let stdoutData = '';
        let stderrData = '';

        // 收集 stdout
        if (copilotProcess.stdout) {
            copilotProcess.stdout.on('data', (data) => {
                stdoutData += data.toString();
            });
        }

        // 收集 stderr (用於錯誤診斷)
        if (copilotProcess.stderr) {
            copilotProcess.stderr.on('data', (data) => {
                stderrData += data.toString();
            });
        }

        // 監聽錯誤（如找不到命令）
        copilotProcess.on('error', (err) => {
            reject(err);
        });

        // 當進程結束時 resolve 或 reject
        copilotProcess.on('close', (code) => {
            if (code === 0) {
                resolve(stdoutData.trim());
            } else {
                reject(new Error(`進程退出，代碼: ${code}\n錯誤訊息: ${stderrData}`));
            }
        });
    })
}

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

const cli = parseCliArgs(process.argv);
if (cli.help) {
    console.log('Usage: node copilot.js --prompt "your prompt" --model "gpt-5-mini"');
}

if (cli.prompt) {
    runCopilot({ prompt: cli.prompt, model: cli.model || 'gpt-5-mini' })
        .then((out) => {
            if (out) console.log(out);
            process.exit(0);
        })
        .catch((err) => {
            console.error(err);
            process.exit(1);
        });
}