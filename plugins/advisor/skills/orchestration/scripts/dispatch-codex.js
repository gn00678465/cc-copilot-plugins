#!/usr/bin/env node
// Dispatch a codex lane (`codex exec`) with owned process lifecycle.
//
// Every codex invocation in this skill — implementation lanes AND read-only
// review lanes — goes through this script. Do not hand-construct `codex exec`
// calls: the mechanical problems this script solves (structural stdin EOF,
// wall-clock deadline without a `timeout` binary, process-tree kill on
// cancel/expiry, PID recording for safe re-dispatch) are exactly the ones
// that prompt-level reminders have failed to solve in practice.
//
// Usage:
//   node dispatch-codex.js <specFile> [--mode implement|review] [--model <slug>]
//                          [--timeout <seconds>] [--cd <dir>] [--pidfile <path>]
//
// <specFile> holds the full prompt (the five-part spec, or a review brief).
// --mode implement (default) runs `--sandbox workspace-write`;
// --mode review runs `--sandbox read-only` and never writes files.
// --pidfile, when given, receives one JSON line at spawn time
// ({"pid":...,"startedAt":...}) so the caller can verify the child is dead
// before re-dispatching into the same working tree, even if this script is
// itself killed before it can report.
//
// Prints exactly one line of JSON to stdout and always exits 0 — the caller
// reads the "status" field rather than the process exit code:
//   {"status":"complete","outputFile":"...","pid":123,"exitCode":0,"elapsedMs":...}
//   {"status":"timeout","outputFile":"...","pid":123,"elapsedMs":...}          // deadline hit; tree killed
//   {"status":"invocation_error","reason":"...","pid":123,"exitCode":2,...}     // codex ran and failed
//   {"status":"unavailable","reason":"codex CLI not found on PATH"}             // codex never ran
// The four statuses are distinct on purpose: "timeout" always means THIS
// script enforced its deadline, "invocation_error" always means codex itself
// failed — a caller triaging a dead lane needs that attribution, not a
// collapsed catch-all.
//
// Mechanics this script guarantees:
// - stdin: the spec bytes are written to the child and the stream is closed.
//   The child NEVER inherits this process's stdin, so the known failure mode
//   (`codex exec` waiting forever on an open inherited pipe: "Reading
//   additional input from stdin...") is structurally impossible.
// - deadline: enforced in-process (default 600s). No dependency on a
//   `timeout`/`gtimeout` binary — the uncapped-when-missing fallback is gone.
// - kill: on deadline or on this script receiving SIGINT/SIGTERM, the whole
//   child process tree is killed (win32: `taskkill /T /F`; POSIX: process
//   group), not just the direct child.

const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const CODEX_BIN = process.env.CODEX_BIN || "codex";

function emit(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

// --- argument parsing -------------------------------------------------------

const argv = process.argv.slice(2);
const specFile = argv[0] && !argv[0].startsWith("--") ? argv[0] : null;
const opts = { mode: "implement", model: "gpt-5.6-sol", timeout: 600, cd: process.cwd(), pidfile: null };

for (let i = specFile ? 1 : 0; i < argv.length; i += 2) {
  const key = argv[i];
  const val = argv[i + 1];
  if (key === "--mode") opts.mode = val;
  else if (key === "--model") opts.model = val;
  else if (key === "--timeout") opts.timeout = Number(val);
  else if (key === "--cd") opts.cd = val;
  else if (key === "--pidfile") opts.pidfile = val;
  else {
    emit({ status: "unavailable", reason: `unknown option: ${key}` });
    process.exit(0);
  }
}

if (!specFile) {
  emit({ status: "unavailable", reason: "no spec file path given" });
  process.exit(0);
}
if (opts.mode !== "implement" && opts.mode !== "review") {
  emit({ status: "unavailable", reason: `--mode must be implement or review, got: ${opts.mode}` });
  process.exit(0);
}
if (!Number.isFinite(opts.timeout) || opts.timeout <= 0) {
  emit({ status: "unavailable", reason: `--timeout must be a positive number of seconds` });
  process.exit(0);
}

let spec;
try {
  spec = fs.readFileSync(specFile, "utf8");
} catch (err) {
  emit({ status: "unavailable", reason: `cannot read spec file: ${err.message}` });
  process.exit(0);
}

// --- spawn ------------------------------------------------------------------

const sandbox = opts.mode === "implement" ? "workspace-write" : "read-only";
const outputFile = path.join(os.tmpdir(), `codex-final-${process.pid}-${Date.now()}.txt`);

const args = [
  "exec",
  "--model", opts.model,
  "-c", "model_reasoning_effort=high",
  "--sandbox", sandbox,
  "--skip-git-repo-check",
  "--cd", opts.cd,
  "--output-last-message", outputFile,
  "-",
];

const startedAt = Date.now();
let child;
try {
  child = spawn(CODEX_BIN, args, {
    stdio: ["pipe", "ignore", "pipe"],
    // POSIX: own process group so the whole tree can be killed at once.
    detached: process.platform !== "win32",
  });
} catch (err) {
  emit({ status: "unavailable", reason: `cannot spawn ${CODEX_BIN}: ${err.message}` });
  process.exit(0);
}

if (opts.pidfile) {
  try {
    fs.writeFileSync(opts.pidfile, JSON.stringify({ pid: child.pid, startedAt }) + "\n");
  } catch (err) {
    // Non-fatal: the run proceeds, but say so in the final report.
    opts.pidfileError = err.message;
  }
}

// Structural EOF: write the spec, close the stream. Never inherit stdin.
child.stdin.on("error", () => {}); // child may exit before reading (e.g. ENOENT surfaced late)
child.stdin.write(spec);
child.stdin.end();

let stderrTail = "";
child.stderr.on("data", (chunk) => {
  stderrTail = (stderrTail + chunk.toString()).slice(-2000);
});

function killTree() {
  if (child.exitCode !== null || child.signalCode !== null) return;
  try {
    if (process.platform === "win32") {
      spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    } else {
      process.kill(-child.pid, "SIGKILL");
    }
  } catch {
    /* already gone */
  }
}

let timedOut = false;
const deadline = setTimeout(() => {
  timedOut = true;
  killTree();
}, opts.timeout * 1000);

// Cancelling the dispatcher must not orphan the codex tree.
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    killTree();
    clearTimeout(deadline);
    emit({ status: "invocation_error", reason: `dispatcher received ${sig}; child tree killed`, pid: child.pid, elapsedMs: Date.now() - startedAt });
    process.exit(0);
  });
}

child.on("error", (err) => {
  clearTimeout(deadline);
  const reason = err.code === "ENOENT" ? `${CODEX_BIN} CLI not found on PATH` : err.message;
  emit({ status: "unavailable", reason });
  process.exit(0);
});

child.on("exit", (code, signal) => {
  clearTimeout(deadline);
  const base = { pid: child.pid, elapsedMs: Date.now() - startedAt };
  if (opts.pidfileError) base.pidfileError = opts.pidfileError;
  if (timedOut) {
    emit({ status: "timeout", outputFile: fs.existsSync(outputFile) ? outputFile : null, ...base });
  } else if (code === 0) {
    emit({ status: "complete", outputFile, exitCode: 0, ...base });
  } else {
    emit({
      status: "invocation_error",
      reason: signal ? `terminated by signal ${signal}` : `codex exited ${code}`,
      exitCode: code,
      outputFile: fs.existsSync(outputFile) ? outputFile : null,
      stderrTail: stderrTail.trim() || undefined,
      ...base,
    });
  }
  process.exit(0);
});
