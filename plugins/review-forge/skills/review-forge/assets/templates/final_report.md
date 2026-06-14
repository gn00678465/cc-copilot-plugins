# Final Review Report

- `command`: `report`
- `feature`: <!-- feature folder name -->
- `target`: <!-- branch, PR, commit range, or working tree -->
- `base`: <!-- comparison ref -->
- `summary_file`: `summary.md`
- `vote_files`: <!-- vote files used, e.g. gpt-5.5-vote.md, opus-4.6-vote.md -->
- `missing_voters`: <!-- expected models that have not voted, or none -->
- `model_weights`: <!-- resolved weights, e.g. gpt-5.5: 1.5, opus-4.6: 1.0 -->
- `report_language`: <!-- auto | en | zh-CN | ... -->
- `created_at`: <!-- ISO 8601 timestamp -->

## Fix Approval Checklist

<!-- Ordered by severity, then confidence_score descending; unvoted sorts after low. -->
<!-- Checked means approved for fixing. Voting never checks items; only humans do. -->

- [ ] `RF-001`
  - `status`: `open`
  - `status_label`: <!-- localized label -->
  - `severity`: <!-- critical | high | medium | low | note -->
  - `confidence`: <!-- high | medium | low | unvoted -->
  - `confidence_score`: <!-- e.g. 0.83 -->
  - `sources`: <!-- originating models -->
  - `votes`: <!-- confirm: [models] | dispute: [models] | unsure: [models] | abstain: [models] -->
  - `summary`: <!-- merged issue summary -->
  - `dispute_notes`: <!-- key dispute evidence, when any model disputed -->
  - `proposed_fix`: <!-- specific intended fix -->
  - `suggested_tests`: <!-- tests to run after fixing -->

## Confidence Overview

| Item | Severity | Confidence | Score | Confirm | Dispute | Unsure | Abstain |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `RF-001` | <!-- severity --> | <!-- tier --> | <!-- score --> | <!-- models --> | <!-- models --> | <!-- models --> | <!-- models --> |

## Likely False Positives

<!-- Findings with low or disputed confidence and why they are doubted. -->

## Residual Disagreements

<!-- Material conflicts between voters that humans should resolve. -->
