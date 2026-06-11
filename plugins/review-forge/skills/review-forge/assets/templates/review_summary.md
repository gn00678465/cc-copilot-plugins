# Review Summary

- `command`: `synthesize`
- `feature`: <!-- feature folder name -->
- `target`: <!-- branch, PR, commit range, or working tree -->
- `base`: <!-- comparison ref -->
- `feature_dir`: `.review/<feature>/`
- `report_language`: <!-- auto | en | zh-CN | ... -->
- `created_at`: <!-- ISO 8601 timestamp -->
- `source_reports`: <!-- model review files used, e.g. codex.md, opencode.md, cursor.md -->

## Fix Approval Checklist

<!-- Checked means approved for fixing. Unchecked means do not fix yet. -->

- [ ] `RF-001`
  - `status`: `open`
  - `status_label`: <!-- localized label -->
  - `severity`: <!-- critical | high | medium | low | note -->
  - `reviewer_agreement`: <!-- e.g. 2/3 -->
  - `sources`: <!-- models that originally reported this finding, e.g. gpt-5.5, opus-4.6 -->
  - `affected_files`: <!-- file paths -->
  - `summary`: <!-- merged issue summary -->
  - `rationale`: <!-- why this matters -->
  - `proposed_fix`: <!-- specific intended fix -->
  - `suggested_tests`: <!-- tests to run after fixing -->

## Common Themes

<!-- Cross-cutting risks, repeated patterns, or root causes. -->

## Disagreements And Deferrals

<!-- Findings with reviewer disagreement, accepted risks, or reasons not to fix. -->
