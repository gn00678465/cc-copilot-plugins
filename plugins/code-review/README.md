# code-review Plugin

Automated code review loop plugin for Claude Code. It keeps the **writer/fixer** role inside Claude Code separate from the **reviewer** role handled by a Copilot CLI subagent, so the author never reviews their own work.

The loop terminates only when the reviewer's persisted report ends with the exact terminator token on its final non-empty line:

```text
<promise>APPROVAL</promise>
```

## Prerequisites

- Claude Code with plugin support enabled
- `copilot` CLI installed and available on `PATH`
- A git repository (the loop snapshots diffs between iterations)

Verify Copilot CLI:

```bash
copilot --version
```

## Installation

Install the plugin from this marketplace repository:

```text
/plugin marketplace add gn00678465/cc-copilot-plugins
/plugin install code-review@cc-copilot-plugins
/reload-plugins
```

## Skills

### `/code-review-loop`

Starts the automated review-fix loop.

```text
/code-review-loop PROMPT [--max-iterations N] [--model MODEL_NAME] [--mode claude|copilot]
```

| Option | Default | Description |
|--------|---------|-------------|
| `PROMPT` | *(required)* | Review context, target scope, or specific concerns |
| `--max-iterations N` | `3` | Maximum review iterations before the loop is suspended; use `0` for unlimited |
| `--model MODEL_NAME` | `gpt-5.4` | Copilot model used by the reviewer subagent |
| `--mode claude\|copilot` | `claude` | State/report directory written by the scripts: `.claude\` or `.copilot\` |

**Examples**

```text
/code-review-loop Review the staged changes for quality
/code-review-loop Review the auth module for security issues --max-iterations 5
/code-review-loop Refactor cache layer --model gpt-5-mini --max-iterations 0
```

### `/continue-loop`

Continues a running or suspended loop — immediately re-runs the Copilot reviewer on the writer's latest diff, advances `iteration`, and optionally raises the cap. Symmetric with `/cancel-review`: one extends the loop, the other discards it.

```text
/continue-loop [--max-iterations N]
```

| Option | Default | Description |
|--------|---------|-------------|
| `--max-iterations N` | *(unchanged)* | New **absolute** cap (not additive). Required when the loop is already at its cap. `N = 0` means unlimited; otherwise `N` must be greater than the current `iteration`. |

**When to use**

- The loop was suspended after hitting `--max-iterations` and you want to resume it.
- The loop is still running under the current cap but you want to re-run the reviewer on new fixes now, without waiting for the Stop hook.
- You want to raise the cap mid-loop.

**Examples**

```text
/continue-loop
/continue-loop --max-iterations 5
```

State lifecycle is unchanged: `/continue-loop` **never clears state**. Only reviewer approval (detected by the Stop hook) clears state. Use `/cancel-review` to discard explicitly.

**Mode caveat.** The packaged Stop hook is wired for `--mode claude` only. If the loop was started with `--mode copilot`, `/continue-loop` still loads and advances state from `.copilot\code-review.local.md` correctly, but the Stop hook will not roll the next iteration automatically — wire the matching hook yourself (see the *Stop hook* section below).

### `/cancel-review`

Cancels an active loop and removes the plugin state/report files.

```text
/cancel-review
```

If no active loop exists, the skill reports that nothing is running. In the packaged plugin configuration, `/cancel-review` clears the default `.claude\code-review.local.md` and `.claude\code-review.last-report.md` files.

## Role separation

Inside `/code-review-loop` the roles are intentionally split:

- **Reviewer**: external Copilot CLI subagent
- **Writer / fixer**: the current Claude Code session

Only the reviewer is allowed to emit `<promise>APPROVAL</promise>`. The writer/fixer must only read the report, fix the flagged issues, and exit the turn so the Stop hook can decide whether to continue.

## How the loop works

1. `reviewer.js` creates `.<mode>\code-review.local.md` with YAML frontmatter and immediately invokes the Copilot reviewer.
2. The reviewer's full output is streamed back into the session and persisted to `.<mode>\code-review.last-report.md`.
3. You fix the reported `Critical` and `Important` findings, then end your turn.
4. When Claude Code tries to exit, `session-stop.js` runs:
   - If `code-review.last-report.md` ends with `<promise>APPROVAL</promise>` on its final non-empty line, the hook clears state/report files and allows exit.
   - If `--max-iterations` has been reached, the loop is **suspended** and state is preserved. Run `/continue-loop [--max-iterations N]` to resume, or `/cancel-review` to discard.
   - Otherwise, the hook snapshots the new diff, increments the iteration, re-runs the reviewer on `git diff <base>..<head>`, and overwrites the persisted report for the next round.
5. The cycle repeats until the reviewer approves or you explicitly cancel the loop.

## State files

The plugin stores loop state in `.<mode>\code-review.local.md` and the latest reviewer output in `.<mode>\code-review.last-report.md`.

Example state file:

```yaml
---
active: true
iteration: 2
max_iterations: 3
completion_promise: "APPROVAL"
started_at: "2026-04-23T08:52:12Z"
model: "gpt-5.4"
mode: "claude"
base_revision: "20a94c9902b594ae982cc58744478a61a5a378af"
head_sha: "ea21647a2a1d2e1a2dbcac48753b17373b6f3b2c"
initial_head: "20a94c9902b594ae982cc58744478a61a5a378af"
session_id: null
---

Review the staged changes for quality
```

`session_id` is bound at activation by the `UserPromptExpansion` hook (`bind-session.js`): when you type `/code-review-loop` or `/continue-loop`, the hook captures the session id and writes it to `.claude/code-review.pending-session.txt`; the slash command body consumes that sidecar and writes the value into state. If the hook didn't fire (older Claude Code, or hook not yet registered), `session_id` stays `null` and the plugin falls back to claim-on-first-stop — the first Stop event with a `session_id` then claims the loop. After binding, only the bound session may drive the loop forward; other sessions' Stop events are silently ignored. See *Diagnostics* below to verify or debug.

## Monitoring

```powershell
# Inspect current state
Get-Content .claude\code-review.local.md -TotalCount 20

# Inspect the latest reviewer report
Get-Content .claude\code-review.last-report.md -Tail 40
```

If you start the loop with `--mode copilot`, inspect `.copilot\` instead of `.claude\`.

## Stop hook

The plugin registers a Stop hook:

```text
node ${CLAUDE_PLUGIN_ROOT}/scripts/session-stop.js claude
```

The packaged hook reads `.claude\code-review.last-report.md` as the source of truth for approval. It does **not** inspect the writer/fixer's last message, which avoids false positives from quoted or paraphrased approval text.

If you want to run the loop against `.copilot\`, you must also wire the matching hook command yourself:

```text
node ${CLAUDE_PLUGIN_ROOT}/scripts/session-stop.js copilot
```

## Diagnostics

### `CODE_REVIEW_DEBUG` — debug missed APPROVAL detection

The Stop hook decides whether to terminate the loop by matching the **exact** terminator token on the final non-empty line of `.<mode>\code-review.last-report.md`. If the reviewer's report contains the token but the loop fails to terminate (forcing you to run `/cancel-review`), set `CODE_REVIEW_DEBUG=1` to dump the report tail before the match.

**Enable for one session:**

```powershell
$env:CODE_REVIEW_DEBUG = "1"
claude
```

```bash
CODE_REVIEW_DEBUG=1 claude
```

**Or persist via your shell profile** (`~/.bashrc`, `$PROFILE`, etc.) when actively investigating.

When set, the next Stop event prints to stderr:

```text
[debug] report bytes: <N>
[debug] last 4 lines (escaped): [...JSON-stringified array...]
[debug] last 128 bytes hex: <hex dump>
[debug] hasApprovalInReport result: true|false
```

`hasApprovalInReport result: false` while the hex tail clearly contains `<promise>APPROVAL</promise>` indicates a known-failure variant in the strict matcher. Compare the bytes immediately after `</promise>` (`3c2f70726f6d6973653e`) against:

| Trailing bytes | Meaning | Match? |
|----------------|---------|--------|
| *(nothing)* / `0a` / `0d 0a` | clean / `\n` / `\r\n` | ✅ |
| `0d` alone | lone `\r` (rare) | ❌ |
| `20` / `09` | space / tab | ❌ (intentional — see commit `4a6c618`) |
| `1b 5b ...` | ANSI escape sequence | ❌ |
| `e2 80 8b` / `ef bb bf` | zero-width space / BOM | ❌ |
| any printable on a new line after `0a` | reviewer added a footer line after the token | ❌ |

The default off behavior is preserved when `CODE_REVIEW_DEBUG` is unset.

### `CODE_REVIEW_DEBUG` — debug session-binding hook

If `.claude\code-review.local.md`'s `session_id` stays `null` after you start a loop (which leaves you on the legacy claim-on-first-stop path instead of activation-time binding), check whether the `UserPromptExpansion` hook is firing.

With `CODE_REVIEW_DEBUG=1`, `bind-session.js` appends a trace line to `.claude\code-review.bind-session.log` on every invocation. Each line records `expansion_type`, `command_name`, whether the host supplied `session_id`, and whether a sidecar was written:

```text
[2026-04-30T01:27:21.456Z] fire expansion_type=slash_command command_name=code-review-loop has_session=true
[2026-04-30T01:27:21.464Z] wrote sidecar session_id=<id>
```

If the file is missing entirely after `/code-review-loop`, the hook isn't being registered — typically that means the plugin needs a reload (`/plugin reload code-review` or restart Claude Code) so it picks up the updated `hooks/hooks.json`.

If the file shows a `fire` line but `has_session=false`, the host did not supply a session id in the hook input; the loop will fall back to claim-on-first-stop. If you see `command_name=` with an unexpected value, the host's command-naming convention doesn't match `code-review-loop` / `continue-loop`; report the value so the matcher can be widened.

## Roadmap

1. Fix `--mode copilot` so the packaged hook and related skills work out of the box with `.copilot\`.
2. Explore switching the reviewer invocation from the current CLI flow to `copilot --acp`.
