'use strict';

/**
 * Centralised prompt fragments for the code-review loop.
 *
 * Single source of truth for everything the reviewer or writer reads.
 * Each clause is independent; composers stitch them in the right order.
 */

// Loop terminator protocol — appended last so it is the closing instruction.
const APPROVAL_PROTOCOL_SUFFIX = `

---

LOOP TERMINATION PROTOCOL

Only you (the reviewer) can end this loop. The writer/fixer never emits the terminator.

1. PASS (zero Critical, zero Important, ready to merge) → finish your report with this token ALONE on the FINAL line, nothing before or after on that line:

       <promise>APPROVAL</promise>

2. NOT PASS → omit the raw tag entirely. Just list findings; absence is the "not yet" signal. If you must mention the token in prose, wrap it in backticks (\`<promise>APPROVAL</promise>\`).

3. The stop hook checks YOUR report's final line, never the writer's messages.
`;

// Reviewer is read-only. The Copilot subagent runs with --allow-all-tools so
// this is enforced via prompt, not via tool-list whitelisting.
const READ_ONLY_CLAUSE = `

REVIEWER CONSTRAINT — READ-ONLY

You are a code reviewer with read-only authority over this workspace.

  - DO NOT use Write / Edit / MultiEdit to create, modify, or delete files.
  - DO NOT use Bash to run mutating commands (no commit, push, rm, mv, redirect, etc.).
  - DO NOT touch .claude/, .copilot/, .git/, or any source file.

You MAY use Read / Glob / Grep / git log / git diff / git show / git status to inspect.

Your ENTIRE output is your report on stdout. Anything that mutates the workspace is a contract violation and invalidates this review.
`;

// Code-only scope by default; plugin state files always excluded.
const SCOPE_CLAUSE = `

REVIEW SCOPE

Review CODE only. Docs / READMEs / CHANGELOGs / ADRs / design notes are OUT OF SCOPE — do NOT flag findings or block approval on prose. Override: if the activation prompt explicitly asks for docs, include them.

Silently skip these plugin state files if they appear in the diff (do NOT list, do NOT mention, do NOT let affect verdict):
  - .claude/code-review.local.md
  - .claude/code-review.last-report.md
  - .copilot/code-review.local.md
  - .copilot/code-review.last-report.md
`;

// Emotional-stimuli context for the final 1–2 iterations only.
function buildLoopContextSuffix(iteration, maxIterations) {
  if (!Number.isInteger(maxIterations) || maxIterations <= 0) return '';
  const remaining = maxIterations - iteration;
  if (remaining > 1) return '';

  const intro = remaining <= 0
    ? `Iteration ${iteration} of ${maxIterations} — the FINAL iteration; no retries after this.`
    : `Iteration ${iteration} of ${maxIterations} — only 1 retry remains.`;

  return `

ITERATION CONTEXT

${intro} Apply your highest standard. Be decisive on Critical / Important findings; do NOT soften genuine problems; do NOT emit \`<promise>APPROVAL</promise>\` unless the code truly meets the bar. This matters.
`;
}

function composeInitialReviewerPrompt({ userPrompt, maxIterations }) {
  return (
    userPrompt
    + READ_ONLY_CLAUSE
    + SCOPE_CLAUSE
    + buildLoopContextSuffix(1, maxIterations)
  );
}

function composeIterationPrompt({ base, head, iteration, maxIterations }) {
  return (
    `Review only the incremental changes in git range \`${base}..${head}\`. ` +
    `Run \`git diff ${base}..${head}\` to inspect exactly what changed since ` +
    `the previous iteration. Apply multi-axis review: correctness, quality, ` +
    `security, performance.`
    + READ_ONLY_CLAUSE
    + SCOPE_CLAUSE
    + buildLoopContextSuffix(iteration, maxIterations)
  );
}

// Stop-hook `reason` text fed back to the writer.
function buildIterationReason({ base, head, reviewerReport }) {
  if (reviewerReport) {
    return [
      `Reviewer report for git range \`${base}..${head}\` — you are the writer/fixer; act only on this report.`,
      '',
      '---',
      reviewerReport,
      '---',
      '',
      'Next:',
      '  1. Fix every Critical and Important finding.',
      '  2. `git add` + `git commit` the fixes (uncommitted diffs may snapshot empty).',
      '  3. Do NOT emit `<promise>APPROVAL</promise>`. The stop hook reads the reviewer report, not your messages.',
      '  4. Exit your turn — the stop hook will re-invoke the reviewer or detect APPROVAL.',
    ].join('\n');
  }
  return [
    `Reviewer invocation failed for git range \`${base}..${head}\`.`,
    'Do NOT review the diff yourself. Do NOT emit the approval token.',
    'Exit your turn again to retry; the stop hook re-invokes the reviewer.',
  ].join('\n');
}

module.exports = {
  APPROVAL_PROTOCOL_SUFFIX,
  READ_ONLY_CLAUSE,
  SCOPE_CLAUSE,
  buildLoopContextSuffix,
  composeInitialReviewerPrompt,
  composeIterationPrompt,
  buildIterationReason,
};
