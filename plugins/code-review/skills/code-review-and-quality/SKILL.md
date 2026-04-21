---
name: code-review-and-quality
description: Conducts multi-axis code review using an automated review-fix loop. Use before merging any change. Use when reviewing code written by yourself, another agent, or a human.
argument-hint: "PROMPT [--max-iterations N] [--model MODEL_NAME] [--mode claude|copilot]"
---

# Code Review and Quality

Execute the setup script to initialize the code review loop:

```!
node "code-review-and-quality/scripts/setup-ralph-loop.js" $ARGUMENTS
```

Please work on the task. When you try to exit, the Ralph loop will feed the SAME PROMPT back to you for the next iteration. You'll see your previous work in files and git history, allowing you to iterate and improve.

The subagent will conduct a five-axis review (correctness, readability, architecture, security, performance) and issue `> **Approval**` only when all Critical and Important findings are resolved.

CRITICAL RULE: Continue iterating and addressing all findings until the subagent issues `> **Approval**`. Do not attempt to end the session before genuine approval is received.
