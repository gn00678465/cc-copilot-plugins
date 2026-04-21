---
name: code-review-loop
description: Conducts multi-axis code review using an automated review-fix loop. Use before merging any change. Use when reviewing code written by yourself, another agent, or a human.
argument-hint: "PROMPT [--max-iterations N] [--model MODEL_NAME] [--mode claude|copilot]"
---

# Code Review Loop

Execute the setup script to initialize the code review loop:

```!
node "${CLAUDE_PLUGIN_ROOT}/skills/code-review-and-quality/scripts/reviewer.js" $ARGUMENTS
```

Please work on the task. When you try to exit, the code review loop will feed the SAME PROMPT back to you for the next iteration. You'll see your previous work in files and git history, allowing you to iterate and improve.

CRITICAL RULE: Judge approval by the **content** of the review report, not by waiting for a specific phrase:
- If the report contains any **Critical** or **Important** findings → fix them all and iterate again.
- If the report contains **only** Suggestion / Nit level findings (or no findings at all) → output `<promise>APPROVAL</promise>` to complete the loop.
- Do not output `<promise>APPROVAL</promise>` while any Critical or Important finding remains unresolved.
