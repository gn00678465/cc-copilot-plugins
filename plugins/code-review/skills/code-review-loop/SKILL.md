---
name: code-review-loop
description: Conducts multi-axis code review using an automated review-fix loop. Use before merging any change. Use when reviewing code written by yourself, another agent, or a human.
argument-hint: "PROMPT [--max-iterations N] [--model MODEL_NAME] [--mode claude|copilot]"
---

# Code Review Loop

## Preconditions

- Must be inside a git repository.
- `CLAUDE_PLUGIN_ROOT` must resolve to this plugin's root.
- `--mode` selects the state directory: `claude` → `.claude/` (default), `copilot` → `.copilot/`.

## Setup

Execute the setup script to initialize the code review loop:

```!
node "${CLAUDE_PLUGIN_ROOT}/skills/code-review-loop/scripts/reviewer.js" $ARGUMENTS
```

## How the loop works

- **Iteration 1**: review using the original prompt above.
- **Iteration 2+**: the stop hook detects uncommitted or newly committed changes, then feeds you a focused git range prompt — `Review the incremental changes in git range: <base>..<head>` — so you review only what changed since the previous iteration.
- The loop exits when you output `<promise>APPROVAL</promise>` or the iteration limit is reached.

## Approval rule

Judge approval by the **content** of the review, not by waiting for a specific phrase:

- If the review contains any **Critical** or **Important** findings → fix them all and iterate again.
- If the review contains **only** Suggestion / Nit level findings (or no findings at all) → output `<promise>APPROVAL</promise>` to complete the loop.
- Do not output `<promise>APPROVAL</promise>` while any Critical or Important finding remains unresolved.
