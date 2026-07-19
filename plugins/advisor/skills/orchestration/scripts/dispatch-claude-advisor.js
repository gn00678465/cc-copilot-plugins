#!/usr/bin/env node
// Dispatch the claude-advisor lane for hosts without Claude Code's Agent tool
// (e.g. a session running inside the Codex or Grok CLI itself).
//
// Usage:
//   node dispatch-claude-advisor.js <briefFile> [model] [fallbackModel]
//
// <briefFile> holds the full consult contract (Decision, Constraints, Options,
// Stakes, Pointers) — the caller writes it, this script only reads it.
// [model] / [fallbackModel] default to claude-fable-5 / claude-opus-4-8.
//
// Prints exactly one line of JSON to stdout and always exits 0 — the caller
// reads the "status" field rather than the process exit code:
//   {"status":"complete","outputFile":"...","modelUsed":"claude-fable-5","degraded":false}
//   {"status":"complete","outputFile":"...","modelUsed":"claude-opus-4-8","degraded":true}
//   {"status":"timeout","outputFile":null}
//   {"status":"unavailable","reason":"claude CLI not found on PATH"}
//
// This script only dispatches and captures — it does not read the diff, does
// not re-run verification, and does not write a narrative report. That
// judgment stays with the calling architect, same as when this lane runs
// through Claude Code's Agent tool.

const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const TIMEOUT_MS = 600_000;
const MAX_BUFFER = 20 * 1024 * 1024;

function emit(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

const briefFile = process.argv[2];
const model = process.argv[3] || "claude-fable-5";
const fallbackModel = process.argv[4] || "claude-opus-4-8";

if (!briefFile) {
  emit({ status: "unavailable", reason: "no brief file path given" });
  process.exit(0);
}

let brief;
try {
  brief = fs.readFileSync(briefFile, "utf8");
} catch (err) {
  emit({ status: "unavailable", reason: `cannot read brief file: ${err.message}` });
  process.exit(0);
}

// A fresh `claude -p` subprocess cannot resolve --agent claude-advisor by name
// (plugin agents loaded into the *calling* interactive session are not
// visible to a subprocess) — so the persona has to be supplied as an
// explicit system prompt. Read it from the same agent file the Agent-tool
// path uses, rather than duplicating its text here, so the two dispatch
// paths can't drift apart.
const agentFile = path.join(__dirname, "..", "..", "..", "agents", "claude-advisor.md");

let systemPrompt;
try {
  const raw = fs.readFileSync(agentFile, "utf8");
  systemPrompt = raw.replace(/^---\n[\s\S]*?\n---\n/, "").trim();
} catch (err) {
  emit({ status: "unavailable", reason: `cannot read agent persona file: ${err.message}` });
  process.exit(0);
}

const outputFile = path.join(os.tmpdir(), `claude-advisor-final-${process.pid}-${Date.now()}.txt`);

let stdout;
try {
  stdout = execFileSync(
    "claude",
    [
      "-p",
      brief,
      "--system-prompt",
      systemPrompt,
      "--model",
      model,
      "--fallback-model",
      fallbackModel,
      "--allowedTools",
      "Read,Grep,Glob",
      "--output-format",
      "json",
      "--no-session-persistence",
    ],
    { timeout: TIMEOUT_MS, maxBuffer: MAX_BUFFER, encoding: "utf8" }
  );
} catch (err) {
  if (err.code === "ENOENT") {
    emit({ status: "unavailable", reason: "claude CLI not found on PATH" });
  } else if (err.killed || err.signal) {
    emit({ status: "timeout", outputFile: null });
  } else {
    emit({ status: "unavailable", reason: err.message });
  }
  process.exit(0);
}

let parsed;
try {
  parsed = JSON.parse(stdout);
} catch (err) {
  emit({ status: "unavailable", reason: `claude returned non-JSON output: ${err.message}` });
  process.exit(0);
}

const modelUsage = parsed.modelUsage || {};
const modelUsed = Object.keys(modelUsage)[0] || model;
const degraded = modelUsed !== model;

fs.writeFileSync(outputFile, parsed.result || "");

emit({ status: "complete", outputFile, modelUsed, degraded });
