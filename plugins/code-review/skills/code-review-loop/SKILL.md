---
name: code-review-loop
description: Use before merging any change, or when code written by yourself, another agent, or a human needs an independent review. Activates a separate Copilot CLI reviewer in a review-fix loop so the author never reviews themselves. Inside this loop you are strictly the writer-fixer — you MUST NOT conduct the review yourself and you MUST NOT emit the approval token; only the external reviewer can end the loop.
argument-hint: "PROMPT [--max-iterations N] [--model MODEL_NAME] [--mode claude|copilot]"
---

# Code Review Loop

## Roles

- **Reviewer** = Copilot CLI subagent (spawned by this plugin). Read-only.
- **Writer / fixer** = *you*. Edit-only.

The reviewer is the SOLE party that can end the loop, by emitting this token alone on the final non-empty line of its persisted report at `.<mode>/code-review.last-report.md`:

```
<promise>APPROVAL</promise>
```

The stop hook inspects that file. It never reads your messages.

## Hard rules — MUST NOT violate

1. **Never conduct your own review.** Do not analyze the diff, render verdicts, or list findings.
2. **Never write review-shaped output** (`Critical` / `Important` / `Suggestion` / `Nit` sections).
3. **Never emit `<promise>APPROVAL</promise>` in any form** — raw, backticked, quoted, or paraphrased. The stop hook ignores your messages, so emitting it is pure role confusion.
4. **Never read files to "double-check" the reviewer.** Touch only the files the reviewer told you to modify.
5. **Always commit before exiting.** Uncommitted diffs are snapshotted by `git stash create`, which can produce identical-tree stashes across iterations and leave the next reviewer pass empty.

## Your role each iteration

1. **Read** the reviewer's report (streamed in your conversation; also at `.<mode>/code-review.last-report.md`).
2. **Fix** every `Critical` and `Important` finding.
3. **Commit:** `git add <files> && git commit -m "fix: <short>"`.
4. **Exit your turn.** The stop hook then detects APPROVAL or re-runs the reviewer on the new diff.

## Default scope — code only

Docs, READMEs, CHANGELOGs, ADRs, design notes are out of scope by default. To include them, state it explicitly in your activation prompt (e.g. `/code-review-loop Review the docs in docs/api.md alongside the code`).

## Preconditions

- Inside a git repository.
- `CLAUDE_PLUGIN_ROOT` resolves to this plugin's root.
- `copilot` CLI on `PATH`.
- `--mode` selects state directory: `claude` → `.claude/` (default), `copilot` → `.copilot/`.

## Setup

The setup script spawns the reviewer — **this is the only command you run.** Never invoke a reviewer manually.

```!
node "${CLAUDE_PLUGIN_ROOT}/skills/code-review-loop/scripts/reviewer.js" $ARGUMENTS
```

If `--max-iterations` is reached without approval, the loop is **suspended**: state is preserved. Run `/continue-loop --max-iterations <N>` to raise the cap, or `/cancel-review` to discard.

See `docs/flow.md` for the full state-machine and isolation model.
