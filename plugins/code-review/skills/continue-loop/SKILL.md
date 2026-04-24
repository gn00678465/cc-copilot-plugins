---
name: continue-loop
description: Resume a suspended code review loop after it hit --max-iterations. Optionally raise the cap with --max-iterations N. Symmetric with /cancel-review — one extends the loop, the other discards it.
argument-hint: "[--max-iterations N]"
---

# Continue Loop

Resume a code-review loop that was suspended when `--max-iterations` was reached. Runs the Copilot reviewer on the writer's latest diff immediately, persists the new report, and atomically updates state (`iteration++`, optional new `max_iterations`, new `base_revision` / `head_sha`).

State lifecycle is unchanged: this command NEVER clears state. Only reviewer APPROVAL (detected by the stop hook) clears state. Use `/cancel-review` to discard explicitly.

## Usage

- `/continue-loop` — continue the loop at its current cap. Valid only when `iteration < max_iterations` and the writer has made new changes since the last review.
- `/continue-loop --max-iterations N` — raise the cap to `N` (absolute total, not additive) and immediately run the next review. `N` must be greater than the current `iteration`; `N = 0` means unlimited.

## Execute

Run the continue script with the user's arguments passed through:

```!
node "${CLAUDE_PLUGIN_ROOT}/skills/code-review-loop/scripts/continue.js" $ARGUMENTS
```

The script prints the reviewer report inline. After it returns, you (the writer / fixer) should:

1. Fix every `Critical` and `Important` finding the reviewer listed.
2. Exit your turn — the stop hook either detects `<promise>APPROVAL</promise>` in the persisted reviewer report or rolls the next iteration.

You MUST NOT emit `<promise>APPROVAL</promise>` yourself. The writer/reviewer separation defined by `/code-review-loop` still applies here.
