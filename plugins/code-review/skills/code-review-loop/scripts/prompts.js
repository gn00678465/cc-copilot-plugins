'use strict';

/**
 * Centralized prompt fragments for the code-review loop.
 *
 * Phase A — consolidation only. Strings are moved here byte-for-byte from
 * their previous inline locations in copilot.js / iterate.js / reviewer.js /
 * session-stop.js so behavior is identical. Future compression passes (Phase
 * B+) live here too, gated by end-to-end verification because some fragments
 * are hardened against subtle Copilot CLI / approval-detection failure modes
 * (see commit history for `4a6c618` and the approval-detection handoff).
 *
 * Two audiences for the strings here:
 *
 *   1. REVIEWER-side prompts (sent to the Copilot CLI subagent):
 *        APPROVAL_PROTOCOL_SUFFIX
 *        buildExclusionClause()
 *        buildDefaultScopeClause()
 *        buildLoopContextSuffix(currentIteration, maxIterations)
 *        composeInitialReviewerPrompt({ userPrompt, maxIterations })  ← iter 1
 *        composeIterationPrompt({ base, head, iteration, maxIterations })
 *                                                                    ← iter 2+
 *
 *   2. WRITER-side text (injected back into the Claude session via the Stop
 *      hook's block-decision `reason`):
 *        buildIterationReason({ base, head, reviewerReport, reviewerModel })
 *
 * UI strings — banners, help text, error messages, stderr operational
 * notices — stay in their respective files. They are not LLM prompts and
 * centralizing them adds churn without buying anything.
 */

// ---------------------------------------------------------------------------
// REVIEWER-side fragments
// ---------------------------------------------------------------------------

// Loop-termination protocol injected into every reviewer prompt.
//
// Contract: the Copilot reviewer is the ONLY party allowed to emit the
// terminator tag. The stop hook matches it as the final non-empty line
// of the reviewer's report. The writer/fixer session never emits it —
// that prevents ambiguous reviewer prose (e.g. "not recommended to approve")
// from being misread into a false termination.
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

// Review scope exclusions
//
// The plugin writes its own state and the reviewer's persisted report into
// the project's dot-directory. If those paths happen to be tracked in git
// (e.g. a repo that commits .claude/), they will appear in `git stash create`
// snapshots and in `git diff <range>` output — and the reviewer will try to
// "review" them. This clause tells the reviewer to silently skip them.
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

// Default review scope — code only
//
// Hard rule: the reviewer must focus on code. Documentation, design notes,
// READMEs, CHANGELOGs, ADRs, and similar non-code artifacts are out of scope
// by default and must NOT generate findings. The user can override this on a
// per-loop basis by stating in the activation prompt that documentation (or
// a specific doc set) should be reviewed.
//
// Intentional non-enumeration: file extensions are not listed because the set
// is open-ended (every language adds more) and any list is wrong tomorrow.
// The reviewer judges semantically: "is this source code or text/prose?".
// When in doubt, treat it as code (false positive on review is recoverable;
// silent skip of real code is not).
function buildDefaultScopeClause() {
    return (
        '\n\nREVIEW SCOPE — DEFAULT (CODE ONLY)\n\n' +
        'By default, this loop reviews CODE only. Treat documentation, design ' +
        'notes, READMEs, CHANGELOGs, ADRs, marketing copy, and other prose / ' +
        'text-only artifacts as OUT OF SCOPE: do NOT list findings against ' +
        'them, do NOT let them affect your verdict, and do NOT block approval ' +
        'on issues found only in such files.\n\n' +
        'Judge semantically — "is this source code, configuration, or build ' +
        'logic that affects program behavior, or is it human-facing prose?" ' +
        'No file-extension allowlist is provided because the set of code file ' +
        'types is open-ended. WHEN IN DOUBT, treat the file as code and review ' +
        'it; missing real code is worse than a spurious finding.\n\n' +
        'Override: if the writer\'s ORIGINAL ACTIVATION PROMPT explicitly asks ' +
        'you to review documentation (or specific docs), then docs ARE in scope ' +
        'for this loop. Absent such an explicit instruction, skip them.'
    );
}

// Emotional stimuli near the iteration cap
//
// As the loop approaches its --max-iterations ceiling, the reviewer's verdict
// becomes higher-stakes: there are few (or zero) remaining retries to catch
// mistakes. We append "emotional stimuli" context to the prompt in the final
// 1–2 iterations only. Research on EmotionPrompt (Li et al., 2023) suggests
// this can improve accuracy and decisiveness on reasoning tasks.
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

// ---------------------------------------------------------------------------
// REVIEWER prompt composers
// ---------------------------------------------------------------------------

// Iteration 1 reviewer prompt = user prompt + default code-only scope +
// exclusion clause for our own state files + (conditionally) emotional-
// stimuli context when the requested max_iterations puts this first round
// near the cap. The APPROVAL_PROTOCOL_SUFFIX is appended later by
// copilot.js's wrapReviewerPrompt at spawn time.
function composeInitialReviewerPrompt({ userPrompt, maxIterations }) {
  return (
    userPrompt +
    buildDefaultScopeClause() +
    buildExclusionClause() +
    buildLoopContextSuffix(1, maxIterations)
  );
}

// Iteration 2+ reviewer prompt — assembled from four fragments:
//   1. The range-focused review instruction (base..head).
//   2. buildDefaultScopeClause() — predefault code-only scope.
//   3. buildExclusionClause() — tells the reviewer to skip the plugin's own
//      state files if they happen to be tracked in git.
//   4. buildLoopContextSuffix() — injects emotional-stimuli context on the
//      final 1–2 iterations to lift reviewer rigour.
function composeIterationPrompt({ base, head, iteration, maxIterations }) {
  return (
    `Review the incremental changes in this git range: \`${base}..${head}\`.\n\n` +
    `Run \`git diff ${base}..${head}\` to see exactly what changed ` +
    `since the previous review iteration. Apply the same multi-axis ` +
    `review (correctness / quality / security / performance) focused ` +
    `ONLY on these changes.` +
    buildDefaultScopeClause() +
    buildExclusionClause() +
    buildLoopContextSuffix(iteration, maxIterations)
  );
}

// ---------------------------------------------------------------------------
// WRITER-side text (Stop hook block-decision `reason`)
// ---------------------------------------------------------------------------

// Builds the `reason` text the Stop hook returns to Claude when blocking
// exit and rolling the next iteration. Two flavors based on whether the
// reviewer call succeeded.
function buildIterationReason({ base, head, reviewerReport, reviewerModel }) {
  if (reviewerReport) {
    return [
      `The Copilot reviewer produced the following report for git range \`${base}..${head}\`.`,
      `You are the writer/fixer — DO NOT conduct your own review; act only on this report.`,
      '',
      '---',
      reviewerReport,
      '---',
      '',
      'Your job now:',
      '  1. Fix every Critical and Important finding above.',
      '  2. DO NOT emit `<promise>APPROVAL</promise>` yourself — that token',
      '     is reserved for the reviewer. The stop hook inspects the',
      '     persisted reviewer report, not your messages.',
      '  3. When done, exit your turn; the stop hook will either detect',
      '     the reviewer\'s APPROVAL on its next check or re-invoke the',
      '     reviewer on the new diff for another iteration.',
    ].join('\n');
  }
  return [
    `The Copilot reviewer could not be invoked for git range \`${base}..${head}\`.`,
    'Do NOT review the diff yourself. Do NOT emit the approval token.',
    'Re-invoke the reviewer by running:',
    '',
    `  node \${CLAUDE_PLUGIN_ROOT}/skills/code-review-loop/scripts/copilot.js \\`,
    `    --prompt "Review incremental changes in git range ${base}..${head}" \\`,
    `    --model ${reviewerModel}`,
    '',
    'Then fix what that report flags. Only the reviewer can terminate the loop.',
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
