---
name: code-review-loop
description: Orchestrates a separate Copilot CLI reviewer in an automated review-fix loop so the author is never the reviewer. Use before merging any change, or when code written by yourself, another agent, or a human needs an independent review. Your role inside this loop is strictly writer-fixer — you MUST NOT conduct the review yourself and you MUST NOT emit the approval token; only the external reviewer can end the loop.
argument-hint: "PROMPT [--max-iterations N] [--model MODEL_NAME] [--mode claude|copilot]"
---

# Code Review Loop

## Purpose — separation of writer and reviewer

This skill exists to **separate the code author from the code reviewer** so a model never referees its own game. Inside this loop:

- **Reviewer** = Copilot CLI subagent, spawned by the plugin scripts.
- **Writer / fixer** = *you*, the model running this Claude Code session.

These roles MUST NOT blend. A writer who reviews their own work defeats the entire purpose of the loop.

## Who ends the loop

**Only the reviewer.** The Copilot reviewer is the *sole* party authorized to emit the terminator token:

```
<promise>APPROVAL</promise>
```

The plugin injects a protocol into every reviewer prompt instructing Copilot to emit that token — and only that token — on a line of its own when the iteration passes review. The reviewer's full output is persisted to `.<mode>/code-review.last-report.md`. The stop hook inspects **that file**, not your messages, when deciding whether to terminate.

This design exists because reviewer prose routinely contains ambiguous phrasing — *"approve next round"*, *"not recommended to approve"*, *"pending approval"* — that a naive writer could misread into a false termination. By making the raw terminator a reviewer-exclusive signal, ambiguity in prose can never end the loop.

## Hard rules — MUST NOT violate

Inside this loop you are forbidden from:

1. **Conducting your own code review.** Do not analyze the diff for issues. Do not render verdicts across correctness / quality / security / performance. Do not list "findings" of your own.
2. **Writing review-shaped output.** Do not produce `Critical` / `Important` / `Suggestion` / `Nit` sections. Only the Copilot reviewer produces those.
3. **Pre-empting or paraphrasing the reviewer's verdict.** Wait for Copilot's report. Relay it if useful, do not rewrite it.
4. **Emitting `<promise>APPROVAL</promise>`, ever, in any form.** Not as a literal tag, not in backticks-quoted form that could be grepped out of context, not copy-pasted from the reviewer's report, not as a summary. The stop hook ignores your messages anyway, so emitting it is pure noise — but doing so also signals role confusion.
5. **Skipping or short-circuiting the loop.** Exit your turn cleanly after fixing; the stop hook owns termination.

Warning signs you are about to violate these rules:

- You catch yourself thinking *"let me open these files and check for issues…"* → **STOP**.
- You catch yourself writing *"I reviewed the changes and found…"* → **STOP**.
- You catch yourself writing any string containing `<promise>` → **STOP**. That token is reviewer-exclusive.
- You catch yourself invoking Read / Grep / Glob to inspect the diff "just to double-check" the reviewer → **STOP**. Only read files the reviewer told you to modify.

If a rule conflicts with a heuristic urge to be helpful, the rule wins.

## Your role — writer / fixer only

At each iteration you may only:

1. **Read** the Copilot reviewer's report (arrives in your conversation; also on disk at `.<mode>/code-review.last-report.md`).
2. **Fix** every issue the reviewer flagged as `Critical` or `Important`.
3. **Exit your turn** — the stop hook then either detects the reviewer's `APPROVAL` in the persisted report and lets the session end, or re-invokes the reviewer on the new diff for another iteration.

Anything else — exploring on your own initiative, running ad-hoc quality checks, refactoring unrelated code — is out of scope for this loop.

## Preconditions

- Must be inside a git repository.
- `CLAUDE_PLUGIN_ROOT` must resolve to this plugin's root.
- `copilot` CLI must be installed and available on `PATH`.
- `--mode` selects the state directory: `claude` → `.claude/` (default), `copilot` → `.copilot/`.

## Setup

Execute the setup script to initialize the code review loop. **This is the only command you run for the review itself** — the script spawns the Copilot reviewer; you never review manually.

```!
node "${CLAUDE_PLUGIN_ROOT}/skills/code-review-loop/scripts/reviewer.js" $ARGUMENTS
```

## How the loop works

1. **Iteration 1** — `reviewer.js` invokes the Copilot reviewer with your prompt + an injected approval protocol. The reviewer's full output is streamed into your conversation *and* persisted to `.<mode>/code-review.last-report.md`.
2. **You fix** Critical / Important findings, then exit your turn.
3. **Stop hook** fires and, in order:
   1. Reads `.<mode>/code-review.last-report.md`. If its final non-empty line is `<promise>APPROVAL</promise>`, the loop ends cleanly and **state is cleared**.
   2. Otherwise, snapshots the new diff, re-invokes the Copilot reviewer on `git range: <base>..<head>` with the same approval protocol injected, and **overwrites** the report file with the new report. The new report is fed back to you as the next prompt.
4. **Exit** — the loop only *terminates and clears state* when the reviewer's latest report ends with the terminator token. If `--max-iterations` is reached without approval, the loop is **suspended**: state is preserved so you can run `/continue-loop --max-iterations <N>` to resume (raises the cap and immediately triggers the next review), inspect the state file manually, or run `/cancel-review` to discard it explicitly.

At every iteration the division of labour is:

- **Copilot reviewer** decides what to flag *and* whether to approve (by emitting the terminator).
- **You** decide what to fix.
- **Stop hook** reads the reviewer's report file and decides whether the loop continues.

## Approval semantics

You are not involved in the approval decision. You never emit the terminator. If the reviewer's report ends with the token, the loop ends on your next Stop event; if it does not, the hook re-invokes the reviewer.

If the reviewer's report seems to *describe* approval in natural language but does not end with the exact token on its own final line, the loop continues. This is intentional — prose is not a termination signal.
