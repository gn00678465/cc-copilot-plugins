---
name: review-forge
description: Use when orchestrating a code review workflow across multiple LLMs or agents, synthesizing review findings, cross-voting findings between models, producing confidence-ranked final reports, producing checklist-driven fix scopes, applying selected fixes, running regression tests, independently verifying fixes, updating review status, or keeping code review process artifacts isolated under .review/.
---

# Review Forge

Review Forge runs a conservative, feature-scoped code review workflow:

1. Inspect the target diff and project context.
2. Create one review file per model or agent inside the current feature folder.
3. Synthesize multiple model review files into a human-controlled checklist.
4. Cross-vote the synthesized findings: each model votes on every finding it did not originate.
5. Produce a final report ranked by severity and weighted vote confidence.
6. Fix only checked and confirmed items.
7. Run focused and regression tests after every fix batch.
8. Verify fixes independently when possible.
9. Update machine-readable status and localized report labels.
10. Keep all workflow artifacts isolated from product code.

## Commands

- `review`: create one model-specific review file. Do not modify product code.
- `synthesize`: merge model review files from one feature folder into one summary checklist. Do not modify product code.
- `vote`: one model votes on every `summary.md` finding it did not originate, writing one vote file. Do not modify product code.
- `report`: aggregate vote files into a confidence-ranked `final-report.md`. Do not modify product code.
- `fix`: read checked items from `final-report.md` when it exists, otherwise `summary.md`; confirm the selected scope, implement only those items, run tests, and update status.
- `verify`: verify fixed items with an independent perspective, rerun or inspect tests, and update verification status.

If the user does not specify a command, infer the safest command from the request. When ambiguous, default to `review`.

## Inputs

Resolve or ask for these inputs before doing work:

- `target`: branch, commit range, pull request, or current working tree.
- `base`: comparison branch or ref. If omitted, infer it using the default diff rules below.
- `artifact_root`: default `.review/`.
- `feature`: feature name used as the artifact subfolder. If omitted, infer from branch name, PR title, changed package, or a short sanitized summary of the diff.
- `feature_dir`: default `.review/<feature>/`.
- `command`: `review`, `synthesize`, `vote`, `report`, `fix`, or `verify`.
- `model`: model name for a review or vote file, such as `gpt-5.5`, `opus-4.6`, `gemini-3.5` or `sonnet-4.6`.
- `model_weights`: optional map of model name to vote weight, for example `gpt-5.5: 1.5`. Models not listed default to `1.0`.
- `report_language`: default `auto`, meaning follow the user's prompt language. Explicit values such as `en`, `zh-TW`, or `ja` are allowed.
- `auto_fix_allowed`: default `false` unless the user explicitly asks to fix.
- `perspective`: optional review focus, such as correctness, security, maintainability, tests, or UX.
- `test_command`: optional override for validation.

## Default Diff Rules

When the user does not specify a target or base, infer the review scope in this order:

1. If the working tree or index has uncommitted changes, review the uncommitted diff.
   - Inspect both unstaged and staged changes.
   - Treat this as `target: working tree`.
   - No base branch is required unless additional context is needed.
2. If there are no uncommitted changes, review the current `HEAD` against `main`.
   - Prefer a merge-base comparison such as `main...HEAD` when supported.
   - If `main` does not exist, try `master...HEAD`.
3. If neither `main` nor `master` exists, inspect branch tracking metadata or PR metadata when available.
4. Ask the user for `base` only when no reasonable comparison ref can be inferred.

Explicit user-provided PRs, branches, commit ranges, or base refs always override these defaults.

## Required Initial Inspection

Before producing artifacts or modifying code, inspect:

- repo status and uncommitted changes;
- target diff against the chosen base;
- existing `.review/` feature folders and review artifacts;
- `.gitignore` for `.review/`;
- package, build, and test configuration;
- project-specific instructions for tests, lint, typecheck, or CI.

Never revert unrelated user changes. If `.review/` is not ignored, recommend adding it to `.gitignore`, but do not edit `.gitignore` unless the user asks.

## Artifact Layout

Group every workflow by feature:

```text
.review/<feature>/
  <model>.md
  <model>-<perspective>.md
  summary.md
  <model>-vote.md
  final-report.md
  fix-plan.md
  verify.md
  status.md
```

Rules:

- One model review pass should produce exactly one review file.
- Name review files with the model or agent name first, for example `gpt-5.5.md`, `opencode.md`, `cursor.md`, `claude.md`.
- If the same model runs multiple perspectives, append a short perspective suffix, for example `gpt-5.5-security.md`.
- Do not include timestamps by default. Use stable names so the folder is easy to scan.
- Use timestamps only when preserving multiple historical runs is explicitly requested.

Command output boundaries:

- `review`: create or overwrite exactly one model review file, such as `gpt-5.5.md`. Do not create `summary.md`, `fix-plan.md`, `verify.md`, or `status.md`.
- `synthesize`: read model review files and create or overwrite `summary.md`. Do not create `status.md`.
- `vote`: create or overwrite exactly one vote file, such as `gpt-5.5-vote.md`. Do not create `final-report.md` or modify `summary.md`.
- `report`: read `summary.md` and all `*-vote.md` files, then create or overwrite `final-report.md`. Do not modify `summary.md` or vote files.
- `fix`: read checked items from `final-report.md` when it exists, otherwise `summary.md`; create or update `fix-plan.md`, and create or update `status.md` after code changes and tests.
- `verify`: create or update `verify.md` and update `status.md` with verification evidence.

Use the templates in `assets/templates/` unless the repository already has a stronger local convention.

## Review Collection

In `review` command, create a single file for the current model or agent. If the user does not provide `model`, infer it from the host when obvious; otherwise use a clear name such as `gpt-5.5`.

For multi-model workflows, each model should run `review` separately and write into the same `feature_dir`. Use distinct perspectives when helpful:

- correctness and edge cases;
- security and data safety;
- tests and regression risk;
- maintainability and architecture;
- product or UX behavior when relevant.

Each finding must include severity, evidence, affected files, risk, and a concrete suggested fix. Avoid vague style preferences unless they affect maintainability or user-facing behavior.

## Synthesize Command

In `synthesize` command, read review files from one `feature_dir` and produce `summary.md`:

- select all model review files in the folder by default;
- exclude `summary.md`, `*-vote.md`, `final-report.md`, `fix-plan.md`, `verify.md`, and `status.md`;
- merge duplicate findings;
- preserve meaningful disagreement;
- record reviewer agreement count;
- record `sources`: the models that originally reported each finding, required for vote abstention;
- include suggested tests;
- use checkboxes for human fix approval.

Checkbox semantics are stable:

- unchecked: not approved for fixing;
- checked: approved for fixing.

Do not fix unchecked issues opportunistically.

## Vote Command

In `vote` command, one model reads `summary.md` and votes on every finding, writing exactly one file named `<model>-vote.md`:

- vote independently: do not read other `*-vote.md` files or `final-report.md`;
- cast one vote per finding using the vote enums below;
- vote `abstain` on any finding whose `sources` includes the voting model;
- justify every `confirm` and `dispute` with concrete evidence from the code or diff, not from other reviews.

Vote enums (machine-readable, English):

- `confirm`: the finding is real and worth fixing.
- `dispute`: the finding is wrong, not reproducible, or not an issue.
- `unsure`: cannot confirm or refute with available evidence.
- `abstain`: the voting model originated this finding.

For multi-model workflows, each model runs `vote` separately into the same `feature_dir`, mirroring the `review` command pattern.

## Report Command

In `report` command, read `summary.md` and all `*-vote.md` files in the `feature_dir`, then produce `final-report.md`.

Confidence scoring:

- resolve each model's weight from `model_weights`; unlisted models default to `1.0`;
- `confidence_score` = (sum of `confirm` weights + 0.5 × sum of `unsure` weights) ÷ (total weight of non-abstain votes);
- `confidence`: `high` when score ≥ 0.7, `medium` when ≥ 0.4, `low` when < 0.4;
- when every vote is `abstain` or no votes exist, set `confidence: unvoted` and sort it after `low`.

Report rules:

- order findings by severity first, then confidence score descending;
- record per finding: which models voted `confirm`, `dispute`, `unsure`, or `abstain`, the originating `sources`, the computed score, and the fix recommendation;
- record the resolved model weights used for scoring;
- keep every checkbox unchecked: voting never grants fix approval, only humans check items;
- carry over each finding's `suggested_tests`.

If some expected models have not voted yet, list them as missing voters and compute confidence from available votes.

## Fix Rules

In `fix` command:

1. Read `final-report.md` from the selected `feature_dir` when it exists; otherwise read `summary.md`.
2. Select only checked items whose status allows fixing.
3. Confirm the fix scope unless the user already explicitly approved it.
4. Create or update `fix-plan.md`.
5. Modify only the files needed for selected items.
6. Run tests.
7. Update `status.md` and, when appropriate, the summary status fields.

If a checked item reveals a larger issue, stop and ask before expanding scope.

## Test Rules

Tests are mandatory after fixes unless impossible.

Run validation in this order:

1. The narrowest relevant test for the touched behavior, when discoverable.
2. Typecheck, lint, or build checks relevant to the touched files.
3. The broader project regression command when discoverable and reasonably scoped.

If tests cannot be run, record:

- status enum `test_blocked`;
- the command that should have run;
- the blocking reason;
- residual risk.

If tests fail, do not claim the item is fixed or verified. Mark affected items `verification_failed` or `partially_fixed`, record the failing command, and summarize the failure.

## Verification Rules

In `verify` command:

- verify from a perspective independent of the fixer when possible;
- check whether each selected issue was actually addressed;
- rerun or inspect test evidence;
- look for regressions caused by the fix;
- update status only when evidence supports it.

Verification requires either passing test evidence or a clear `test_blocked` explanation.

## Language Policy

Write skill instructions, template field names, and machine-readable status enums in English.

Generated prose reports should use `report_language`:

- `auto`: follow the user's prompt language;
- explicit language values: write prose in that language;
- keep status enums in English even inside localized reports.

Status display labels may be localized.

## Status Enums

Use these exact machine-readable status values:

- `open`
- `approved_for_fix`
- `fixed`
- `partially_fixed`
- `wont_fix`
- `risk_accepted`
- `verified`
- `verification_failed`
- `test_blocked`

Each status entry should include both:

- `status`: one enum above;
- `status_label`: localized human-readable label, for example `Fixed ✅` or `已修復 ✅`.

## Completion Criteria

A Review Forge workflow is complete only when:

- review artifacts are under `feature_dir`;
- checked items are the only fixed items;
- test evidence or `test_blocked` rationale is recorded after fixes;
- verification status does not overclaim;
- process artifacts remain isolated from product code.
