---
name: cancel-review
description: Cancel an active code review loop
allowed-tools: ["Bash(test -f .claude/review-state.json:*)", "Bash(rm .claude/review-state.json:*)", "Read(.claude/review-state.json)"]
---

# Cancel Review

To cancel the active code review loop:

1. Check if `.claude/review-state.json` exists using Bash: `test -f .claude/review-state.json && echo "EXISTS" || echo "NOT_FOUND"`

2. **If NOT_FOUND**: Say "No active code review loop found."

3. **If EXISTS**:
   - Read `.claude/review-state.json` to get the current `iteration` value
   - Remove the file using Bash: `rm .claude/review-state.json`
   - Report: "Cancelled code review loop (was at iteration N)" where N is the iteration value
