---
name: continue-loop
description: Continue a code review loop by resuming a suspended review, rerunning the reviewer on new changes, or raising the iteration cap with --max-iterations N. Use when asked to continue the review loop, resume a suspended review, rerun the reviewer after fixes, or raise the max-iterations limit.
argument-hint: "[--max-iterations N]"
hooks:
  UserPromptExpansion:
    - matcher: "continue-loop"
      hooks:
        - type: command
          command: "node ${CLAUDE_PLUGIN_ROOT}/skills/code-review-loop/scripts/bind-session.js"
---

# Continue Loop

Continue an existing `/code-review-loop`. Runs the Copilot reviewer on the writer's latest diff immediately, persists the new report, and atomically updates state (`iteration++`, optional new `max_iterations`, new `base_revision` / `head_sha`).

Symmetric with `/cancel-review` — this command extends the loop, the other discards it. State lifecycle is unchanged: this command NEVER clears state. Only reviewer APPROVAL (detected by the stop hook) clears state. Use `/cancel-review` to discard explicitly.

## When to invoke

- The loop was suspended after hitting `--max-iterations` and you want to resume it.
- The loop is still running under the current cap but you want to rerun the reviewer on new fixes right now, without waiting for the stop hook.
- You want to raise the cap mid-loop: `--max-iterations N` sets the new absolute total (not additive).

## Usage

- `/continue-loop` — run the next review at the current cap. Valid only when (`max_iterations == 0` or `iteration < max_iterations`) and the writer has made new changes since the last review.
- `/continue-loop --max-iterations N` — raise the cap to `N` (absolute total, not additive) and immediately run the next review. `N` must be greater than the current `iteration`; `N = 0` means unlimited.

## Execute

Run the skill-local entry point with the user's arguments passed through:

```!
node "${CLAUDE_PLUGIN_ROOT}/skills/continue-loop/scripts/continue.js" $ARGUMENTS
```

The script prints the reviewer report inline. After it returns, you (the writer / fixer) should:

1. Fix every `Critical` and `Important` finding the reviewer listed.
2. Exit your turn — the stop hook either detects `<promise>APPROVAL</promise>` in the persisted reviewer report or rolls the next iteration.

You MUST NOT emit `<promise>APPROVAL</promise>` yourself. The writer/reviewer separation defined by `/code-review-loop` still applies here.

## Mode caveat — `.copilot`

The packaged stop hook is wired for `--mode claude` only (state under `.claude/`). If the loop was started with `--mode copilot`, `/continue-loop` still loads and advances state from `.copilot/code-review.local.md` correctly, but the stop hook will not roll the next iteration automatically after your turn — you must wire the matching hook yourself, as described in the plugin README's *Stop hook* section. Running `/continue-loop` is safe in both modes; only the post-exit automation differs.
