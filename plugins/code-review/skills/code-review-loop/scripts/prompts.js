'use strict';

/**
 * Centralized prompt fragments for the code-review loop.
 *
 * Compression pass: every clause in evals/prompts-ab-test/contracts.json
 * is preserved verbatim or paraphrased; see that file for the A/B test
 * coverage matrix. Do NOT add prose without a corresponding contract
 * clause or you bypass the regression harness.
 */

// ---------------------------------------------------------------------------
// REVIEWER-side fragments
// ---------------------------------------------------------------------------

const APPROVAL_PROTOCOL_SUFFIX = `

---

LOOP TERMINATION PROTOCOL

You are the reviewer; only you can end this loop. The writer/fixer session never emits the terminator.

1. PASS (zero Critical, zero Important, ready to merge) → finish your report with this token alone on the FINAL line, nothing before or after it on that line:

       <promise>APPROVAL</promise>

2. NOT PASS → omit the raw tag entirely. Just list findings — absence is the "not yet" signal. If you must mention the token in prose, wrap it in backticks (\`<promise>APPROVAL</promise>\`) so the matcher cannot misfire. Never write phrases like "not APPROVAL" or "cannot approve yet" using the raw tag.

3. The stop hook checks YOUR report's final line, never the writer's messages. The loop continues until that line equals the literal terminator.
`;

function buildExclusionClause() {
    return (
        '\n\nREVIEW SCOPE — EXCLUSIONS\n\n' +
        'Silently skip these plugin state files if present in the diff ' +
        '(do NOT list as findings, do NOT affect verdict):\n' +
        '  - .claude/code-review.local.md\n' +
        '  - .claude/code-review.last-report.md\n' +
        '  - .copilot/code-review.local.md\n' +
        '  - .copilot/code-review.last-report.md'
    );
}

function buildDefaultScopeClause() {
    return (
        '\n\nREVIEW SCOPE — DEFAULT (CODE ONLY)\n\n' +
        'Review CODE only. Treat docs, READMEs, CHANGELOGs, ADRs, design ' +
        'notes, marketing copy, and prose as OUT OF SCOPE — do NOT list ' +
        'findings against them and do NOT block approval on issues found ' +
        'only in such files.\n\n' +
        'Judge semantically ("code/config/build logic vs human-facing ' +
        'prose?"), not by file extension. WHEN IN DOUBT, treat as code ' +
        '(missing real code is worse than a spurious finding).\n\n' +
        'Override: if the activation prompt explicitly asks you to review ' +
        'docs, then docs ARE in scope. Absent that, skip them.'
    );
}

function buildLoopContextSuffix(currentIteration, maxIterations) {
    if (!Number.isInteger(maxIterations) || maxIterations <= 0) return '';
    const remaining = maxIterations - currentIteration;
    if (remaining > 1) return '';

    const intro =
        remaining <= 0
            ? `This is iteration ${currentIteration} of ${maxIterations} — the FINAL iteration. No further retries are scheduled.`
            : `This is iteration ${currentIteration} of ${maxIterations} — only 1 iteration remains.`;

    return (
        '\n\nITERATION CONTEXT — PLEASE READ CAREFULLY\n\n' +
        intro + '\n\n' +
        'Take a deep breath and apply your highest standard. Be decisive ' +
        'on Critical and Important findings; do NOT soften genuine ' +
        'problems; do NOT emit `<promise>APPROVAL</promise>` unless the ' +
        'code truly meets the bar. Absence of a clean verdict is itself ' +
        'the signal to continue iterating.\n\n' +
        'This matters. Please do your best work.'
    );
}

// ---------------------------------------------------------------------------
// REVIEWER prompt composers
// ---------------------------------------------------------------------------

function composeInitialReviewerPrompt({ userPrompt, maxIterations }) {
  return (
    userPrompt +
    buildDefaultScopeClause() +
    buildExclusionClause() +
    buildLoopContextSuffix(1, maxIterations)
  );
}

function composeIterationPrompt({ base, head, iteration, maxIterations }) {
  return (
    `Review only the incremental changes in git range \`${base}..${head}\`. ` +
    `Run \`git diff ${base}..${head}\` to see exactly what changed since ` +
    `the previous iteration. Apply multi-axis review: correctness, ` +
    `quality, security, performance.` +
    buildDefaultScopeClause() +
    buildExclusionClause() +
    buildLoopContextSuffix(iteration, maxIterations)
  );
}

// ---------------------------------------------------------------------------
// WRITER-side text (Stop hook block-decision `reason`)
// ---------------------------------------------------------------------------

function buildIterationReason({ base, head, reviewerReport, reviewerModel }) {
  if (reviewerReport) {
    return [
      `Reviewer report for git range \`${base}..${head}\` — you are the writer/fixer, DO NOT conduct your own review; act only on this report.`,
      '',
      '---',
      reviewerReport,
      '---',
      '',
      'Then:',
      '  1. Fix every Critical and Important finding above.',
      '  2. DO NOT emit `<promise>APPROVAL</promise>` — that token is',
      '     reserved for the reviewer; the stop hook reads the persisted',
      '     report, not your messages.',
      '  3. Exit your turn — the stop hook either detects the reviewer\'s',
      '     APPROVAL or re-invokes the reviewer on the new diff.',
    ].join('\n');
  }
  return [
    `Reviewer could not be invoked for git range \`${base}..${head}\`.`,
    'Do NOT review the diff yourself. Do NOT emit the approval token.',
    'Retry the reviewer:',
    '',
    `  node \${CLAUDE_PLUGIN_ROOT}/skills/code-review-loop/scripts/copilot.js \\`,
    `    --prompt "Review incremental changes in git range ${base}..${head}" \\`,
    `    --model ${reviewerModel}`,
    '',
    'Fix what that report flags. Only the reviewer can terminate the loop.',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  APPROVAL_PROTOCOL_SUFFIX,
  buildExclusionClause,
  buildDefaultScopeClause,
  buildLoopContextSuffix,
  composeInitialReviewerPrompt,
  composeIterationPrompt,
  buildIterationReason,
};
