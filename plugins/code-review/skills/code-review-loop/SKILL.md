---
name: code-review-loop
description: Orchestrates a separate Copilot CLI reviewer in an automated review-fix loop so the author is never the reviewer. Use before merging any change, or when code written by yourself, another agent, or a human needs an independent review. Your role inside this loop is strictly writer-fixer — you MUST NOT conduct the review yourself and you MUST NOT emit the approval token; only the external reviewer can end the loop.
argument-hint: "PROMPT [--max-iterations N] [--model MODEL_NAME] [--mode claude|copilot]"
---

# Code Review Loop

## Roles

- **Reviewer** = external Copilot CLI subagent (spawned by this plugin).
- **Writer / fixer** = *you*, the current Claude Code session.

The reviewer is the SOLE party authorized to terminate the loop, by emitting this token alone on the final non-empty line of its report:

```
<promise>APPROVAL</promise>
```

The stop hook inspects the reviewer's persisted report at `.<mode>/code-review.last-report.md` — it never reads your messages.

## Hard rules — MUST NOT violate

1. **Never conduct your own review.** Do not analyze the diff, render verdicts, or list findings.
2. **Never write review-shaped output** (`Critical` / `Important` / `Suggestion` / `Nit` sections).
3. **Never emit `<promise>APPROVAL</promise>` in any form** — not raw, backticked, quoted, or copy-pasted from the reviewer. The stop hook ignores your messages, so emitting it is pure role confusion.
4. **Never read files to "double-check" the reviewer.** Only touch files the reviewer explicitly told you to modify.

## Your role each iteration

1. **Read** the reviewer's report (streamed to your conversation; also at `.<mode>/code-review.last-report.md`).
2. **Fix** every `Critical` and `Important` finding.
3. **Commit before exiting** — uncommitted changes are snapshotted by `git stash create`, which can produce identical-tree stashes across iterations and leave the next reviewer pass with an empty diff:
   ```bash
   git add <changed files>
   git commit -m "fix: <short description>"
   ```
4. **Exit your turn.** The stop hook then either detects `APPROVAL` in the persisted report and ends the loop, or re-invokes the reviewer on the new diff for another iteration.

## Default scope — code only

Documentation, READMEs, CHANGELOGs, ADRs, and similar prose are out of scope by default and will not block approval. To include them, state it explicitly in your activation prompt (e.g. `/code-review-loop Review the API doc updates in docs/api.md alongside the code changes`).

## Preconditions

- Inside a git repository.
- `CLAUDE_PLUGIN_ROOT` resolves to this plugin's root.
- `copilot` CLI installed on `PATH`.
- `--mode` selects state directory: `claude` → `.claude/` (default), `copilot` → `.copilot/`.

## Setup

The setup script spawns the reviewer — **this is the only command you run.** Never invoke a reviewer manually.

```!
node "${CLAUDE_PLUGIN_ROOT}/skills/code-review-loop/scripts/reviewer.js" $ARGUMENTS
```

If `--max-iterations` is reached without approval, the loop is **suspended**: state is preserved so you can run `/continue-loop --max-iterations <N>` to raise the cap, or `/cancel-review` to discard.
