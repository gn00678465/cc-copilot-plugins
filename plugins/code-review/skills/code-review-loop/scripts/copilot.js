'use strict';

const { spawn } = require('child_process');
const { resolve } = require('path');

// ---------------------------------------------------------------------------
// Loop-termination protocol injected into every reviewer prompt.
//
// Contract: the Copilot reviewer is the ONLY party allowed to emit the
// terminator tag. The stop hook matches it as the final non-empty line
// of the reviewer's report. The writer/fixer session never emits it —
// that prevents ambiguous reviewer prose (e.g. "not recommended to approve")
// from being misread into a false termination.
// ---------------------------------------------------------------------------
const APPROVAL_PROTOCOL_SUFFIX = `

---

LOOP TERMINATION PROTOCOL — READ CAREFULLY

You are the reviewer in an automated review-fix loop. The loop is terminated
SOLELY by you, never by the writer/fixer session. Follow these rules exactly.

1. If — and only if — this iteration PASSES review (zero Critical findings,
   zero Important findings, tests exist or are not required for this change,
   and the code is ready to merge), finish your report with a line containing
   exactly this token and nothing else, as the FINAL line of your output:

       <promise>APPROVAL</promise>

   No surrounding text. No prefix. No suffix. No trailing prose.

2. If the iteration does NOT pass review, do NOT emit that literal tag
   anywhere in your output. If you must mention it in prose or examples,
   wrap it in backticks so it cannot be mistaken for the terminator:

       \`<promise>APPROVAL</promise>\`

   Do not write sentences like "not APPROVAL" or "cannot approve yet"
   using the raw tag — those phrases read as approval to a pattern matcher.
   Just list the findings; absence of the tag is itself the "not yet" signal.

3. The writer/fixer session will NOT emit this tag. The stop hook inspects
   your report, not the writer's messages. The loop continues until YOUR
   report's final line equals the literal terminator above.
`;

function resolvePluginPath() {
    return resolve(__dirname, "..", "reference", "plugin");
}

function wrapReviewerPrompt(userPrompt) {
    return `${userPrompt}${APPROVAL_PROTOCOL_SUFFIX}`;
}

// ---------------------------------------------------------------------------
// Review scope exclusions
//
// The plugin writes its own state and the reviewer's persisted report into
// the project's dot-directory. If those paths happen to be tracked in git
// (e.g. a repo that commits .claude/), they will appear in `git stash create`
// snapshots and in `git diff <range>` output — and the reviewer will try to
// "review" them. This clause tells the reviewer to silently skip them.
// ---------------------------------------------------------------------------
function buildExclusionClause() {
    return (
        '\n\nREVIEW SCOPE — EXCLUSIONS\n\n' +
        'The following paths are this plugin\'s internal state files, not code ' +
        'to be reviewed. If the diff range contains changes to them, silently ' +
        'skip them. Do NOT list them as findings, do NOT mention them in the ' +
        'report, do NOT let them affect your verdict:\n' +
        '  - .claude/code-review.local.md\n' +
        '  - .claude/code-review.last-report.md\n' +
        '  - .copilot/code-review.local.md\n' +
        '  - .copilot/code-review.last-report.md'
    );
}

// ---------------------------------------------------------------------------
// Emotional stimuli near the iteration cap
//
// As the loop approaches its --max-iterations ceiling, the reviewer's verdict
// becomes higher-stakes: there are few (or zero) remaining retries to catch
// mistakes. We append "emotional stimuli" context to the prompt in the final
// 1–2 iterations only. Research on EmotionPrompt (Li et al., 2023) suggests
// this can improve accuracy and decisiveness on reasoning tasks.
// ---------------------------------------------------------------------------
function buildLoopContextSuffix(currentIteration, maxIterations) {
    if (!Number.isInteger(maxIterations) || maxIterations <= 0) {
        return ''; // unlimited — no ceiling pressure to inject
    }
    const remaining = maxIterations - currentIteration;
    if (remaining > 1) return ''; // only inject in the final window

    const intro =
        remaining <= 0
            ? `This is iteration ${currentIteration} of ${maxIterations} — the FINAL iteration. No further retries are scheduled after this round.`
            : `This is iteration ${currentIteration} of ${maxIterations}. Only 1 iteration remains after this one.`;

    return (
        '\n\nITERATION CONTEXT — PLEASE READ CAREFULLY\n\n' +
        intro + '\n\n' +
        'Your verdict on this round is the loop\'s last-line defense before ' +
        'this code ships to real users. Take a deep breath and review with ' +
        'extra rigour. I am relying on your careful judgment — a thorough ' +
        'call now prevents a costly production bug later.\n\n' +
        'Apply your highest standard: be decisive on Critical and Important ' +
        'findings, do NOT soften genuine problems, and do NOT emit the ' +
        '`<promise>APPROVAL</promise>` token unless the code genuinely meets ' +
        'the bar. Absence of a clean verdict is itself a signal to continue ' +
        'iterating; a premature approval here becomes tomorrow\'s incident.\n\n' +
        'This matters. Please do your best work.'
    );
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
}
