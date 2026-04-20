---
name: code-review-and-quality
description: Conducts multi-axis code review using an automated review-fix loop. Use before merging any change. Use when reviewing code written by yourself, another agent, or a human.
argument-hint: "PROMPT [--max-iterations N] [--model MODEL_NAME] [--mode claude|copilot]"
---

# Code Review and Quality

Execute the setup script to initialize the code review loop:

```!
node "${CLAUDE_PLUGIN_ROOT}/skills/code-review-and-quality/scripts/copilot.js" $ARGUMENTS
```

Use the **Agent** tool to dispatch the `code-review-master` subagent:
- `subagent_type`: `code-review-and-quality:code-review-master`
- `prompt`: the full review context — what changed, why, and any specific concerns

The subagent will conduct a five-axis review (correctness, readability, architecture, security, performance) and issue `> **Approval**` only when all Critical and Important findings are resolved.

CRITICAL RULE: Continue iterating and addressing all findings until the subagent issues `> **Approval**`. Do not attempt to end the session before genuine approval is received.
