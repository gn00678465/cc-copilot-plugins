# Continue Loop Skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `/continue-loop` slash command to the `code-review` plugin that resumes a suspended code-review loop (raises `--max-iterations` and immediately triggers the next reviewer pass), so users are never stuck at an unverified `fix(N)` state when the cap is hit.

**Architecture:** Extract shared iteration helpers (state I/O, git snapshot, reviewer invocation, prompt composition) from `session-stop.js` into a new `iterate.js` module, then implement `continue.js` on top of the same helpers. The new `/continue-loop` skill invokes `continue.js`. State clearing rules are unchanged — only reviewer APPROVAL clears state.

**Tech Stack:** Node.js (CommonJS, built-in modules only; no new dependencies), Git CLI, Copilot CLI. Existing repo conventions: plain `node` scripts, no test framework. Verification uses syntax checks (`node --check`) plus ad-hoc probe scripts with `node:assert`.

**Spec:** [`docs/superpowers/specs/2026-04-24-continue-loop-design.md`](../specs/2026-04-24-continue-loop-design.md)

---

## File Structure

### New files
- `plugins/code-review/skills/code-review-loop/scripts/iterate.js` — shared iteration helpers (state I/O, git, approval detection, range computation, reviewer invocation, prompt composition). Single-responsibility: "what each iteration of the review loop needs to do, independent of who triggers it."
- `plugins/code-review/skills/code-review-loop/scripts/continue.js` — `/continue-loop` entry point. Single-responsibility: "resume a suspended loop: validate, raise cap if needed, run one reviewer pass, persist state atomically."
- `plugins/code-review/skills/continue-loop/SKILL.md` — slash command skill definition. Twin of `cancel-review/SKILL.md`.

### Modified files
- `plugins/code-review/scripts/session-stop.js` — migrate helpers into `iterate.js` imports (behavior-preserving refactor); extend suspend-branch message with `/continue-loop` guidance.
- `plugins/code-review/skills/code-review-loop/SKILL.md` — update "How the loop works" Step 4 to mention `/continue-loop`.
- `plugins/code-review/skills/code-review-loop/evals/evals.json` — add evals 20–23 for `/continue-loop`; adjust eval 11's assertions to accept new suspend message wording.

### Unchanged
- `plugins/code-review/skills/code-review-loop/scripts/reviewer.js` — no logic change; `iterate.js` does not touch its iteration-1 path.
- `plugins/code-review/skills/code-review-loop/scripts/copilot.js` — exports (`buildExclusionClause`, `buildLoopContextSuffix`, `wrapReviewerPrompt`, `runCopilot`) unchanged.
- `plugins/code-review/hooks/hooks.json` — hook entry point unchanged.
- `plugins/code-review/skills/cancel-review/SKILL.md` — unchanged.

---

## Phase 1: Extract `iterate.js` (behavior-preserving refactor)

### Task 1: Create `iterate.js` and move state I/O + git + approval helpers

Move 12 pure-function helpers from `session-stop.js` into `iterate.js`. These have no behavioral dependencies on the hook context — they are mechanical moves. After this task, `session-stop.js` imports them; existing behavior is byte-identical.

**Files:**
- Create: `plugins/code-review/skills/code-review-loop/scripts/iterate.js`
- Modify: `plugins/code-review/scripts/session-stop.js` (replace helper definitions with imports)

- [ ] **Step 1: Write the failing probe**

Create `probe.tmp.js` at repo root:

```javascript
'use strict';

const path = require('path');
const assert = require('assert');

const iterate = require(path.resolve(
  __dirname,
  'plugins',
  'code-review',
  'skills',
  'code-review-loop',
  'scripts',
  'iterate.js'
));

// Exported surface smoke test.
const expectedExports = [
  'APPROVAL_LINE_PATTERN',
  'hasApprovalInReport',
  'gitStashCreate',
  'gitHeadCommit',
  'resolveWorkspaceRoot',
  'resolveStateFile',
  'resolveReportFile',
  'readReportFile',
  'writeReportFile',
  'clearReportFile',
  'parseFrontmatter',
  'serializeFrontmatter',
  'loadState',
  'saveState',
  'clearState',
];
for (const name of expectedExports) {
  assert(name in iterate, `iterate.js should export ${name}`);
}

// hasApprovalInReport — final-line match only.
assert.strictEqual(iterate.hasApprovalInReport(''), false);
assert.strictEqual(iterate.hasApprovalInReport('<promise>APPROVAL</promise>'), true);
assert.strictEqual(
  iterate.hasApprovalInReport('noise\n<promise>APPROVAL</promise>\n'),
  true
);
assert.strictEqual(
  iterate.hasApprovalInReport('<promise>APPROVAL</promise>\ntrailing text'),
  false
);
assert.strictEqual(
  iterate.hasApprovalInReport('`<promise>APPROVAL</promise>`'),
  false
);

// parseFrontmatter / serializeFrontmatter round-trip.
const raw = [
  '---',
  'active: true',
  'iteration: 2',
  'max_iterations: 3',
  'model: "gpt-5.4"',
  'mode: "claude"',
  'head_sha: null',
  '---',
  '',
  'review staged changes',
  '',
].join('\n');
const { state } = iterate.parseFrontmatter(raw);
assert.strictEqual(state.active, true);
assert.strictEqual(state.iteration, 2);
assert.strictEqual(state.max_iterations, 3);
assert.strictEqual(state.model, 'gpt-5.4');
assert.strictEqual(state.mode, 'claude');
assert.strictEqual(state.head_sha, null);
assert.strictEqual(state.prompt, 'review staged changes');

const reserialised = iterate.serializeFrontmatter(state);
const { state: state2 } = iterate.parseFrontmatter(reserialised);
assert.deepStrictEqual(state2, state);

console.log('OK');
```

- [ ] **Step 2: Run probe — expect failure**

```bash
node probe.tmp.js
```

Expected: fails with `Cannot find module '.../iterate.js'`.

- [ ] **Step 3: Create `iterate.js` with the helpers**

Create `plugins/code-review/skills/code-review-loop/scripts/iterate.js`:

```javascript
'use strict';

/**
 * Shared iteration helpers for the code-review loop.
 *
 * Consumed by session-stop.js (iteration 2+ from Stop hook) and continue.js
 * (manual resume via /continue-loop). Extracted so both entry points use the
 * same state I/O, git snapshot, and reviewer-invocation semantics.
 */

const fs = require('fs');
const path = require('path');
const { execSync, execFileSync } = require('child_process');

// ---------------------------------------------------------------------------
// Approval detection
// ---------------------------------------------------------------------------

const APPROVAL_LINE_PATTERN = /^\s*<promise>\s*APPROVAL\s*<\/promise>\s*$/i;

function hasApprovalInReport(text) {
  if (typeof text !== 'string' || !text.trim()) return false;
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  let i = lines.length - 1;
  while (i >= 0 && lines[i].trim() === '') i--;
  if (i < 0) return false;
  return APPROVAL_LINE_PATTERN.test(lines[i]);
}

// ---------------------------------------------------------------------------
// Git helpers
// ---------------------------------------------------------------------------

function gitStashCreate(cwd) {
  try {
    return execSync('git stash create', { cwd, encoding: 'utf8' }).trim();
  } catch (_) {
    return '';
  }
}

function gitHeadCommit(cwd) {
  try {
    return execSync('git rev-parse HEAD', { cwd, encoding: 'utf8' }).trim();
  } catch (_) {
    return '';
  }
}

// ---------------------------------------------------------------------------
// Workspace / path resolution
// ---------------------------------------------------------------------------

function resolveWorkspaceRoot(cwd) {
  return cwd || process.cwd();
}

function resolveStateFile(workspaceRoot, dotDir) {
  return path.join(workspaceRoot, dotDir, 'code-review.local.md');
}

function resolveReportFile(workspaceRoot, dotDir) {
  return path.join(workspaceRoot, dotDir, 'code-review.last-report.md');
}

// ---------------------------------------------------------------------------
// Report file I/O
// ---------------------------------------------------------------------------

function readReportFile(reportFile) {
  try {
    return fs.readFileSync(reportFile, 'utf8');
  } catch (_) {
    return '';
  }
}

function writeReportFile(reportFile, text) {
  try {
    fs.writeFileSync(reportFile, text ?? '', 'utf8');
  } catch (err) {
    process.stderr.write(
      `⚠️  Code review loop: failed to persist reviewer report: ${err.message}\n`
    );
  }
}

function clearReportFile(reportFile) {
  try { fs.unlinkSync(reportFile); } catch (_) {}
}

// ---------------------------------------------------------------------------
// State frontmatter parse / serialize
// ---------------------------------------------------------------------------

function parseFrontmatter(raw) {
  const lines = raw.split('\n');
  if (lines[0].trim() !== '---') return { state: {}, body: raw };

  const closeIdx = lines.findIndex((l, i) => i > 0 && l.trim() === '---');
  if (closeIdx === -1) return { state: {}, body: raw };

  const state = {};
  for (const line of lines.slice(1, closeIdx)) {
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim();
    let val = line.slice(colon + 1).trim();
    if (val === 'true') state[key] = true;
    else if (val === 'false') state[key] = false;
    else if (val === 'null' || val === '~' || val === '') state[key] = null;
    else if (/^-?\d+$/.test(val)) state[key] = parseInt(val, 10);
    else state[key] = val.replace(/^["']|["']$/g, '');
  }

  const body = lines.slice(closeIdx + 1).join('\n').trim();
  if (body) state.prompt = body;
  return { state, body };
}

function serializeFrontmatter(state) {
  const { prompt, ...fields } = state;
  const lines = ['---'];
  for (const [k, v] of Object.entries(fields)) {
    if (v === null) lines.push(`${k}: null`);
    else if (typeof v === 'string') lines.push(`${k}: "${v}"`);
    else lines.push(`${k}: ${v}`);
  }
  lines.push('---', '', prompt ?? '', '');
  return lines.join('\n');
}

function loadState(stateFile) {
  const raw = fs.readFileSync(stateFile, 'utf8');
  return parseFrontmatter(raw).state;
}

function saveState(stateFile, state) {
  const uniqueSuffix = Date.now() + Math.random().toString(36).slice(2);
  const tmpPath = `${stateFile}.tmp.${uniqueSuffix}`;
  try {
    fs.writeFileSync(tmpPath, serializeFrontmatter(state), 'utf8');
    fs.renameSync(tmpPath, stateFile);
  } catch (err) {
    try { fs.unlinkSync(tmpPath); } catch (_) {}
    throw err;
  }
}

function clearState(stateFile) {
  try { fs.unlinkSync(stateFile); } catch (_) {}
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  APPROVAL_LINE_PATTERN,
  hasApprovalInReport,
  gitStashCreate,
  gitHeadCommit,
  resolveWorkspaceRoot,
  resolveStateFile,
  resolveReportFile,
  readReportFile,
  writeReportFile,
  clearReportFile,
  parseFrontmatter,
  serializeFrontmatter,
  loadState,
  saveState,
  clearState,
};
```

- [ ] **Step 4: Run probe — expect pass**

```bash
node probe.tmp.js
```

Expected: `OK`.

- [ ] **Step 5: Refactor `session-stop.js` to import from `iterate.js`**

Replace all 12 helper definitions in `session-stop.js` with an import at the top of the file. Remove the now-duplicated local definitions.

Open `plugins/code-review/scripts/session-stop.js`. After the existing docblock (ends around line 33), replace lines 35–224 (the helpers and their section banners) with:

```javascript
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const {
  hasApprovalInReport,
  gitStashCreate,
  gitHeadCommit,
  resolveWorkspaceRoot,
  resolveStateFile,
  resolveReportFile,
  readReportFile,
  writeReportFile,
  clearReportFile,
  loadState,
  saveState,
  clearState,
} = require(
  path.resolve(__dirname, '..', 'skills', 'code-review-loop', 'scripts', 'iterate.js')
);

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_REVIEWER_MODEL = 'gpt-5.4';

// ---------------------------------------------------------------------------
// Copilot invocation (hook-local for now; migrated to iterate.js in Task 3)
// ---------------------------------------------------------------------------

function resolveCopilotScript() {
  return path.resolve(
    __dirname,
    '..',
    'skills',
    'code-review-loop',
    'scripts',
    'copilot.js'
  );
}

function runCopilotReviewer({ workspaceRoot, model, prompt }) {
  const copilotScript = resolveCopilotScript();
  try {
    const out = execFileSync(
      process.execPath,
      [copilotScript, '--prompt', prompt, '--model', model || DEFAULT_REVIEWER_MODEL],
      {
        cwd: workspaceRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        maxBuffer: 20 * 1024 * 1024,
      }
    );
    return (out || '').trim();
  } catch (err) {
    process.stderr.write(
      `⚠️  Code review loop: Copilot reviewer invocation failed: ${err.message}\n`
    );
    return null;
  }
}

// ---------------------------------------------------------------------------
// Hook input
// ---------------------------------------------------------------------------

function readHookInput() {
  const raw = fs.readFileSync(0, 'utf8').trim();
  if (!raw) return {};
  return JSON.parse(raw);
}
```

The `main()` function and everything after it remain byte-identical. Double-check that the removed lines correspond to what's declared in the import block — no stray references to `execSync` or `parseFrontmatter` remain.

- [ ] **Step 6: Syntax-check both files**

```bash
node --check plugins/code-review/skills/code-review-loop/scripts/iterate.js
node --check plugins/code-review/scripts/session-stop.js
```

Expected: both commands exit 0 with no output.

- [ ] **Step 7: Smoke-test session-stop's approval branch (Eval 5)**

```bash
# Setup: throwaway repo with state + approval report
TMP=$(mktemp -d) && cd "$TMP"
git init -q && git commit --allow-empty -m init -q
mkdir .claude
cat > .claude/code-review.local.md <<'EOF'
---
active: true
iteration: 1
max_iterations: 3
model: "gpt-5.4"
mode: "claude"
base_revision: null
head_sha: null
initial_head: null
---

review staged changes
EOF
cat > .claude/code-review.last-report.md <<'EOF'
Mock review body

<promise>APPROVAL</promise>
EOF

# Exercise
echo "{\"cwd\":\"$TMP\"}" | node "$OLDPWD/plugins/code-review/scripts/session-stop.js" claude

# Assert approval message + state cleared
test ! -f .claude/code-review.local.md && echo "state cleared OK"
test ! -f .claude/code-review.last-report.md && echo "report cleared OK"

cd "$OLDPWD" && rm -rf "$TMP"
```

Expected output contains: `✅ Code review loop: Reviewer issued APPROVAL`, `state cleared OK`, `report cleared OK`.

- [ ] **Step 8: Commit**

```bash
rm probe.tmp.js
git add plugins/code-review/skills/code-review-loop/scripts/iterate.js \
        plugins/code-review/scripts/session-stop.js
git commit -m "$(cat <<'EOF'
refactor(code-review): extract state/git/approval helpers into iterate.js

Pure move of 12 helpers from session-stop.js into a new shared module.
Behavior is byte-identical. Second consumer (continue.js for /continue-loop)
will land in the next commit.
EOF
)"
```

---

### Task 2: Add `computeNextRange` helper and migrate `session-stop.js`

Extract the snapshot / base..head computation from `session-stop.js` (currently inline at lines 297–340 of the original file) into a named helper `computeNextRange` on `iterate.js`.

**Files:**
- Modify: `plugins/code-review/skills/code-review-loop/scripts/iterate.js`
- Modify: `plugins/code-review/scripts/session-stop.js`

- [ ] **Step 1: Write the failing probe**

Create `probe.tmp.js` at repo root:

```javascript
'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');
const { execSync } = require('child_process');
const assert = require('assert');

const { computeNextRange } = require(path.resolve(
  __dirname,
  'plugins',
  'code-review',
  'skills',
  'code-review-loop',
  'scripts',
  'iterate.js'
));

function run(cmd, cwd) { execSync(cmd, { cwd, stdio: 'ignore' }); }
function capture(cmd, cwd) { return execSync(cmd, { cwd, encoding: 'utf8' }).trim(); }

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cr-range-'));
try {
  run('git init -q', tmp);
  run('git config user.email probe@example.com', tmp);
  run('git config user.name probe', tmp);
  fs.writeFileSync(path.join(tmp, 'a.txt'), 'alpha\n');
  run('git add a.txt', tmp);
  run('git commit -q -m "init" --no-gpg-sign', tmp);
  const initialHead = capture('git rev-parse HEAD', tmp);

  // Case 1: clean tree, HEAD unchanged — no-diff
  {
    const r = computeNextRange({ head_sha: initialHead, initial_head: initialHead }, tmp);
    assert.strictEqual(r.base, null);
    assert.strictEqual(r.head, null);
    assert.strictEqual(r.reason, 'no-diff');
  }

  // Case 2: working-tree edit produces a stash snapshot
  fs.writeFileSync(path.join(tmp, 'a.txt'), 'beta\n');
  {
    const r = computeNextRange({ head_sha: initialHead, initial_head: initialHead }, tmp);
    assert.strictEqual(r.base, initialHead);
    assert.match(r.head, /^[0-9a-f]{40}$/);
    assert.strictEqual(r.reason, undefined);
  }

  // Case 3: commit the change — clean tree, HEAD advanced
  run('git add a.txt', tmp);
  run('git commit -q -m "bump" --no-gpg-sign', tmp);
  const newHead = capture('git rev-parse HEAD', tmp);
  {
    const r = computeNextRange({ head_sha: initialHead, initial_head: initialHead }, tmp);
    assert.strictEqual(r.base, initialHead);
    assert.strictEqual(r.head, newHead);
  }

  // Case 4: head_sha null, initial_head fallback
  {
    const r = computeNextRange({ head_sha: null, initial_head: initialHead }, tmp);
    assert.strictEqual(r.base, initialHead);
    assert.strictEqual(r.head, newHead);
  }

  console.log('OK');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
```

- [ ] **Step 2: Run probe — expect failure**

```bash
node probe.tmp.js
```

Expected: `TypeError: computeNextRange is not a function`.

- [ ] **Step 3: Add `computeNextRange` to `iterate.js`**

Append to `plugins/code-review/skills/code-review-loop/scripts/iterate.js` just before the `module.exports` block:

```javascript
// ---------------------------------------------------------------------------
// Incremental-diff range computation
//
// Returns { base, head } for the next review iteration given the last-seen
// head in state. Preference order:
//   1. Working-tree snapshot via `git stash create` (uncommitted fixes).
//   2. Current HEAD if it has advanced since last iteration (writer committed).
//   3. Nothing new — return { reason: 'no-diff' } so callers can reject or
//      hold position.
//
// prevRef falls back to initial_head when head_sha is still null (e.g. the
// loop is still on its first iteration but /continue-loop was invoked).
// ---------------------------------------------------------------------------
function computeNextRange(state, workspaceRoot) {
  const prevRef = (typeof state.head_sha === 'string' && state.head_sha)
    ? state.head_sha
    : (typeof state.initial_head === 'string' && state.initial_head)
    ? state.initial_head
    : null;

  const snapshot = gitStashCreate(workspaceRoot);
  if (snapshot) {
    return { base: prevRef || gitHeadCommit(workspaceRoot), head: snapshot };
  }

  const currentHead = gitHeadCommit(workspaceRoot);
  if (currentHead && prevRef && currentHead !== prevRef) {
    return { base: prevRef, head: currentHead };
  }

  return { base: null, head: null, reason: 'no-diff' };
}
```

Add `computeNextRange` to the `module.exports` object.

- [ ] **Step 4: Run probe — expect pass**

```bash
node probe.tmp.js
```

Expected: `OK`.

- [ ] **Step 5: Migrate `session-stop.js::main()` to use `computeNextRange`**

In `plugins/code-review/scripts/session-stop.js`, find the block that starts with `// Not approved — snapshot working tree, roll sliding window, block the stop` (originally around line 293 of the pre-refactor file).

Replace the block from that comment through `const newHead = snapshot;` (originally around line 330) with:

```javascript
  // Not approved — compute the incremental diff range and block the stop.
  const range = computeNextRange(state, workspaceRoot);
  if (range.reason === 'no-diff') {
    process.stderr.write(
      `⚠️  Code review loop: no changes detected since iteration ${iteration}. ` +
      `Address the reviewer's findings before exiting, or run /cancel-review ` +
      `to end the loop. State preserved.\n`
    );
    return;
  }

  const newBase = range.base;
  const newHead = range.head;

  if (!newBase) {
    process.stderr.write(
      `⚠️  Code review loop: unable to resolve base_revision (no HEAD commit). ` +
      `Run /cancel-review if this loop should be discarded. State preserved.\n`
    );
    return;
  }
```

Add `computeNextRange` to the destructured import from `iterate.js` at the top of the file.

- [ ] **Step 6: Syntax-check**

```bash
node --check plugins/code-review/skills/code-review-loop/scripts/iterate.js
node --check plugins/code-review/scripts/session-stop.js
```

Expected: both exit 0.

- [ ] **Step 7: Smoke-test eval 14 (no-changes preserves state)**

```bash
TMP=$(mktemp -d) && cd "$TMP"
git init -q
git config user.email probe@example.com
git config user.name probe
echo "x" > a.txt && git add a.txt
git commit -q -m init --no-gpg-sign
HEAD_SHA=$(git rev-parse HEAD)
mkdir .claude
cat > .claude/code-review.local.md <<EOF
---
active: true
iteration: 1
max_iterations: 5
model: "gpt-5.4"
mode: "claude"
base_revision: null
head_sha: null
initial_head: "$HEAD_SHA"
---

review
EOF
cat > .claude/code-review.last-report.md <<'EOF'
Important: fix foo
EOF

echo "{\"cwd\":\"$TMP\"}" | node "$OLDPWD/plugins/code-review/scripts/session-stop.js" claude 2>&1

# Assert state preserved, no block, iteration unchanged
test -f .claude/code-review.local.md && echo "state preserved OK"
grep -q "iteration: 1" .claude/code-review.local.md && echo "iteration preserved OK"

cd "$OLDPWD" && rm -rf "$TMP"
```

Expected output contains: `no changes detected since iteration 1`, `state preserved OK`, `iteration preserved OK`.

- [ ] **Step 8: Commit**

```bash
rm probe.tmp.js
git add plugins/code-review/skills/code-review-loop/scripts/iterate.js \
        plugins/code-review/scripts/session-stop.js
git commit -m "$(cat <<'EOF'
refactor(code-review): extract computeNextRange into iterate.js

session-stop.js now calls computeNextRange(state, cwd) instead of inlining
the stash-create + HEAD-advance logic. Behavior unchanged; prepares for
continue.js to share the same range computation.
EOF
)"
```

---

### Task 3: Add `invokeReviewer` + `composeIterationPrompt` helpers and migrate `session-stop.js`

Extract the Copilot spawn logic and the iteration-2+ reviewer prompt template into `iterate.js`. After this task, `session-stop.js` no longer defines `runCopilotReviewer` nor inlines the iteration-2+ prompt string.

**Files:**
- Modify: `plugins/code-review/skills/code-review-loop/scripts/iterate.js`
- Modify: `plugins/code-review/scripts/session-stop.js`

- [ ] **Step 1: Write the failing probe**

Create `probe.tmp.js` at repo root:

```javascript
'use strict';

const path = require('path');
const assert = require('assert');

const { invokeReviewer, composeIterationPrompt } = require(path.resolve(
  __dirname,
  'plugins',
  'code-review',
  'skills',
  'code-review-loop',
  'scripts',
  'iterate.js'
));

assert.strictEqual(typeof invokeReviewer, 'function');
assert.strictEqual(typeof composeIterationPrompt, 'function');

// composeIterationPrompt — shape check.
const prompt = composeIterationPrompt({
  base: 'aaa1111',
  head: 'bbb2222',
  iteration: 2,
  maxIterations: 3,
});
assert.ok(prompt.includes('aaa1111..bbb2222'), 'prompt includes range');
assert.ok(prompt.includes('REVIEW SCOPE — EXCLUSIONS'), 'prompt includes exclusion clause');
assert.ok(prompt.includes('Only 1 iteration remains'), 'prompt includes near-cap stimulus');

// Unlimited — no emotional stimulus.
const unlimited = composeIterationPrompt({
  base: 'aaa',
  head: 'bbb',
  iteration: 1,
  maxIterations: 0,
});
assert.ok(!unlimited.includes('ITERATION CONTEXT'), 'unlimited omits stimulus');

// Far-from-cap — no stimulus.
const far = composeIterationPrompt({
  base: 'aaa',
  head: 'bbb',
  iteration: 1,
  maxIterations: 10,
});
assert.ok(!far.includes('ITERATION CONTEXT'), 'far-from-cap omits stimulus');

console.log('OK');
```

- [ ] **Step 2: Run probe — expect failure**

```bash
node probe.tmp.js
```

Expected: `TypeError: invokeReviewer is not a function` (or `composeIterationPrompt`).

- [ ] **Step 3: Add both helpers to `iterate.js`**

Append to `plugins/code-review/skills/code-review-loop/scripts/iterate.js` before the `module.exports` block:

```javascript
// ---------------------------------------------------------------------------
// Reviewer invocation
//
// Spawns copilot.js synchronously, returning trimmed stdout on success or
// null on failure. Failure is logged to stderr but does not throw; callers
// decide whether to clear a stale report, preserve state, etc.
// ---------------------------------------------------------------------------

const DEFAULT_REVIEWER_MODEL = 'gpt-5.4';

function resolveCopilotScript() {
  return path.resolve(__dirname, 'copilot.js');
}

function invokeReviewer({ workspaceRoot, model, prompt }) {
  const copilotScript = resolveCopilotScript();
  try {
    const out = execFileSync(
      process.execPath,
      [copilotScript, '--prompt', prompt, '--model', model || DEFAULT_REVIEWER_MODEL],
      {
        cwd: workspaceRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        maxBuffer: 20 * 1024 * 1024,
      }
    );
    return (out || '').trim();
  } catch (err) {
    process.stderr.write(
      `⚠️  Code review loop: Copilot reviewer invocation failed: ${err.message}\n`
    );
    return null;
  }
}

// ---------------------------------------------------------------------------
// Iteration-2+ reviewer prompt composition
//
// Assembled from three fragments:
//   1. The range-focused review instruction (base..head).
//   2. buildExclusionClause() — tells the reviewer to skip the plugin's own
//      state files if they happen to be tracked in git.
//   3. buildLoopContextSuffix() — injects emotional-stimuli context on the
//      final 1–2 iterations to lift reviewer rigour.
// ---------------------------------------------------------------------------

function composeIterationPrompt({ base, head, iteration, maxIterations }) {
  const { buildExclusionClause, buildLoopContextSuffix } = require('./copilot.js');
  return (
    `Review the incremental changes in this git range: \`${base}..${head}\`.\n\n` +
    `Run \`git diff ${base}..${head}\` to see exactly what changed ` +
    `since the previous review iteration. Apply the same multi-axis ` +
    `review (correctness / quality / security / performance) focused ` +
    `ONLY on these changes.` +
    buildExclusionClause() +
    buildLoopContextSuffix(iteration, maxIterations)
  );
}
```

Add `invokeReviewer`, `composeIterationPrompt`, and `DEFAULT_REVIEWER_MODEL` to the `module.exports` object.

- [ ] **Step 4: Run probe — expect pass**

```bash
node probe.tmp.js
```

Expected: `OK`.

- [ ] **Step 5: Migrate `session-stop.js` to use the new helpers**

In `plugins/code-review/scripts/session-stop.js`:

1. Delete the local `DEFAULT_REVIEWER_MODEL` constant, `resolveCopilotScript` function, and `runCopilotReviewer` function that were kept in Task 1 as temporary local copies.
2. Remove `execFileSync` from the top-level require of `child_process` (now used only inside `iterate.js`); if nothing else from that module is needed, remove the require line entirely.
3. Add `invokeReviewer`, `composeIterationPrompt`, and `DEFAULT_REVIEWER_MODEL` to the destructured import from `iterate.js`.
4. Inside `main()`, replace the call to `runCopilotReviewer(...)` with `invokeReviewer(...)`.
5. Replace the inline reviewer-prompt assembly (the `const reviewerPrompt = ...` block) with:

```javascript
  const reviewerPrompt = composeIterationPrompt({
    base: newBase,
    head: newHead,
    iteration: nextIteration,
    maxIterations,
  });
```

6. Remove the now-unused `path.resolve(__dirname, '..', 'skills', 'code-review-loop', 'scripts', 'copilot.js')` require for `buildExclusionClause` / `buildLoopContextSuffix` inside `main()`.

- [ ] **Step 6: Syntax-check**

```bash
node --check plugins/code-review/skills/code-review-loop/scripts/iterate.js
node --check plugins/code-review/scripts/session-stop.js
```

Expected: both exit 0.

- [ ] **Step 7: Smoke-test eval 8 (block path, reviewer persistence)**

```bash
TMP=$(mktemp -d) && cd "$TMP"
git init -q
git config user.email probe@example.com
git config user.name probe
echo "x" > a.txt && git add a.txt
git commit -q -m init --no-gpg-sign
HEAD_SHA=$(git rev-parse HEAD)
echo "y" > a.txt

mkdir .claude
cat > .claude/code-review.local.md <<EOF
---
active: true
iteration: 1
max_iterations: 3
model: "probe-model-xyz"
mode: "claude"
base_revision: null
head_sha: null
initial_head: "$HEAD_SHA"
---

review
EOF
cat > .claude/code-review.last-report.md <<'EOF'
Important: stale finding
EOF

OUT=$(echo "{\"cwd\":\"$TMP\"}" | node "$OLDPWD/plugins/code-review/scripts/session-stop.js" claude 2>&1)
echo "$OUT" | grep -q '"decision":' && echo "block decision OK"
echo "$OUT" | grep -q 'probe-model-xyz' && echo "model propagated OK"
grep -q 'iteration: 2' .claude/code-review.local.md && echo "iteration bumped OK"

cd "$OLDPWD" && rm -rf "$TMP"
```

Expected: `block decision OK`, `model propagated OK`, `iteration bumped OK`. The `"decision":"block"` JSON appears because Copilot CLI will fail to launch in this smoke test (not installed / wrong args), but the fallback-reason path still emits a block decision referencing `probe-model-xyz`.

- [ ] **Step 8: Commit**

```bash
rm probe.tmp.js
git add plugins/code-review/skills/code-review-loop/scripts/iterate.js \
        plugins/code-review/scripts/session-stop.js
git commit -m "$(cat <<'EOF'
refactor(code-review): move reviewer invocation + prompt composition into iterate.js

session-stop.js now consumes invokeReviewer() and composeIterationPrompt()
from iterate.js instead of carrying its own copies. Behavior unchanged;
continue.js will consume the same helpers in the next commit.
EOF
)"
```

---

## Phase 2: `/continue-loop` implementation

### Task 4: `continue.js` argument parsing + help text

Start `continue.js` with nothing but argument parsing and `--help` output. The parseArgs function rejects unknown flags, validates `--max-iterations` as a non-negative integer, and parses no positional args.

**Files:**
- Create: `plugins/code-review/skills/code-review-loop/scripts/continue.js`

- [ ] **Step 1: Write the failing probe**

Create `probe.tmp.js`:

```javascript
'use strict';

const { execFileSync } = require('child_process');
const path = require('path');
const assert = require('assert');

const script = path.resolve(
  __dirname,
  'plugins',
  'code-review',
  'skills',
  'code-review-loop',
  'scripts',
  'continue.js'
);

function run(args) {
  try {
    const out = execFileSync(process.execPath, [script, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, stdout: out, stderr: '' };
  } catch (err) {
    return {
      code: err.status || 1,
      stdout: err.stdout ? err.stdout.toString() : '',
      stderr: err.stderr ? err.stderr.toString() : '',
    };
  }
}

// --help prints usage and exits 0.
{
  const r = run(['--help']);
  assert.strictEqual(r.code, 0);
  assert.match(r.stdout, /Continue Loop/);
  assert.match(r.stdout, /--max-iterations/);
}

// -h alias.
{
  const r = run(['-h']);
  assert.strictEqual(r.code, 0);
}

// --max-iterations requires a value.
{
  const r = run(['--max-iterations']);
  assert.strictEqual(r.code, 1);
  assert.match(r.stderr, /--max-iterations requires/);
}

// --max-iterations rejects non-numeric.
{
  const r = run(['--max-iterations', 'abc']);
  assert.strictEqual(r.code, 1);
  assert.match(r.stderr, /non-negative integer/);
}

// --max-iterations rejects negative.
{
  const r = run(['--max-iterations', '-2']);
  assert.strictEqual(r.code, 1);
}

// Unknown flag.
{
  const r = run(['--mode', 'claude']);
  assert.strictEqual(r.code, 1);
  assert.match(r.stderr, /Unknown argument|--mode/);
}

// Positional arg rejected.
{
  const r = run(['extra-word']);
  assert.strictEqual(r.code, 1);
  assert.match(r.stderr, /Unknown argument|does not accept positional/);
}

console.log('OK');
```

- [ ] **Step 2: Run probe — expect failure**

```bash
node probe.tmp.js
```

Expected: `Error: Cannot find module .../continue.js`.

- [ ] **Step 3: Create `continue.js` skeleton**

Create `plugins/code-review/skills/code-review-loop/scripts/continue.js`:

```javascript
#!/usr/bin/env node

'use strict';

/**
 * /continue-loop entry point.
 *
 * Resumes a suspended code-review loop. Usage:
 *
 *   node continue.js [--max-iterations N]
 *
 * Reads state from .<mode>/code-review.local.md (mode persisted in state),
 * validates that a resume is permitted, optionally raises max_iterations,
 * runs one Copilot reviewer pass on the writer's latest diff, and persists
 * the new iteration + report atomically.
 *
 * State lifecycle is unchanged: only reviewer APPROVAL clears state. All
 * rejection paths preserve state exactly as found.
 */

const HELP_TEXT = `Continue Loop — resume a suspended code-review loop

USAGE:
  /continue-loop [--max-iterations N]

OPTIONS:
  --max-iterations <N>   New absolute max_iterations (N > current iteration;
                         N = 0 for unlimited). Optional when the loop is not
                         yet at its cap.
  -h, --help             Show this help message

BEHAVIOR:
  Reads .<mode>/code-review.local.md (mode persisted in state). Rejects
  with a clear message and exit code 1 when:
    - no active loop is found,
    - the loop is at its cap and --max-iterations is omitted,
    - --max-iterations N <= current iteration,
    - no new diff exists since the last review.

  Otherwise: runs one Copilot reviewer pass on the incremental diff,
  persists the report, atomically updates state (iteration++, new cap if
  given, new base/head), and prints a banner + the reviewer's report.

EXAMPLES:
  /continue-loop --max-iterations 5
  /continue-loop
`;

function exitWithError(message) {
  process.stderr.write(`❌ ${message}\n`);
  process.exit(1);
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const result = { maxIterations: null }; // null = keep existing

  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    if (arg === '-h' || arg === '--help') {
      process.stdout.write(HELP_TEXT);
      process.exit(0);
    } else if (arg === '--max-iterations') {
      if (i + 1 >= args.length || args[i + 1].startsWith('--')) {
        exitWithError('--max-iterations requires a numeric value (e.g. --max-iterations 5)');
      }
      const n = parseInt(args[i + 1], 10);
      if (isNaN(n) || n < 0 || String(n) !== args[i + 1].trim()) {
        exitWithError(`--max-iterations must be a non-negative integer, got: ${args[i + 1]}`);
      }
      result.maxIterations = n;
      i += 2;
    } else {
      exitWithError(
        `Unknown argument: ${arg}. /continue-loop does not accept positional args or other flags. ` +
        `Use --help for usage.`
      );
    }
  }

  return result;
}

function main() {
  parseArgs(process.argv);
  // Task 5 fills in state validation and execution.
  exitWithError('continue.js: state validation not yet implemented (Task 5).');
}

main();
```

- [ ] **Step 4: Run probe — expect pass**

```bash
node probe.tmp.js
```

Expected: `OK`.

- [ ] **Step 5: Commit**

```bash
rm probe.tmp.js
git add plugins/code-review/skills/code-review-loop/scripts/continue.js
git commit -m "$(cat <<'EOF'
feat(code-review): scaffold continue.js with arg parsing

Lays down the /continue-loop entry point with --help and strict flag
validation. State handling and reviewer invocation land in the next
commit.
EOF
)"
```

---

### Task 5: `continue.js` state validation + decision matrix

Add full state validation — the five rejection cases from Section 2 of the spec. Still no reviewer invocation yet.

**Files:**
- Modify: `plugins/code-review/skills/code-review-loop/scripts/continue.js`

- [ ] **Step 1: Write the failing probe**

Create `probe.tmp.js`:

```javascript
'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');
const assert = require('assert');

const script = path.resolve(
  __dirname,
  'plugins',
  'code-review',
  'skills',
  'code-review-loop',
  'scripts',
  'continue.js'
);

function run(args, cwd) {
  try {
    const out = execFileSync(process.execPath, [script, ...args], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
    });
    return { code: 0, stdout: out, stderr: '' };
  } catch (err) {
    return {
      code: err.status || 1,
      stdout: err.stdout ? err.stdout.toString() : '',
      stderr: err.stderr ? err.stderr.toString() : '',
    };
  }
}

function mkRepo() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cr-cont-'));
  execSync('git init -q', { cwd: tmp });
  execSync('git config user.email probe@example.com', { cwd: tmp });
  execSync('git config user.name probe', { cwd: tmp });
  fs.writeFileSync(path.join(tmp, 'a.txt'), 'alpha\n');
  execSync('git add a.txt', { cwd: tmp });
  execSync('git commit -q -m init --no-gpg-sign', { cwd: tmp });
  return tmp;
}

function writeState(tmp, fields) {
  const dir = path.join(tmp, '.claude');
  fs.mkdirSync(dir, { recursive: true });
  const defaults = {
    active: true,
    iteration: 1,
    max_iterations: 3,
    completion_promise: 'APPROVAL',
    model: 'gpt-5.4',
    mode: 'claude',
    base_revision: null,
    head_sha: null,
    initial_head: null,
  };
  const merged = { ...defaults, ...fields };
  const lines = ['---'];
  for (const [k, v] of Object.entries(merged)) {
    if (v === null) lines.push(`${k}: null`);
    else if (typeof v === 'string') lines.push(`${k}: "${v}"`);
    else lines.push(`${k}: ${v}`);
  }
  lines.push('---', '', 'review staged changes', '');
  fs.writeFileSync(path.join(dir, 'code-review.local.md'), lines.join('\n'));
}

// Case 1: no state file
{
  const tmp = mkRepo();
  try {
    const r = run(['--max-iterations', '5'], tmp);
    assert.strictEqual(r.code, 1);
    assert.match(r.stderr, /No active code review loop found/);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

// Case 2: state exists but active: false
{
  const tmp = mkRepo();
  try {
    writeState(tmp, { active: false });
    const r = run(['--max-iterations', '5'], tmp);
    assert.strictEqual(r.code, 1);
    assert.match(r.stderr, /not active/);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

// Case 3: at cap, no flag
{
  const tmp = mkRepo();
  try {
    writeState(tmp, { iteration: 3, max_iterations: 3 });
    const r = run([], tmp);
    assert.strictEqual(r.code, 1);
    assert.match(r.stderr, /at its cap/);
    assert.match(r.stderr, /Pass --max-iterations/);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

// Case 4: --max-iterations N <= current iteration
{
  const tmp = mkRepo();
  try {
    writeState(tmp, { iteration: 3, max_iterations: 3 });
    const r = run(['--max-iterations', '3'], tmp);
    assert.strictEqual(r.code, 1);
    assert.match(r.stderr, /must be greater than current iteration/);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

// Case 5: no new diff since state.head_sha
{
  const tmp = mkRepo();
  try {
    const headSha = execSync('git rev-parse HEAD', { cwd: tmp, encoding: 'utf8' }).trim();
    writeState(tmp, { iteration: 1, max_iterations: 5, head_sha: headSha });
    const r = run(['--max-iterations', '5'], tmp);
    assert.strictEqual(r.code, 1);
    assert.match(r.stderr, /No new changes since iteration 1/);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

console.log('OK');
```

- [ ] **Step 2: Run probe — expect failure**

```bash
node probe.tmp.js
```

Expected: tests fail because `continue.js` still exits with the "not yet implemented" message.

- [ ] **Step 3: Implement state validation in `continue.js`**

Two edits to `plugins/code-review/skills/code-review-loop/scripts/continue.js`:

(a) **Insert top-level declarations** after the `parseArgs` function but before the existing `function main()` block:

```javascript
const fs = require('fs');
const path = require('path');

const iterate = require(path.resolve(__dirname, 'iterate.js'));

function resolveDotDir(mode) {
  return mode === 'copilot' ? '.copilot' : '.claude';
}

function loadActiveState(workspaceRoot) {
  // Probe both possible dot-dirs since continue.js takes no --mode flag.
  for (const mode of ['claude', 'copilot']) {
    const dotDir = resolveDotDir(mode);
    const stateFile = iterate.resolveStateFile(workspaceRoot, dotDir);
    if (fs.existsSync(stateFile)) {
      let state;
      try {
        state = iterate.loadState(stateFile);
      } catch (err) {
        exitWithError(
          `Failed to parse ${path.join(dotDir, 'code-review.local.md')}: ${err.message}. ` +
          `Inspect manually or run /cancel-review to discard.`
        );
      }
      return { state, stateFile, dotDir, mode };
    }
  }
  return null;
}

function validateResumePreconditions(state, flags) {
  if (state.active !== true) {
    exitWithError(`Code review loop is not active (state.active != true).`);
  }

  const iteration = typeof state.iteration === 'number' ? state.iteration : 0;
  const stateMax = typeof state.max_iterations === 'number' ? state.max_iterations : 0;

  let effectiveMax = stateMax;
  if (flags.maxIterations !== null) {
    if (flags.maxIterations !== 0 && flags.maxIterations <= iteration) {
      exitWithError(
        `--max-iterations must be greater than current iteration (${iteration}), ` +
        `got ${flags.maxIterations}.`
      );
    }
    effectiveMax = flags.maxIterations;
  } else if (stateMax > 0 && iteration >= stateMax) {
    exitWithError(
      `Loop is at its cap (iteration ${iteration} / max ${stateMax}). ` +
      `Pass --max-iterations N (N > ${iteration}) to raise.`
    );
  }

  return { iteration, effectiveMax };
}
```

(b) **Replace the entire existing `function main() { ... }` block** (but keep the trailing `main();` invocation on the last line of the file):

```javascript
function main() {
  const flags = parseArgs(process.argv);
  const workspaceRoot = process.cwd();

  const found = loadActiveState(workspaceRoot);
  if (!found) {
    exitWithError('No active code review loop found. Run /code-review-loop to start one.');
  }

  const { state, stateFile, dotDir, mode } = found;
  const { iteration, effectiveMax } = validateResumePreconditions(state, flags);

  const range = iterate.computeNextRange(state, workspaceRoot);
  if (range.reason === 'no-diff') {
    exitWithError(
      `No new changes since iteration ${iteration}. Address the reviewer's last ` +
      `findings before continuing.`
    );
  }
  if (!range.base || !range.head) {
    exitWithError(
      `Unable to resolve base_revision (no HEAD commit). Cannot continue.`
    );
  }

  // Task 6 fills in reviewer invocation + state persistence + banner.
  // For now: announce the would-be next iteration without side effects.
  process.stdout.write(
    `continue.js: validation OK. iteration ${iteration}→${iteration + 1}, ` +
    `max ${effectiveMax}, range ${range.base.slice(0, 7)}..${range.head.slice(0, 7)}, ` +
    `mode ${mode}, state ${stateFile}. ` +
    `Reviewer invocation lands in Task 6.\n`
  );
  process.exit(0);
}
```

- [ ] **Step 4: Run probe — expect pass**

```bash
node probe.tmp.js
```

Expected: `OK`.

- [ ] **Step 5: Syntax-check**

```bash
node --check plugins/code-review/skills/code-review-loop/scripts/continue.js
```

Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
rm probe.tmp.js
git add plugins/code-review/skills/code-review-loop/scripts/continue.js
git commit -m "$(cat <<'EOF'
feat(code-review): add continue.js state validation

Validates loop state against the /continue-loop decision matrix. All five
rejection paths (no state, inactive, at cap, N<=iter, no new diff) return
clear errors and exit code 1 without touching state. Happy-path (reviewer
invocation + state persistence + banner) lands in the next commit.
EOF
)"
```

---

### Task 6: `continue.js` happy-path — reviewer invocation, report persistence, atomic state write, banner

Fill in the remainder of `continue.js`: run the reviewer, persist the report, write state atomically, print the banner.

**Files:**
- Modify: `plugins/code-review/skills/code-review-loop/scripts/continue.js`

- [ ] **Step 1: Write the failing probe**

Create `probe.tmp.js`. This probe stubs `copilot.js` via a temporary `PATH` indirection on the Node module resolution — actually simpler: we shim `copilot.js` to a canned output by overriding the script file on disk for the duration of the test, then restore.

```javascript
'use strict';

const { execFileSync, execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const repoRoot = __dirname;
const script = path.join(
  repoRoot,
  'plugins', 'code-review', 'skills', 'code-review-loop', 'scripts', 'continue.js'
);
const copilotScript = path.join(
  repoRoot,
  'plugins', 'code-review', 'skills', 'code-review-loop', 'scripts', 'copilot.js'
);
const copilotBackup = copilotScript + '.bak';

function run(args, cwd) {
  try {
    const out = execFileSync(process.execPath, [script, ...args], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, stdout: out, stderr: '' };
  } catch (err) {
    return {
      code: err.status || 1,
      stdout: err.stdout ? err.stdout.toString() : '',
      stderr: err.stderr ? err.stderr.toString() : '',
    };
  }
}

function installCopilotShim() {
  fs.copyFileSync(copilotScript, copilotBackup);
  // Shim: CLI entry prints a fixed "review" report. Also re-exports the
  // helpers composeIterationPrompt needs (buildExclusionClause, buildLoopContextSuffix).
  const shim = `'use strict';
function buildExclusionClause() { return '\\n\\nREVIEW SCOPE — EXCLUSIONS\\n\\n(shim)'; }
function buildLoopContextSuffix(i, m) { return (m > 0 && (m - i) <= 1) ? '\\n\\nITERATION CONTEXT — PLEASE READ CAREFULLY\\n(shim stimulus)' : ''; }
module.exports = { buildExclusionClause, buildLoopContextSuffix };
if (require.main === module) {
  const args = process.argv.slice(2);
  const promptIdx = args.indexOf('--prompt');
  const modelIdx = args.indexOf('--model');
  process.stdout.write('SHIM-REVIEW\\n');
  process.stdout.write('prompt-has-range:' + /[0-9a-f]{7,40}\\.\\.[0-9a-f]{7,40}/i.test(args[promptIdx + 1] || '') + '\\n');
  process.stdout.write('model:' + (args[modelIdx + 1] || '') + '\\n');
  process.stdout.write('Important: foo\\n');
}
`;
  fs.writeFileSync(copilotScript, shim);
}

function restoreCopilot() {
  if (fs.existsSync(copilotBackup)) {
    fs.copyFileSync(copilotBackup, copilotScript);
    fs.unlinkSync(copilotBackup);
  }
}

function mkRepo() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cr-happy-'));
  execSync('git init -q', { cwd: tmp });
  execSync('git config user.email probe@example.com', { cwd: tmp });
  execSync('git config user.name probe', { cwd: tmp });
  fs.writeFileSync(path.join(tmp, 'a.txt'), 'alpha\n');
  execSync('git add a.txt', { cwd: tmp });
  execSync('git commit -q -m init --no-gpg-sign', { cwd: tmp });
  return tmp;
}

function writeState(tmp, fields) {
  const dir = path.join(tmp, '.claude');
  fs.mkdirSync(dir, { recursive: true });
  const defaults = {
    active: true,
    iteration: 3,
    max_iterations: 3,
    completion_promise: 'APPROVAL',
    model: 'gpt-5.4',
    mode: 'claude',
    base_revision: null,
    head_sha: null,
    initial_head: null,
  };
  const merged = { ...defaults, ...fields };
  const lines = ['---'];
  for (const [k, v] of Object.entries(merged)) {
    if (v === null) lines.push(`${k}: null`);
    else if (typeof v === 'string') lines.push(`${k}: "${v}"`);
    else lines.push(`${k}: ${v}`);
  }
  lines.push('---', '', 'review staged changes', '');
  fs.writeFileSync(path.join(dir, 'code-review.local.md'), lines.join('\n'));
}

installCopilotShim();
try {
  const tmp = mkRepo();
  try {
    const headSha = execSync('git rev-parse HEAD', { cwd: tmp, encoding: 'utf8' }).trim();
    writeState(tmp, { iteration: 3, max_iterations: 3, head_sha: headSha, initial_head: headSha });
    // Produce a working-tree diff so computeNextRange returns a snapshot.
    fs.writeFileSync(path.join(tmp, 'a.txt'), 'beta\n');

    const r = run(['--max-iterations', '5'], tmp);
    assert.strictEqual(r.code, 0, `exit code: ${r.code}, stderr: ${r.stderr}`);

    // Banner present.
    assert.match(r.stdout, /Code Review Loop continued/);
    assert.match(r.stdout, /Iteration: 4/);
    assert.match(r.stdout, /ROLE SEPARATION/);
    // Reviewer report streamed.
    assert.match(r.stdout, /SHIM-REVIEW/);
    assert.match(r.stdout, /Important: foo/);
    // Shim confirms composeIterationPrompt gave Copilot a range + model.
    assert.match(r.stdout, /prompt-has-range:true/);
    assert.match(r.stdout, /model:gpt-5\.4/);

    // State updated atomically.
    const stateRaw = fs.readFileSync(path.join(tmp, '.claude', 'code-review.local.md'), 'utf8');
    assert.match(stateRaw, /iteration: 4/);
    assert.match(stateRaw, /max_iterations: 5/);
    assert.match(stateRaw, /head_sha: "[0-9a-f]{40}"/);
    assert.match(stateRaw, /base_revision: "[0-9a-f]{40}"/);

    // Report persisted.
    const reportRaw = fs.readFileSync(path.join(tmp, '.claude', 'code-review.last-report.md'), 'utf8');
    assert.match(reportRaw, /SHIM-REVIEW/);
    assert.match(reportRaw, /Important: foo/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  console.log('OK');
} finally {
  restoreCopilot();
}
```

- [ ] **Step 2: Run probe — expect failure**

```bash
node probe.tmp.js
```

Expected: assertions fail because `continue.js` still exits in the "Task 6 placeholder" path.

- [ ] **Step 3: Replace the Task-5 placeholder with the full happy-path**

In `plugins/code-review/skills/code-review-loop/scripts/continue.js`, replace the tail of `main()` starting from the `// Task 6 fills in reviewer invocation ...` comment through and including `main()`'s closing `}`, with the code block below. The block ends with a new top-level `printBanner` function that lives AFTER `main()` — i.e. the replacement writes the remainder of `main()`, closes it with `}`, and then defines `printBanner`:

```javascript
  // ---- Happy path ----
  const reviewerModel = (typeof state.model === 'string' && state.model)
    ? state.model
    : 'gpt-5.4';

  const prompt = iterate.composeIterationPrompt({
    base: range.base,
    head: range.head,
    iteration: iteration + 1,
    maxIterations: effectiveMax,
  });

  const report = iterate.invokeReviewer({
    workspaceRoot,
    model: reviewerModel,
    prompt,
  });

  const reportFile = iterate.resolveReportFile(workspaceRoot, dotDir);
  if (report) {
    iterate.writeReportFile(reportFile, report);
  } else {
    iterate.clearReportFile(reportFile);
  }

  // Atomic state write — iteration + (optional) max + new range.
  const nextState = {
    ...state,
    iteration: iteration + 1,
    base_revision: range.base,
    head_sha: range.head,
  };
  if (flags.maxIterations !== null) {
    nextState.max_iterations = flags.maxIterations;
  }
  iterate.saveState(stateFile, nextState);

  printBanner({
    iteration: iteration + 1,
    max: effectiveMax,
    model: reviewerModel,
    mode,
    report,
  });

  if (!report) {
    // Copilot failed; state already reflects the iteration bump so the next
    // Stop event does not re-review the same range, but exit code signals
    // the failure to the caller.
    process.exit(1);
  }
}

function printBanner({ iteration, max, model, mode, report }) {
  const capLabel = max > 0 ? `cap: ${max}` : 'cap: unlimited';
  const sep = '─'.repeat(63);

  const lines = [
    '🔄 Code Review Loop continued!',
    '',
    `Iteration: ${iteration}  (${capLabel})`,
    `Reviewer model: ${model}`,
    `Mode: ${mode} (.${mode}/)`,
    '',
    sep,
    'ROLE SEPARATION — STRICT',
    sep,
    '  You are the writer/fixer. The reviewer is the Copilot CLI subagent.',
    '  You MUST NOT emit <promise>APPROVAL</promise> — that token is',
    '  reviewer-exclusive. The stop hook inspects the reviewer\'s',
    '  persisted report, not your messages.',
    sep,
    '',
  ];
  process.stdout.write(lines.join('\n') + '\n');

  if (report) {
    process.stdout.write(`─── Reviewer report ───\n${report}\n─── End of report ───\n\n`);
    process.stdout.write([
      'Your job now:',
      '  1. Fix every Critical and Important finding above.',
      '  2. Exit your turn; the stop hook continues the loop or suspends',
      '     on the new cap.',
      '',
    ].join('\n'));
  } else {
    process.stdout.write(
      '⚠️  Copilot reviewer invocation failed. State has been advanced to the ' +
      'next iteration and the stale report was cleared; re-run /continue-loop ' +
      'or inspect copilot availability.\n'
    );
  }
}
```

- [ ] **Step 4: Run probe — expect pass**

```bash
node probe.tmp.js
```

Expected: `OK`.

- [ ] **Step 5: Syntax-check**

```bash
node --check plugins/code-review/skills/code-review-loop/scripts/continue.js
```

Expected: exit 0.

- [ ] **Step 6: Re-run Task 5's validation probe to confirm rejection paths still work**

Re-use the probe from Task 5 Step 1 (paste it into `probe.tmp.js` again or keep a copy). Expected: `OK`.

- [ ] **Step 7: Commit**

```bash
rm probe.tmp.js
git add plugins/code-review/skills/code-review-loop/scripts/continue.js
git commit -m "$(cat <<'EOF'
feat(code-review): implement continue.js happy-path

Runs one Copilot reviewer pass via iterate.invokeReviewer, persists the
report, writes state atomically (iteration++, new max if given, new
base/head), and prints a role-separation banner with the report body.

State lifecycle unchanged: only reviewer APPROVAL clears state; all
rejection and failure paths preserve or sensibly advance state.
EOF
)"
```

---

### Task 7: Create `/continue-loop` slash command skill

The skill file is the user-facing entry point. It instructs Claude Code to invoke `continue.js` with the supplied `$ARGUMENTS`, mirroring how `/cancel-review` is defined.

**Files:**
- Create: `plugins/code-review/skills/continue-loop/SKILL.md`

- [ ] **Step 1: Write the failing probe**

Create `probe.tmp.js`:

```javascript
'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const skill = path.resolve(
  __dirname,
  'plugins',
  'code-review',
  'skills',
  'continue-loop',
  'SKILL.md'
);

assert(fs.existsSync(skill), 'SKILL.md should exist');
const body = fs.readFileSync(skill, 'utf8');

// Frontmatter
assert.match(body, /^---\n/, 'starts with frontmatter');
assert.match(body, /\nname: continue-loop\n/);
assert.match(body, /\ndescription: /);
assert.match(body, /\nargument-hint: "\[--max-iterations N\]"/);

// References continue.js via CLAUDE_PLUGIN_ROOT.
assert.match(body, /skills\/code-review-loop\/scripts\/continue\.js/);
assert.match(body, /\$\{CLAUDE_PLUGIN_ROOT\}/);

// Passes $ARGUMENTS through so --max-iterations reaches continue.js.
assert.match(body, /\$ARGUMENTS/);

// Mentions /cancel-review for symmetry (not strict, but nice).
// (No assertion — aesthetic.)

console.log('OK');
```

- [ ] **Step 2: Run probe — expect failure**

```bash
node probe.tmp.js
```

Expected: `AssertionError: SKILL.md should exist`.

- [ ] **Step 3: Create the skill file**

Create `plugins/code-review/skills/continue-loop/SKILL.md`:

```markdown
---
name: continue-loop
description: Resume a suspended code review loop after it hit --max-iterations. Optionally raise the cap with --max-iterations N. Symmetric with /cancel-review — one extends the loop, the other discards it.
argument-hint: "[--max-iterations N]"
---

# Continue Loop

Resume a code-review loop that was suspended when `--max-iterations` was reached. Runs the Copilot reviewer on the writer's latest diff immediately, persists the new report, and atomically updates state (`iteration++`, optional new `max_iterations`, new `base_revision` / `head_sha`).

State lifecycle is unchanged: this command NEVER clears state. Only reviewer APPROVAL (detected by the stop hook) clears state. Use `/cancel-review` to discard explicitly.

## Usage

- `/continue-loop` — continue the loop at its current cap. Valid only when `iteration < max_iterations` and the writer has made new changes since the last review.
- `/continue-loop --max-iterations N` — raise the cap to `N` (absolute total, not additive) and immediately run the next review. `N` must be greater than the current `iteration`; `N = 0` means unlimited.

## Execute

Run the continue script with the user's arguments passed through:

```!
node "${CLAUDE_PLUGIN_ROOT}/skills/code-review-loop/scripts/continue.js" $ARGUMENTS
```

The script prints the reviewer report inline. After it returns, you (the writer / fixer) should:

1. Fix every `Critical` and `Important` finding the reviewer listed.
2. Exit your turn — the stop hook either detects `<promise>APPROVAL</promise>` in the persisted reviewer report or rolls the next iteration.

You MUST NOT emit `<promise>APPROVAL</promise>` yourself. The writer/reviewer separation defined by `/code-review-loop` still applies here.
```

- [ ] **Step 4: Run probe — expect pass**

```bash
node probe.tmp.js
```

Expected: `OK`.

- [ ] **Step 5: Commit**

```bash
rm probe.tmp.js
git add plugins/code-review/skills/continue-loop/SKILL.md
git commit -m "$(cat <<'EOF'
feat(code-review): add /continue-loop slash command skill

Twin of /cancel-review: invokes continue.js with pass-through arguments.
Describes when it's valid, the --max-iterations absolute-value semantics,
and the writer/reviewer role separation that still applies on resume.
EOF
)"
```

---

### Task 8: Update `session-stop.js` suspend message and `code-review-loop/SKILL.md`

Surface `/continue-loop` as the primary resume path in the suspend message and in the skill docs.

**Files:**
- Modify: `plugins/code-review/scripts/session-stop.js`
- Modify: `plugins/code-review/skills/code-review-loop/SKILL.md`

- [ ] **Step 1: Write the failing probe**

Create `probe.tmp.js`:

```javascript
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, execSync } = require('child_process');
const assert = require('assert');

const repoRoot = __dirname;
const hook = path.join(repoRoot, 'plugins', 'code-review', 'scripts', 'session-stop.js');
const skillMd = path.join(
  repoRoot, 'plugins', 'code-review', 'skills', 'code-review-loop', 'SKILL.md'
);

// --- SKILL.md text check ---
const md = fs.readFileSync(skillMd, 'utf8');
assert.match(md, /\/continue-loop/);

// --- Suspend message check: set up state at cap, run hook ---
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cr-sus-'));
try {
  execSync('git init -q', { cwd: tmp });
  execSync('git config user.email probe@example.com', { cwd: tmp });
  execSync('git config user.name probe', { cwd: tmp });
  fs.writeFileSync(path.join(tmp, 'a.txt'), 'x\n');
  execSync('git add a.txt', { cwd: tmp });
  execSync('git commit -q -m init --no-gpg-sign', { cwd: tmp });

  const dir = path.join(tmp, '.claude');
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'code-review.local.md'),
    [
      '---',
      'active: true',
      'iteration: 3',
      'max_iterations: 3',
      'completion_promise: "APPROVAL"',
      'model: "gpt-5.4"',
      'mode: "claude"',
      'base_revision: null',
      'head_sha: null',
      'initial_head: null',
      '---',
      '',
      'review',
      '',
    ].join('\n')
  );
  fs.writeFileSync(path.join(dir, 'code-review.last-report.md'), 'Important: foo\n');

  let stdout = '', stderr = '';
  try {
    stdout = execFileSync(
      process.execPath,
      [hook, 'claude'],
      {
        cwd: tmp,
        input: JSON.stringify({ cwd: tmp }),
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }
    );
  } catch (err) {
    stdout = (err.stdout || '').toString();
    stderr = (err.stderr || '').toString();
  }

  const combined = stdout + stderr;
  assert.match(combined, /max iterations \(3\) reached at iteration 3/);
  assert.match(combined, /\/continue-loop/);
  assert.match(combined, /\/cancel-review/);
  // State preserved.
  assert(fs.existsSync(path.join(dir, 'code-review.local.md')), 'state preserved');
  assert(fs.existsSync(path.join(dir, 'code-review.last-report.md')), 'report preserved');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log('OK');
```

- [ ] **Step 2: Run probe — expect failure**

```bash
node probe.tmp.js
```

Expected: `AssertionError: Expected value to match /\/continue-loop/` (SKILL.md has no mention yet, hook message still says "raise max_iterations in ...").

- [ ] **Step 3: Update the suspend message in `session-stop.js`**

In `plugins/code-review/scripts/session-stop.js::main()`, find the `if (maxIterations > 0 && iteration >= maxIterations)` branch. Replace its `process.stdout.write(...)` body with:

```javascript
    process.stdout.write(
      `🛑 Code review loop: max iterations (${maxIterations}) reached at ` +
      `iteration ${iteration}. Loop suspended; state preserved.\n` +
      `  - To continue, run /continue-loop --max-iterations <N>  (N > ${iteration}).\n` +
      `  - To discard state, run /cancel-review.\n`
    );
```

- [ ] **Step 4: Update `code-review-loop/SKILL.md`**

In `plugins/code-review/skills/code-review-loop/SKILL.md`, locate Step 4 under "How the loop works" (around line 81 of the pre-change file):

```markdown
4. **Exit** — the loop only *terminates and clears state* when the reviewer's latest report ends with the terminator token. If `--max-iterations` is reached without approval, the loop is **suspended**: state is preserved so you can inspect the last iteration, raise `max_iterations` to continue, or run `/cancel-review` to discard the state explicitly.
```

Replace it with:

```markdown
4. **Exit** — the loop only *terminates and clears state* when the reviewer's latest report ends with the terminator token. If `--max-iterations` is reached without approval, the loop is **suspended**: state is preserved so you can run `/continue-loop --max-iterations <N>` to resume (raises the cap and immediately triggers the next review), inspect the state file manually, or run `/cancel-review` to discard it explicitly.
```

- [ ] **Step 5: Run probe — expect pass**

```bash
node probe.tmp.js
```

Expected: `OK`.

- [ ] **Step 6: Syntax-check and commit**

```bash
node --check plugins/code-review/scripts/session-stop.js

rm probe.tmp.js
git add plugins/code-review/scripts/session-stop.js \
        plugins/code-review/skills/code-review-loop/SKILL.md
git commit -m "$(cat <<'EOF'
feat(code-review): surface /continue-loop in suspend path and skill docs

Stop hook's max-iterations suspend message now points users at
/continue-loop --max-iterations <N> as the primary resume action, with
/cancel-review as the discard action. SKILL.md Step 4 reflects the same
guidance.

Behavior under the hood is unchanged: state is preserved, Copilot is not
invoked, exit code 0. Only the user-facing text differs.
EOF
)"
```

---

### Task 9: Update `evals.json` with new evals 20–23 and adjust eval 11

Add four new evals covering `/continue-loop` paths; amend eval 11 so its assertions accept the new suspend-message wording.

**Files:**
- Modify: `plugins/code-review/skills/code-review-loop/evals/evals.json`

- [ ] **Step 1: Write the failing probe**

Create `probe.tmp.js`:

```javascript
'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const evalsPath = path.resolve(
  __dirname,
  'plugins',
  'code-review',
  'skills',
  'code-review-loop',
  'evals',
  'evals.json'
);
const evals = JSON.parse(fs.readFileSync(evalsPath, 'utf8')).evals;

function findById(id) { return evals.find((e) => e.id === id); }

// New evals present.
for (const id of [20, 21, 22, 23]) {
  const e = findById(id);
  assert(e, `eval ${id} should exist`);
  assert(typeof e.name === 'string' && e.name.length > 0);
  assert(typeof e.prompt === 'string' && e.prompt.includes('continue.js'));
  assert(Array.isArray(e.assertions) && e.assertions.length > 0);
}

// Eval 20 — no state.
{
  const e = findById(20);
  assert.match(e.name, /continue-loop/);
  const a = e.assertions.map((x) => x.description).join(' ');
  assert.match(a, /No active code review loop/);
}

// Eval 21 — at cap, no flag.
{
  const e = findById(21);
  const a = e.assertions.map((x) => x.description).join(' ');
  assert.match(a, /at its cap/);
}

// Eval 22 — raises cap + runs reviewer.
{
  const e = findById(22);
  const a = e.assertions.map((x) => x.description).join(' ');
  assert.match(a, /iteration/);
  assert.match(a, /max_iterations: 5/);
  assert.match(a, /last-report/);
}

// Eval 23 — no new diff.
{
  const e = findById(23);
  const a = e.assertions.map((x) => x.description).join(' ');
  assert.match(a, /No new changes/);
}

// Eval 11 — must still exist AND mention /continue-loop now.
{
  const e = findById(11);
  assert(e, 'eval 11 still present');
  const a = e.assertions.map((x) => x.description).join(' ');
  assert.match(a, /\/continue-loop/);
  // And /cancel-review still asserted (existing invariant).
  assert.match(a, /\/cancel-review/);
}

console.log('OK');
```

- [ ] **Step 2: Run probe — expect failure**

```bash
node probe.tmp.js
```

Expected: `AssertionError: eval 20 should exist`.

- [ ] **Step 3: Add evals 20–23**

Open `plugins/code-review/skills/code-review-loop/evals/evals.json`. Inside the `evals` array, immediately before the closing `]`, append (preserving the trailing comma on the last prior entry, which is the eval with id 13):

```json
    {
      "id": 20,
      "name": "continue-loop-rejects-without-active-state",
      "prompt": "Run: node plugins/code-review/skills/code-review-loop/scripts/continue.js --max-iterations 5 in a fresh git repo with no .claude/code-review.local.md. Capture stdout + stderr + exit code and verify the decision matrix: no active loop path rejects cleanly without side effects.",
      "expected_output": "Exit code 1. stderr contains 'No active code review loop found'. No state file is created. Copilot is NOT invoked.",
      "files": [],
      "assertions": [
        {
          "name": "no_active_loop_message",
          "description": "stderr contains 'No active code review loop found'"
        },
        {
          "name": "exit_code_one",
          "description": "exit code is 1"
        },
        {
          "name": "no_state_file_created",
          "description": "no .claude/code-review.local.md is created by continue.js"
        },
        {
          "name": "no_copilot_invocation",
          "description": "copilot.js is not spawned"
        }
      ]
    },
    {
      "id": 21,
      "name": "continue-loop-rejects-at-cap-without-flag",
      "prompt": "Setup: git repo with a committed file and .claude/code-review.local.md containing iteration:3, max_iterations:3, active:true, model:'gpt-5.4', mode:'claude'. Run: node plugins/code-review/skills/code-review-loop/scripts/continue.js (no flags).",
      "expected_output": "Exit code 1. stderr contains 'Loop is at its cap (iteration 3 / max 3)' and 'Pass --max-iterations'. State file iteration and max_iterations remain 3. Copilot is NOT invoked.",
      "files": [],
      "assertions": [
        {
          "name": "at_cap_message",
          "description": "stderr contains 'at its cap' and 'Pass --max-iterations'"
        },
        {
          "name": "exit_code_one",
          "description": "exit code is 1"
        },
        {
          "name": "state_iteration_unchanged",
          "description": ".claude/code-review.local.md still has iteration: 3"
        },
        {
          "name": "state_max_unchanged",
          "description": ".claude/code-review.local.md still has max_iterations: 3"
        },
        {
          "name": "no_copilot_invocation",
          "description": "copilot.js is not spawned"
        }
      ]
    },
    {
      "id": 22,
      "name": "continue-loop-raises-cap-and-runs-reviewer",
      "prompt": "Setup: git repo with a committed file + dirty working tree (so git stash create yields a snapshot). .claude/code-review.local.md with iteration:3, max_iterations:3, active:true, model:'gpt-5.4', mode:'claude', head_sha set to HEAD. Intercept copilot.js with a shim that prints 'SHIM-REVIEW\\nImportant: foo\\n'. Run: node plugins/code-review/skills/code-review-loop/scripts/continue.js --max-iterations 5.",
      "expected_output": "Exit code 0. stdout contains the continue banner ('Code Review Loop continued', 'Iteration: 4', 'ROLE SEPARATION'), followed by the reviewer report including 'SHIM-REVIEW' and 'Important: foo'. State updates atomically: iteration becomes 4, max_iterations becomes 5, base_revision and head_sha are 40-hex SHAs. .claude/code-review.last-report.md contains the shim stdout. copilot.js is invoked exactly once with --model gpt-5.4 and a prompt that includes the range 'base..head' and 'REVIEW SCOPE — EXCLUSIONS'.",
      "files": [],
      "assertions": [
        {
          "name": "banner_continued_line",
          "description": "stdout contains 'Code Review Loop continued'"
        },
        {
          "name": "banner_iteration_next",
          "description": "stdout contains 'Iteration: 4'"
        },
        {
          "name": "banner_role_separation",
          "description": "stdout contains 'ROLE SEPARATION'"
        },
        {
          "name": "reviewer_report_streamed",
          "description": "stdout contains the reviewer shim output (e.g. 'SHIM-REVIEW', 'Important: foo')"
        },
        {
          "name": "state_iteration_incremented",
          "description": ".claude/code-review.local.md shows iteration: 4"
        },
        {
          "name": "state_max_raised",
          "description": ".claude/code-review.local.md shows max_iterations: 5"
        },
        {
          "name": "state_head_and_base_sha",
          "description": "base_revision and head_sha in state are 40-char hex SHAs"
        },
        {
          "name": "report_persisted",
          "description": ".claude/code-review.last-report.md contains the shim reviewer output"
        },
        {
          "name": "copilot_invoked_with_model",
          "description": "copilot.js was spawned once with '--model gpt-5.4'"
        },
        {
          "name": "copilot_prompt_has_range",
          "description": "the prompt passed to copilot.js contains a 'sha..sha' git range"
        },
        {
          "name": "copilot_prompt_has_exclusion",
          "description": "the prompt passed to copilot.js contains 'REVIEW SCOPE — EXCLUSIONS'"
        }
      ]
    },
    {
      "id": 23,
      "name": "continue-loop-rejects-without-new-diff",
      "prompt": "Setup: git repo with a committed file, clean working tree, HEAD unchanged. .claude/code-review.local.md with iteration:3, max_iterations:3, head_sha = current HEAD. Run: node plugins/code-review/skills/code-review-loop/scripts/continue.js --max-iterations 5.",
      "expected_output": "Exit code 1. stderr contains 'No new changes since iteration 3'. State file is COMPLETELY unchanged (iteration 3, max_iterations 3, head_sha unchanged). Copilot is NOT invoked.",
      "files": [],
      "assertions": [
        {
          "name": "no_new_changes_message",
          "description": "stderr contains 'No new changes since iteration 3'"
        },
        {
          "name": "exit_code_one",
          "description": "exit code is 1"
        },
        {
          "name": "state_completely_unchanged",
          "description": ".claude/code-review.local.md is byte-identical to the pre-run state (iteration 3, max_iterations 3, head_sha unchanged)"
        },
        {
          "name": "no_copilot_invocation",
          "description": "copilot.js is not spawned"
        }
      ]
    }
```

- [ ] **Step 4: Update eval 11's assertions**

In the same `evals.json`, locate the eval with `"id": 11` (`stop-hook-max-iterations-suspends-loop-preserving-state`). Modify:

1. Replace the `expected_output` to reflect the new message:

```json
      "expected_output": "stdout contains 'max iterations (3) reached at iteration 3. Loop suspended; state preserved.' and instructions mentioning /continue-loop AND /cancel-review. Both state and report files REMAIN on disk. Exit code 0. Copilot is NOT invoked. Only a confirmed APPROVAL (id:5) is allowed to clear state.",
```

2. Replace the assertion with `"name": "message_mentions_raising_max"` (its `description` mentions `"raise max_iterations"`) with the following new assertion:

```json
        {
          "name": "message_mentions_continue_loop",
          "description": "stdout contains '/continue-loop' and indicates --max-iterations N is the way to raise the cap"
        },
```

Keep every other assertion on eval 11 unchanged.

- [ ] **Step 5: Run probe — expect pass**

```bash
node probe.tmp.js
```

Expected: `OK`.

- [ ] **Step 6: JSON syntax check**

```bash
node -e "JSON.parse(require('fs').readFileSync('plugins/code-review/skills/code-review-loop/evals/evals.json','utf8'))"
```

Expected: exit 0, no output.

- [ ] **Step 7: Commit**

```bash
rm probe.tmp.js
git add plugins/code-review/skills/code-review-loop/evals/evals.json
git commit -m "$(cat <<'EOF'
test(code-review): add evals 20-23 for /continue-loop and refresh eval 11

Evals 20-23 cover the four /continue-loop paths: no active state, at cap
without flag, happy-path (raise + run reviewer), no new diff. Eval 11's
expected_output and one assertion now require the new suspend-message
wording that points at /continue-loop.
EOF
)"
```

---

### Task 10: End-to-end acceptance check

Final integration check with a realistic walkthrough. Verifies Phase 1 + Phase 2 work together and no regression slipped in.

**Files:** none (check-only task).

- [ ] **Step 1: Run full syntax sweep**

```bash
node --check plugins/code-review/skills/code-review-loop/scripts/iterate.js
node --check plugins/code-review/skills/code-review-loop/scripts/continue.js
node --check plugins/code-review/skills/code-review-loop/scripts/reviewer.js
node --check plugins/code-review/skills/code-review-loop/scripts/copilot.js
node --check plugins/code-review/scripts/session-stop.js
node -e "JSON.parse(require('fs').readFileSync('plugins/code-review/skills/code-review-loop/evals/evals.json','utf8'))"
```

Expected: all exit 0 with no output.

- [ ] **Step 2: Confirm `/continue-loop --help` works end-to-end**

```bash
node plugins/code-review/skills/code-review-loop/scripts/continue.js --help
```

Expected: usage text printed including `Continue Loop`, `USAGE`, `--max-iterations <N>`, example lines. Exit 0.

- [ ] **Step 3: Manually walk eval 22 (happy-path)**

Re-create the Task 6 Step 1 probe verbatim at `probe.tmp.js` (it installs a copilot shim, exercises `/continue-loop`, restores copilot). Then:

```bash
node probe.tmp.js && echo "happy-path walkthrough: OK" || echo "FAIL"
rm probe.tmp.js
```

Expected: `OK` then `happy-path walkthrough: OK`. Confirm `git diff` reports no changes to `copilot.js` afterwards (the probe restores it).

- [ ] **Step 4: Manual inspection of the skill surface**

```bash
ls plugins/code-review/skills/
cat plugins/code-review/skills/continue-loop/SKILL.md | head -10
```

Expected: `continue-loop` appears alongside `cancel-review` and `code-review-loop`; SKILL.md frontmatter lists `name: continue-loop`.

- [ ] **Step 5: Git status clean**

```bash
git status
```

Expected: working tree clean (all changes committed across Task 1–9).

- [ ] **Step 6: No lingering probe files**

```bash
ls probe.tmp.js 2>/dev/null && echo "CLEAN UP PROBE" || echo "no probe file: OK"
```

Expected: `no probe file: OK`.

---

## Post-Implementation Self-Review Checklist

Before declaring the feature done, verify:

- [ ] All 10 tasks committed (9 with code changes, 1 check-only).
- [ ] `/continue-loop --help` prints usage.
- [ ] `/continue-loop` rejects with exit 1 + clear stderr in each rejection case (no active state, at cap without flag, `N <= iteration`, no new diff).
- [ ] Happy-path updates `state.iteration`, optionally `state.max_iterations`, new `base_revision` and `head_sha` — atomically.
- [ ] Report file persists the reviewer's output on success; is cleared on Copilot failure.
- [ ] `session-stop.js` suspend message mentions both `/continue-loop` and `/cancel-review`.
- [ ] `code-review-loop/SKILL.md` Step 4 documents `/continue-loop` as the primary resume path.
- [ ] `evals.json` contains entries for ids 20, 21, 22, 23 plus an updated eval 11.
- [ ] Existing evals 1–10, 12–19 unchanged.
- [ ] State lifecycle invariant preserved: only reviewer APPROVAL clears state.
