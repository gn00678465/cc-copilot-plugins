---
name: orchestration
description: Routing doctrine for the architect-as-orchestrator pattern — how the session, whichever model it runs, delegates implementation to cheaper cross-vendor lanes to minimize cost. USE WHEN delegating implementation work, choosing between grok-implementer/codex-implementer lanes, writing a spec for a subagent, deciding whether to consult claude-advisor, managing session cost or token spend, or running any multi-task build where the session is the architect.
argument-hint: "[--advisor <fable|opus>] [<task>]"
---

# Orchestration — the architect's routing doctrine

The session is the architect: it owns requirements, architecture, decomposition, specs, routing, and verification. It should almost never type implementation code. Every implementation task gets routed to the cheapest lane that is adequate for it — escalation is deliberate, per task, never a fixed binding.

## Cost discipline — the prime directive

The session model is the most expensive lane in the system, on both input and output tokens. The whole economic case for this pattern is keeping its token volume low: spend Fable on judgment, spend Sonnet on volume. Three rules follow.

**Emit judgment, not volume.** The architect's output is decomposition, specs, routing decisions, verdicts on diffs, and short reports. It does not type implementation code, test bodies, boilerplate, or config files. A code block longer than an interface signature or a few illustrative lines is a spec that hasn't been delegated yet — stop and delegate it. Fixing a lane's bug by hand is the same failure in disguise: send a corrected spec back to the cheap lane instead.

**Keep the context lean.** Everything in the architect's context is re-read at architect prices on every turn. Delegate broad exploration, codebase searches, and log-grepping to a cheap read-only agent and keep only the conclusions; read files yourself only when the decision genuinely depends on the exact code. Don't paste long files, full diffs, or verbose command output into the conversation when a path reference or an excerpt will do.

**Reason once, then hand off.** Do the hard thinking — the architecture, the interface design, the debugging hypothesis — in one pass, capture it in the spec, and let the cheap lane carry it from there. Re-deriving decisions across turns burns the premium twice.

What stays with the architect regardless of cost: decomposition, interface design, hypothesis selection when debugging, spec writing, lane routing, and judging verification evidence. Those tokens are what the premium is for — everything else is a candidate for delegation.

## The lanes

| Lane | Producer | Invoke | Route here when |
|---|---|---|---|
| Routine | Grok 4.5 | `grok-implementer` agent | The spec fully determines the outcome: boilerplate, wiring, CRUD, mechanical edits, straightforward features. **Default lane.** Requires the [Grok CLI](https://x.ai/cli). |
| Cross-vendor | GPT-5.6 Sol (high reasoning) | `codex-implementer` agent | Correctness/completeness is critical enough to want a second implementation, or as the alternative family when the grok lane is unavailable. Requires the codex CLI. |
| Judgment | Fable 5 (→ Opus 4.8 if unavailable) | `claude-advisor` agent | Not an implementation lane. See "Commitment boundaries" below. |

Deciding rule: how much does the outcome depend on judgment the spec can't capture? Little → the default grok lane; you will verify anyway. A lot, and mistakes are costly → race both lanes on the same spec and pick the stronger diff, or keep that piece with the architect.

Grok vs codex is not a capability ranking — it's a failure-distribution question. Both are non-Anthropic families, so either lane's output gets genuine cross-vendor review from the Claude architect; racing them buys a *third* independent perspective for one extra lane's cost.

If a lane returns `unavailable` or `timeout`, re-route the same spec to the other lane and say so explicitly in your report — never quietly absorb the substitution. If both CLI lanes are unavailable, implement with a Claude subagent and state the downgrade plainly.

### Dispatching lanes outside Claude Code

`agents/*.md` are Claude Code subagent definitions — only Claude Code's Agent tool can load them. When the session itself is hosted inside a different CLI (Codex, Grok, or any shell that isn't Claude Code), none of the three lanes are reachable that way.

For `claude-advisor`, this skill ships `node "${CLAUDE_SKILL_DIR}/scripts/dispatch-claude-advisor.js" <briefFile> [model] [fallbackModel]` — worth a dedicated script because loading the advisor's persona onto a bare `claude -p` subprocess (system-prompt injection, model-fallback detection) is a real mechanical problem, not something to reconstruct per call. It takes the already-written consult brief as its first argument and prints exactly **one line of JSON**: `{"status": "complete"|"timeout"|"unavailable", "outputFile": "<path or null>", "modelUsed": "...", "degraded": true|false}`. It never reads the diff, never re-runs verification, and never writes a narrative report — that judgment stays with whichever model is running the architect turn, on `outputFile`'s contents, exactly as it would after an Agent-tool dispatch.

For `grok-implementer` and `codex-implementer`, there is no dispatch script — the spec contract already fully determines what to tell the CLI (the spec text *is* the prompt, no persona to load), so the architect on a non-Claude-Code host constructs the invocation directly from the recipe already documented in `agents/grok-implementer.md`/`agents/codex-implementer.md` (preflight check, exact CLI flags, timeout handling). Read the matching agent file for the command.

### Invoking claude-advisor

`claude-advisor` resolves to a read-only agent (Read/Grep/Glob only) fed the consult brief below. In Claude Code, dispatch it via the Agent tool (subagent). On a host without subagent dispatch, use `dispatch-claude-advisor.js` above — it reads `agents/claude-advisor.md` itself at runtime and passes its body as the CLI's `--system-prompt`, so the persona can't drift out of sync with the Agent-tool path. Either way, do not substitute a host's generic full-transcript advisor tool (e.g. Claude Code's `advisor()`) for this lane — it forwards the whole conversation and returns an anchored opinion, not the independent, pointers-only read this lane requires.

If Fable 5 is unavailable, degrade to Opus 4.8 and say so explicitly in the report and disposition — e.g. `fable unavailable → degraded to opus`. Under the Agent tool that means retrying the dispatch with `model: opus`; `dispatch-claude-advisor.js` does this natively in one call (`--model claude-fable-5 --fallback-model claude-opus-4-8`) and reports which model actually answered via `modelUsed`/`degraded` — read those fields rather than assuming success meant Fable ran. A degraded verdict is still usable, but it must never pass as an unqualified Fable judgment.

### Overriding the advisor model

Invoke this skill with `--advisor <fable|opus>` to pin which model runs `claude-advisor` for this invocation, bypassing the Fable-first default — e.g. `/orchestration --advisor opus fix the checkout race`. Run the bundled parser and read its JSON line — `{"advisorModel":"<model or empty>","userPrompt":"<remainder>"}`:

- POSIX: `sh "${CLAUDE_SKILL_DIR}/scripts/parse-args.sh" "$ARGUMENTS"`
- Windows: `pwsh -NoProfile -File "${CLAUDE_SKILL_DIR}/scripts/parse-args.ps1" "$ARGUMENTS"`

`userPrompt` is everything in `$ARGUMENTS` that isn't the matched `--advisor <model>` pair — treat it as ordinary task text, not further parsed. `advisorModel` only pins the Judgment lane — it has no bearing on implementation routing:

| `advisorModel` value | Effect |
|---|---|
| `fable` | Pin `claude-advisor` to Fable 5 — the default; only useful to state explicitly. |
| `opus` | Pin `claude-advisor` to Opus 4.8 for this invocation, without waiting for a Fable failure to trigger the degrade rule. |

Pass the value as the per-invocation `model` parameter on the Agent tool dispatch to `claude-advisor` (or as the `[model]` argument to `dispatch-claude-advisor.js`, outside Claude Code). When `advisorModel` is empty (no `--advisor` given), the Judgment lane defaults to Fable 5, degrading to Opus 4.8 on failure as usual.

`--advisor` has no equivalent for the Routine/Cross-vendor implementation lanes: `grok-implementer` and `codex-implementer` are producers, never advisors, so forcing one of them isn't a producer choice for the *advisor* — it's the Deciding rule's job (spec-dependent judgment, or an explicit race). To force a specific implementer for one invocation, say so directly in the task text (e.g. "use grok-implementer for this" or "race both lanes on this spec") — the architect reads that as part of the request, the same way it would read any other constraint in a task description.

This `$ARGUMENTS`-parsing convention is Claude Code–specific (this skill's own `agents/openai.yaml` carries no equivalent — Codex's skill spec documents no argument-passing or model-selection mechanism). Under Codex or Grok, there is no structural override either way: state the desired advisor model or implementer directly in the task text and read it from there.

## The spec contract

Implementers share none of your conversation context. Every delegation prompt carries all five parts:

1. **Objective** — what to build or change, one paragraph
2. **Files** — exact paths to create or modify
3. **Interfaces** — signatures, types, or API shapes the code must match
4. **Constraints** — project conventions, things not to touch
5. **Verification** — the command(s) that prove it works

Exclude secrets, credentials, and proprietary-sensitive content from what gets sent: `grok-implementer` and `codex-implementer` are third-party CLIs, and anything placed in a spec's Files/Interfaces/Constraints flows to them verbatim. If a file can't be shared with an external vendor, redact the sensitive part or keep that piece of work with the architect instead of delegating it.

A spec you can't finish writing is a signal the decision isn't made yet — that's architect work, not a reason to hand the ambiguity to a cheaper model.

## Parallelism

Independent specs (no shared files, no ordering dependency) launch as parallel agents in a single message. Sequential chains and single-file surgery stay serial. For high-stakes work, a pick-the-stronger-diff race — `grok-implementer` and `codex-implementer` on the same spec, architect judges — buys three-vendor confidence for one extra lane's cost.

## Commitment boundaries

Consult `claude-advisor` (read-only, verdict in under 300 words) at the moments that decide whether the next hour is wasted:

- Before committing to an architecture, data migration, API shape, or refactor strategy
- Whenever the same problem has resisted two distinct attempts
- Once before declaring a multi-step deliverable done

**Spec contract** packages context-free *implementation*. **Consult contract** packages *judgment*. Do not paste conversation history, full files, diffs, or tool logs into the advisor prompt — give pointers; the advisor reads the code itself. (If the session already runs on Fable, the advisor still earns its keep as a context-clean skeptic.)

### The consult contract

Every `claude-advisor` prompt carries these five parts (optional sixth when debugging after two failed attempts):

1. **Decision** — the choice that must be made, 1–3 sentences
2. **Constraints** — non-negotiables that would change the answer
3. **Options** — approaches under consideration, one line of tradeoff each
4. **Stakes** — what fails or is wasted if the choice is wrong (why this is a commitment boundary)
5. **Pointers** — exact paths and symbols to read (≤8). Paths and names only — **not** file bodies
6. **Tried** *(optional)* — one line per failed attempt; no log dumps

**Do not send:** full conversation history, full file contents, large diffs, tool-call logs, or prior advisor replies (unless this is an explicit RECONSULT with new facts).

A consult brief you cannot finish is a signal the decision is not framed yet — finish framing before calling the advisor.

### Consult verification (three gates)

Implementer verification is a command. Consult verification is **brief readiness → usable verdict → disposition**. All three are the architect's job.

**Gate A — Brief ready (before call).** Incomplete brief → do not call `claude-advisor`.

- [ ] Decision, Constraints, Options, Stakes, Pointers present
- [ ] No dump (history / full file / tool logs)
- [ ] Pointers are real paths/symbols the advisor can open

**Gate B — Verdict usable (on return).** No clear choice and no precise MISSING → treat as invalid; reconsult or decide without citing it as advisor-backed.

- [ ] Clear VERDICT (do X, not Y — or "plan is sound; watch X")
- [ ] Decisive risk named, **or** MISSING states what would change the answer and how
- [ ] Not `INVALID BRIEF` — that fails Gate A; complete the brief and call again (do not treat INVALID BRIEF as a usable verdict)

**Gate C — Disposition (required in the next architect turn).** Silent ignore is a process failure. Emit exactly one labeled line:

```text
DISPOSITION: ADOPT | REJECT | RECONSULT — <evidence>
```

| Disposition | Meaning | Evidence after the em dash |
|---|---|---|
| **ADOPT** | Follow the verdict | How the next spec or route changes |
| **REJECT** | Disagree | Why, including context the advisor did not have |
| **RECONSULT** | Need another pass | What MISSING fact was filled; then send a new consult brief |

RECONSULT is capped at **two rounds** per decision. If a third round would still be needed, stop reconsulting: decide unilaterally and say so — `DISPOSITION: RECONSULT capped — deciding unilaterally: <reasoning>`. An indefinitely reconsultable decision defeats the cost discipline this doctrine exists to enforce.

Chain when implementation follows: **consult (A+B) → disposition (C) → update Spec contract → implementer verification (commands)**. Passing consult does not pass implementation.

Before declaring a multi-step deliverable done: if `claude-advisor` was consulted, a `DISPOSITION:` line must exist; open RECONSULT or missing disposition means not done.

## Verification

Reports are claims, not evidence. Before accepting any lane's work: read the diff, and **re-run the verification command yourself**. Source inspection or the lane's quoted output is not a substitute. If re-running is impossible, mark verification incomplete and state why — do not accept the task as done. "Should work", "tests should pass", or a report with no command output means the task is not done. A lane that reports a spec gap gets a corrected spec, not a "use your judgment".

Consultations use the three gates under **Consult verification** above — not shell commands.
