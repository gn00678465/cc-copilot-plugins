# code-review Plugin

Professional code review loop plugin for Claude Code. Launches an automated review-fix cycle powered by a Copilot CLI subagent acting as the reviewer. The session keeps looping until the reviewer issues `<promise>APPROVAL</promise>` or the iteration limit is reached.

## Prerequisites

**Copilot CLI must be installed and available in `PATH` before using this plugin.**

The `code-review-and-quality` skill delegates the actual review work to the Copilot CLI. Without it the loop cannot start.

### Install Copilot CLI

Follow the official installation guide for your platform, then verify:

```bash
copilot --version
```

## Installation

Install the plugin via Claude Code:

```
/plugin marketplace add <path-to-cc-copilot-plugins>
/plugin install code-review@cc-copilot-plugins
/reload-plugins
```

## Skills

### `/code-review-loop`

Starts an automated review-fix loop.

**Syntax**

```
/code-review-loop PROMPT [--max-iterations N] [--model MODEL] [--mode claude|copilot]
```

| Option | Default | Description |
|--------|---------|-------------|
| `PROMPT` | *(required)* | Review context — what to review and any specific concerns |
| `--max-iterations N` | `0` (unlimited) | Stop automatically after N iterations |
| `--model MODEL` | `gpt-5.4` | Copilot model used by the reviewer subagent |
| `--mode claude\|copilot` | `claude` | Dot-directory to use for state (`.claude/` or `.copilot/`) |

**Examples**

```
/code-review-loop Review the staged changes for quality
/code-review-loop Review the auth module for security issues --max-iterations 5
/code-review-loop Refactor cache layer --model gpt-5-mini --max-iterations 10
```

**How the loop works**

1. `reviewer.js` writes session state to `.claude/code-review.local.md` and prints the startup banner.
2. The Copilot CLI subagent (`copilot.js`) runs with your prompt and the internal review plugin, conducting a five-axis review (correctness, readability, architecture, security, performance).
3. When you try to exit, the Stop hook (`session-stop.js`) intercepts:
   - If the reviewer output contains `<promise>APPROVAL</promise>` → session ends cleanly.
   - Otherwise → iteration counter increments and the same prompt is fed back for the next round.
4. The loop exits when Approval is received or `--max-iterations` is reached.

**Completion signal**

The reviewer subagent must output this exact tag to approve:

```
<promise>APPROVAL</promise>
```

### `/cancel-review`

Cancels an active review loop immediately.

```
/cancel-review
```

Removes `.claude/code-review.local.md` and reports the iteration the loop was cancelled at. Safe to call even when no loop is active.

## Monitoring

```bash
# Check current iteration and state
head -10 .claude/code-review.local.md

# Watch state file live
Get-Content .claude/code-review.local.md -Wait   # PowerShell
```

The state file uses YAML frontmatter:

```yaml
---
active: true
iteration: 2
max_iterations: 5
completion_promise: "APPROVAL"
started_at: "2026-04-21T00:00:00Z"
---

Your original prompt here
```

## Stop Hook

The plugin registers a Stop hook that runs automatically when Claude Code exits:

```
node ${CLAUDE_PLUGIN_ROOT}/scripts/session-stop.js claude
```

The hook reads `.claude/code-review.local.md`, checks the last assistant message for the Approval tag, and either allows exit or blocks it with a continuation prompt.
