---
name: cancel-review
description: Cancel an active code review loop
allowed-tools: ["Bash(test -f .claude/code-review.local.md:*)", "Bash(rm .claude/code-review.local.md:*)", "Bash(rm -f .claude/code-review.last-report.md:*)", "Read(.claude/code-review.local.md)"]
---

# Cancel Review

To cancel the active code review loop:

1. Check if `.claude/code-review.local.md` exists using Bash: `test -f .claude/code-review.local.md && echo "EXISTS" || echo "NOT_FOUND"`

2. **If NOT_FOUND**: Say "No active code review loop found."

3. **If EXISTS**:
   - Read `.claude/code-review.local.md` to get the current `iteration` value
   - Remove both the state file and the reviewer's persisted report:
     - `rm .claude/code-review.local.md`
     - `rm -f .claude/code-review.last-report.md`
   - Report: "Cancelled code review loop (was at iteration N)" where N is the iteration value
