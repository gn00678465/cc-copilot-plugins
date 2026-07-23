# Advisor

*[English](README.md) | [繁體中文](README.zh-TW.md)*

**The smartest model runs the show. Cheaper models do the typing.**

Claude Code lets every subagent run on a different model — and lets the session itself run on a different model than its subagents. This plugin exploits that with the **architect pattern**: your session runs on **Fable 5**, Anthropic's most capable model, acting as a full-time architect. It owns requirements, decomposition, specs, and verification — and routes every implementation task to the cheapest adequate lane:

| Lane | Producer | Invocation | Route here when |
|---|---|---|---|
| Routine | **Grok 4.5** | `grok-implementer` agent (default) | The spec fully determines the outcome — Grok does the typing via the [Grok CLI](https://x.ai/cli) |
| Cross-vendor | GPT-5.6 Sol (high reasoning) | `codex-implementer` agent | Correctness-critical, or you want a second independent implementation to compare |
| Judgment | Fable 5 (→ Opus 4.8 if unavailable) | `claude-advisor` agent | Commitment boundaries — see below |

Tokens route by volume: the expensive model emits the fewest tokens (judgment and specs), cheap lanes emit the most (code). Implementation mechanics are ~90% of a session's tokens and Grok 4.5 handles them at near-parity — so this runs far cheaper than Fable-for-everything, and every implementation comes from a *different model family* than the architect that reviews it: cross-vendor review is built into the routing, not bolted on. For high-stakes work, race `grok-implementer` and `codex-implementer` on the same spec — each lane in its own `git worktree`, never the shared tree — and let the architect pick the stronger diff.

The plugin ships the **orchestration skill** — the routing doctrine that teaches the session when to use each lane, the cost discipline that keeps the expensive model's own token volume minimal (emit judgment not volume, keep context lean, reason once then hand off), the five-part spec contract that makes context-free delegation safe (plus a data-governance rule that keeps secrets and credentials out of what gets sent to the third-party `grok`/`codex` CLIs), and the verification rules that keep cheap lanes honest.

## Install

```
claude plugin marketplace add <your-org-or-path>/advisor
claude plugin install advisor@advisor
```

Updating an existing installation to the latest release:

```
claude plugin marketplace update advisor
claude plugin update advisor@advisor
```

Then start your session as the architect:

```
/model fable
```

**Lite mode — one file, 30 seconds.** Don't want the full pattern? Copy [`agents/claude-advisor.md`](agents/claude-advisor.md) into `~/.claude/agents/` and keep your session on Sonnet. You get advisor consults at commitment boundaries without the orchestration layer (see "Advisor-only mode" below).

## Requirements

- **Claude Code ≥ 2.1.170** with a subscription that includes Fable 5 (Pro, Max, Team, or Enterprise — all current consumer plans qualify).
- **No Fable access at all** (e.g. API-key billing)? Use `/model opus` for the session and change `model: fable` → `model: opus` in the advisor file. Same pattern, model tiers shift down one. (This is different from Fable being merely *unavailable* — the Judgment lane already degrades to Opus 4.8 automatically in that case, no edit needed.)
- **Grok lane (the default implementer):** the `grok-implementer` agent needs the [xAI Grok CLI](https://x.ai/cli) installed and authenticated (install from [x.ai/cli](https://x.ai/cli), then `grok login`). It drives **Grok 4.5** headlessly (`grok --prompt-file … -m grok-4.5`). Without it the agent reports `STATUS: unavailable` — it never silently falls back to a Claude model.
- **Codex lane (optional):** the `codex-implementer` agent needs the [OpenAI Codex CLI](https://github.com/openai/codex) installed and authenticated (`npm i -g @openai/codex`, then `codex login`). It invokes **GPT-5.6 Sol** as `gpt-5.6-sol` with `model_reasoning_effort=high`. GPT-5.6 access may be limited during preview; without model access, an installed/authenticated CLI, or successful authentication, the agent reports `STATUS: unavailable` and the other lanes remain unaffected.
- Heads-up: if a pinned Claude model isn't available on your account, Claude Code silently falls back to your session model — the pattern degrades quietly rather than erroring. If results feel unremarkable, check your plan. (This quiet fallback applies only to Claude model pins — the grok and codex lanes always fail loudly with a structured error.)

Model resolution order in Claude Code: `CLAUDE_CODE_SUBAGENT_MODEL` env var → per-invocation `model` parameter → agent frontmatter → session model.

## Use it

With the session on Fable, just ask for work — the orchestration skill routes it:

```
Add rate limiting to our public API. Design it, delegate the
implementation, and verify the evidence before you call it done.
```

The architect writes the spec, picks the lane (rate limiting touches concurrency — a good case for racing `grok-implementer` against `codex-implementer` and picking the stronger diff), reads the diff and verification evidence when the report comes back, and only then reports done.

To make the doctrine always-on, add one line to your project's `CLAUDE.md`:

```
You are the architect running the most expensive model — minimize your
own token volume. Delegate all implementation through the orchestration
skill's routing table (never type code yourself), delegate broad codebase
exploration to cheap read-only agents, and verify evidence before
accepting any lane's report.
```

**Pin the advisor model for one invocation** with `--advisor <fable|opus>`, bypassing the Fable-first default:

```
/orchestration --advisor opus fix the checkout race
```

This only pins which model runs `claude-advisor` (the Judgment lane) — `grok-implementer` and `codex-implementer` are producers, not advisors, so there's no equivalent flag for forcing one of them; say so directly in the task text instead (e.g. "use grok-implementer for this"). See the orchestration skill's "Overriding the advisor model" section for details.

## Beyond Claude Code

`agents/*.md` are Claude Code subagent definitions — only Claude Code's Agent tool can load them. If your session itself runs inside a different CLI (Codex, Grok, or any non-Claude-Code shell):

- For `claude-advisor`, use the bundled script: `node scripts/dispatch-claude-advisor.js <briefFile> [model] [fallbackModel]`. Loading the advisor's persona onto a bare `claude -p` subprocess is a real mechanical problem (system-prompt injection, model-fallback detection), so it gets a dedicated script rather than being reconstructed per call. It prints one line of JSON status (`{"status": "complete"|"timeout"|"invocation_error"|"unavailable", "outputFile": ..., "modelUsed": ..., "degraded": ...}`) and never reads the diff, re-runs verification, or writes a report — that stays the architect's job, exactly as after an Agent-tool dispatch.
- For `codex-implementer` — and any read-only codex review pass — use the bundled dispatcher: `node scripts/dispatch-codex.js <specFile> [--mode implement|review] [--timeout <s>] [--pidfile <path>]`. The spec text *is* the whole prompt, but the process lifecycle isn't simple: the script closes codex's stdin after the spec (an inherited open pipe hangs `codex exec` forever), enforces the deadline in-process, kills the whole process tree on expiry or cancel, and records the child PID for safe re-dispatch. Hand-constructed `codex exec` calls are forbidden on every host.
- For `grok-implementer`, there's no script — `grok --prompt-file` reads the spec from a file (no stdin hazard), so construct the CLI call directly from the recipe in `agents/grok-implementer.md`.

## Commitment boundaries

Even the architect gets a second opinion. The `claude-advisor` agent is a read-only skeptic — consulted before architecture decisions, migrations, API designs, and whenever a problem has resisted two attempts. It reads your actual code and returns a verdict in under 300 words. It never implements. Running it from a Fable session still pays: it sees the code fresh, without your conversation's accumulated assumptions.

**Lean consult brief — paths, not file bodies.** The orchestration skill's **consult contract** is the judgment counterpart to the implementer **spec contract**. Pass all five of Decision, Constraints, Options, Stakes, and Pointers (≤8 paths/symbols). Do not dump conversation history, full files, or tool logs; the advisor opens the listed paths itself and rejects incomplete briefs as `INVALID BRIEF`. After the verdict, the architect must emit `DISPOSITION: ADOPT | REJECT | RECONSULT — <evidence>` — silent ignore is a process failure. RECONSULT is capped at two rounds per decision; a third round means deciding unilaterally instead, so an indefinitely reconsultable decision can't defeat the cost discipline this pattern exists to enforce. Consult verification is those three gates (brief ready → usable verdict → disposition); implementation still needs the architect to **re-run** verification commands (not only read the lane's quote).

## Advisor-only mode (the original pattern)

The inverse arrangement, for when you'd rather keep the session cheap: run the session on Sonnet and consult `claude-advisor` only at commitment boundaries.

```
Migrate our checkout sessions from Postgres to Redis — plan it,
consult your advisor before committing (lean brief: decision, options,
constraints, stakes, file pointers), then implement.
```

A typical consult costs cents. To make it automatic, add to your project's `CLAUDE.md`:

```
Before committing to any architecture decision, migration, or refactor
touching 3+ files, consult the claude-advisor agent with the consult
contract (Decision, Constraints, Options, Stakes, Pointers — no file
dumps), act on its verdict or surface disagreement (disposition), then
continue.
```

## FAQ

**Is this Anthropic's "advisor tool"?** No — that's a server-side API feature. These are plain Claude Code subagents plus a skill: readable, editable, no beta flags.

**Does this work on claude.ai?** No — subagent model routing is Claude Code only (CLI, desktop, VS Code, web).

**Why not just run everything on Fable?** You can. It's excellent. It's also the most expensive lane per token, and most of a session's tokens are implementation mechanics that the cheap lanes handle at near-parity. Spend the premium where judgment lives.

**Why Grok and GPT-5.6 Sol lanes in a Claude plugin?** Vendor diversity. Models from one family share blind spots; an independent implementation from a different lineage catches what same-family review misses — and with Claude as the architect, *every* diff now gets cross-vendor review for free. The architect stays Claude — the lanes are producers, not judges.

## Go deeper

I write [**Attention Heads**](https://attentionheads.substack.com/?utm_source=github&utm_medium=readme&utm_campaign=advisor) — deep, evidence-backed writing on AI, cognition, and agentic engineering. The **Agentic Engineering Field Notes** series is where I publish practical advice on the craft of using AI. [Subscribe](https://attentionheads.substack.com/subscribe?utm_source=github&utm_medium=readme&utm_campaign=advisor) to get new posts to your inbox.

## License

MIT
