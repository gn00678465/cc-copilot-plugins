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

Now invoke the `code-review-and-quality` skill to begin the review. That skill will call the `code-review` agent to conduct the full five-axis review and issue **Approval** when all Critical and Important findings are resolved.

CRITICAL RULE: Continue iterating and addressing all findings until the `code-review` agent issues **Approval**. Do not attempt to end the session before genuine approval is received.
