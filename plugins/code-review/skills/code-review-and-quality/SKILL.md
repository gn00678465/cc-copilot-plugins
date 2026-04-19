---
name: code-review-and-quality
description: Conducts multi-axis code review using an automated review-fix loop. Use before merging any change. Use when reviewing code written by yourself, another agent, or a human.
argument-hint: "PROMPT [--max-iterations N] [--model MODEL_NAME]"
allowed-tools: ["Bash(node ${CLAUDE_PLUGIN_ROOT}/skills/code-review-and-quality/scripts/copilot.js:*)"]
---

# Code Review and Quality

Execute the setup script to initialize the code review loop:

```!
node "${CLAUDE_PLUGIN_ROOT}/skills/code-review-and-quality/scripts/copilot.js" $ARGUMENTS
```

Please work on the task. When you try to exit, the stop hook will invoke a Reviewer model to evaluate the code and either issue **Approval** or request specific changes.

CRITICAL RULE: Continue iterating and addressing all Critical and Important issues until the Reviewer issues **Approval**. Do not attempt to end the session before genuine approval is received.
