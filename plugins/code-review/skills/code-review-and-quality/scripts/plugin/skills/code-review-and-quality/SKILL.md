---
name: code-review-and-quality
description: Conducts multi-axis code review using the code-review master agent. Applies five-axis review framework and issues Approval when all Critical and Important findings are resolved.
---

# Code Review and Quality

Invoke the `code-review` agent to conduct the review.

The `code-review` agent (at `${CLAUDE_PLUGIN_ROOT}/agents/code-review.agent.md`) will:
1. Apply the five-axis review: correctness, readability, architecture, security, performance
2. Use the performance and security skill references for deep-dive checks
3. Produce a structured review report with categorized findings
4. Issue **Approval** only when zero Critical and zero Important findings remain
