#!/usr/bin/env node

'use strict';

/**
 * Smoke test: prompt composition contracts.
 *
 * Verifies that every composer produces a string containing each required
 * clause. Catches accidental fragment drops from future refactors.
 */

const path = require('path');
const {
  APPROVAL_PROTOCOL_SUFFIX,
  READ_ONLY_CLAUSE,
  SCOPE_CLAUSE,
  composeInitialReviewerPrompt,
  composeIterationPrompt,
  buildIterationReason,
} = require(path.resolve(
  __dirname, '..', '..', 'skills', 'code-review-loop', 'scripts', 'prompts.js'
));

function assert(label, condition) {
  if (!condition) { process.stderr.write(`❌ FAIL: ${label}\n`); process.exit(1); }
  process.stdout.write(`✅ ${label}\n`);
}

// Initial reviewer prompt must contain user prompt + read-only + scope clauses.
{
  const out = composeInitialReviewerPrompt({
    userPrompt: 'review feature X',
    maxIterations: 3,
  });
  assert('initial: contains user prompt', out.includes('review feature X'));
  assert('initial: contains read-only clause', out.includes(READ_ONLY_CLAUSE.trim().split('\n')[0]));
  assert('initial: contains scope clause', out.includes('REVIEW SCOPE'));
  assert('initial: forbids Write/Edit/MultiEdit', /Write \/ Edit \/ MultiEdit/.test(out));
  assert('initial: forbids touching .claude/.copilot/.git', /\.claude\/, \.copilot\/, \.git\//.test(out));
  assert('initial: at iter 1 of 3 has no emotional-stimuli suffix',
    !out.includes('ITERATION CONTEXT'));
}

// Iteration prompt must contain git range + same clauses.
{
  const out = composeIterationPrompt({
    base: 'abc123',
    head: 'def456',
    iteration: 2,
    maxIterations: 3,
  });
  assert('iteration: contains base..head', out.includes('`abc123..def456`'));
  assert('iteration: contains read-only clause', out.includes('READ-ONLY'));
  assert('iteration: contains scope clause', out.includes('REVIEW SCOPE'));
  assert('iteration: at iter 2 of 3 has emotional-stimuli (1 retry left)',
    out.includes('ITERATION CONTEXT'));
}

// Final-iteration prompt
{
  const out = composeIterationPrompt({
    base: 'a',
    head: 'b',
    iteration: 3,
    maxIterations: 3,
  });
  assert('iteration: at iter 3 of 3 marked FINAL', /FINAL iteration/.test(out));
}

// Unlimited iterations → no emotional suffix.
{
  const out = composeIterationPrompt({
    base: 'a', head: 'b', iteration: 100, maxIterations: 0,
  });
  assert('unlimited: no emotional-stimuli suffix', !out.includes('ITERATION CONTEXT'));
}

// Approval protocol suffix is present and well-formed.
{
  assert('protocol: contains literal terminator',
    APPROVAL_PROTOCOL_SUFFIX.includes('<promise>APPROVAL</promise>'));
  assert('protocol: tells reviewer it is the sole terminator',
    APPROVAL_PROTOCOL_SUFFIX.includes('Only you'));
}

// buildIterationReason produces actionable writer instructions.
{
  const out = buildIterationReason({
    base: 'aaa', head: 'bbb',
    reviewerReport: 'Critical: foo broken.',
  });
  assert('reason: includes report', out.includes('Critical: foo broken'));
  assert('reason: forbids writer emitting APPROVAL',
    out.includes('Do NOT emit `<promise>APPROVAL</promise>`'));
  assert('reason: tells writer to commit fixes', out.includes('git commit'));
}

// buildIterationReason failure path.
{
  const out = buildIterationReason({
    base: 'a', head: 'b', reviewerReport: null,
  });
  assert('reason: failure message present', /invocation failed/.test(out));
}

process.stdout.write('\n🎉 Prompt composition smoke test passed.\n');
