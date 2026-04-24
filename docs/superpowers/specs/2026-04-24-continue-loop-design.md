# Continue Loop Skill Design

**Date:** 2026-04-24
**Plugin:** `code-review`
**New Skill:** `continue-loop`
**Affected Skills:** `code-review-loop`, `session-stop` hook

---

## 背景

目前 `code-review-loop` 執行到 `--max-iterations` cap 時，`session-stop.js` 會靜默 suspend：印一段 stderr 訊息、保留 state、放行 session 結束。使用者實際觀察到的順序是 `review(1) → fix(1) → review(2) → fix(2) → review(3) → fix(3) → stop`，最後一次 fix 沒有被 reviewer 檢視過，使用者困在「下一步該開新 loop 還是做別的」的模糊狀態。

現有唯一能主動恢復 loop 的方式是手動編輯 `.<mode>/code-review.local.md` 的 YAML（提高 `max_iterations`）再讓 Stop hook 自然觸發——門檻高、不直覺。

本設計新增一個與 `/cancel-review` 對稱的 `/continue-loop` slash command，把「繼續 loop 並提高 cap」變成一等公民操作。

## 設計決策摘要

| 面向 | 決策 |
|------|------|
| 指令名稱 | `/continue-loop` |
| 主要動作 | 立刻觸發下一輪 reviewer（與 `reviewer.js` 初次啟動體驗對稱） |
| `--max-iterations N` 語意 | 絕對總量（沿用 `reviewer.js` 慣例）；N 必須 > 目前 `iteration`；N=0 = unlimited |
| 旗標省略且已撞 cap | 拒絕並提示提高 cap |
| 旗標省略且未撞 cap | 接受，直接跑下一輪 reviewer |
| `iteration < max_iterations` 時 | 允許呼叫（使用者任何時候都能主動踢下一輪） |
| state 不存在 / 無新 diff | 拒絕，沿用既有訊息風格 |
| State 清除規則 | 不變——只有 reviewer APPROVAL 會清 state |
| `--mode` 旗標 | 不提供（從 state 讀取） |

---

## 檔案變更範圍

| 檔案 | 動作 | 說明 |
|------|------|------|
| `plugins/code-review/skills/continue-loop/SKILL.md` | 新增 | 對稱於 `cancel-review`；呼叫 `continue.js` 並轉發參數 |
| `plugins/code-review/skills/code-review-loop/scripts/continue.js` | 新增 | 主邏輯：解析旗標、驗證 state、算 diff 範圍、呼叫 Copilot、持久化 report、更新 state、印 banner |
| `plugins/code-review/skills/code-review-loop/scripts/iterate.js` | 新增 | 共用 helper：`computeNextRange`、`invokeReviewer`、`composeIterationPrompt` |
| `plugins/code-review/scripts/session-stop.js` | 更新 | (a) 改用 `iterate.js` 的 helper（純搬家，行為不變）；(b) suspend 訊息補一行 `/continue-loop --max-iterations N` 提示 |
| `plugins/code-review/skills/code-review-loop/SKILL.md` | 更新 | "How the loop works" 第 4 點補充 `/continue-loop` 作為續跑路徑 |
| `plugins/code-review/skills/code-review-loop/evals/evals.json` | 新增 evals | 四個新 eval 覆蓋 `/continue-loop` 各路徑；eval 11、16 等既有 eval 完全不動 |

---

## Section 1：使用者流程

### 正常流程範例：從 max=3 擴到 max=5

| 步驟 | 觸發者 | `state.iteration` | `state.max_iterations` | reviewer 實際執行 |
|------|--------|-------------------|------------------------|---|
| `/code-review-loop '...' --max-iterations 3` | 使用者 | 1 | 3 | review(1)（`reviewer.js`） |
| writer fix → Stop hook | Stop hook | 2 | 3 | review(2) |
| writer fix → Stop hook | Stop hook | 3 | 3 | review(3) |
| writer fix → Stop hook（撞 cap） | Stop hook | 3 | 3 | —（suspend，印提示） |
| `/continue-loop --max-iterations 5` | 使用者 | 4 | **5** | review(4)（`continue.js`） |
| writer fix → Stop hook | Stop hook | 5 | 5 | review(5) |
| writer fix → Stop hook（再次撞 cap） | Stop hook | 5 | 5 | —（suspend，印提示） |

總 review 次數 = 新 `max_iterations`（絕對值，不是累加）。

### 替代流程：非預期 reviewer 介入

使用者在 `iteration < max_iterations` 時呼叫 `/continue-loop`（無旗標）：
- 若有新 diff：立刻跑 review(iter+1)，等同於手動踢下一輪。
- 若無新 diff：拒絕。

---

## Section 2：`/continue-loop` 指令介面

### Skill 結構

`plugins/code-review/skills/continue-loop/SKILL.md` 的結構對稱於 `cancel-review/SKILL.md`：

- `allowed-tools` 限定為啟動 `continue.js` 所需的 Bash 呼叫 + 讀取 state 檔案。
- 描述文字指引 Claude：檢查 state 是否存在，然後呼叫 `continue.js` 並把 `$ARGUMENTS` 透傳。

`argument-hint` 明文為 `[--max-iterations N]`，與 `/code-review-loop` 的 `argument-hint` 風格一致。

### 參數定義

| 旗標 | 型別 | 必要 | 語意 |
|------|------|------|------|
| `--max-iterations <N>` | 非負整數 | 否 | 新的絕對 `max_iterations`；`N > state.iteration` 時接受；`N == 0` 為 unlimited；`N <= state.iteration` 時拒絕 |
| `--help`、`-h` | flag | 否 | 印使用說明並結束 |

其他旗標一律拒絕以防誤用（例如 `--mode`）。

### 決策矩陣

| 條件 | 有無 `--max-iterations` | 行為 |
|------|----------|------|
| state 檔不存在 | 任意 | 拒絕：`❌ No active code review loop found. Run /code-review-loop to start one.` 退出碼 1。 |
| state 存在但 `active != true` | 任意 | 拒絕：`❌ Code review loop is not active (state.active != true).` 退出碼 1。 |
| state 存在、`iteration >= max_iterations`、無旗標 | 無 | 拒絕：`❌ Loop is at its cap (iteration X / max X). Pass --max-iterations N (N > X) to raise.` 退出碼 1。 |
| 旗標 `N <= state.iteration` | 有 | 拒絕：`❌ --max-iterations must be greater than current iteration (X), got N.` 退出碼 1。 |
| 工作樹與 `state.head_sha` 無新差異（且 HEAD 未前進） | 任意 | 拒絕：`❌ No new changes since iteration X. Address the reviewer's last findings before continuing.` 退出碼 1。 |
| 以上皆非 | 任意 | 執行續跑流程（見 Section 3）。 |

---

## Section 3：`continue.js` 執行流程

1. **解析旗標**：與 `reviewer.js::parseArgs` 的 `--max-iterations` 邏輯一致；不存在 `--mode`、不存在 positional prompt。
2. **讀取 state**：使用 `session-stop.js` 既有的 `parseFrontmatter` 邏輯（抽到 `iterate.js` 後共用）。
3. **驗證 state 與旗標**：依 Section 2 的決策矩陣，失敗即印錯誤並退出碼 1。此階段所有驗證都在記憶體中完成，state 檔尚未被寫入，確保「驗證失敗時 state 完全不變」。
4. **計算新 `base..head`**：透過 `iterate.js::computeNextRange(state, workspaceRoot)`，使用與 `session-stop.js` 相同的 snapshot / HEAD 偵測邏輯：
   - `prevRef` 優先使用 `state.head_sha`；若為 null（例如 loop 才跑完 iteration 1 就呼叫 `/continue-loop`），退回 `state.initial_head`。
   - 先 `git stash create` 取 working-tree snapshot。
   - 若無 snapshot，檢查當前 HEAD 是否不等於 `prevRef`（使用者可能 commit 了）。
   - 兩者都沒有 ⇒ 回傳 `{ base: null, head: null, reason: 'no-diff' }`，`continue.js` 據此印「無新 diff」錯誤並退出碼 1（state 仍未寫入）。
5. **組 reviewer prompt**：透過 `iterate.js::composeIterationPrompt({ base, head, iteration: iter+1, maxIterations: effectiveMax })`：
   - `effectiveMax` 取「旗標提供的新值」或「state 原值」。
   - 引用 `copilot.js::buildExclusionClause` 與 `buildLoopContextSuffix`。
   - prompt 主體沿用 `session-stop.js` 既有的 iteration 2+ prompt 模板（review incremental diff + role separation 提醒）。
6. **呼叫 Copilot**：透過 `iterate.js::invokeReviewer`（封裝 `execFileSync` copilot.js 呼叫，回傳 stdout 字串或 null）。
7. **持久化 report**：寫入 `.<mode>/code-review.last-report.md`。reviewer 失敗 ⇒ 刪除舊 report（避免陳舊 APPROVAL 誤判），跳到步驟 9 但退出碼 1。
8. **一次性寫回 state**（atomic）：
   - `iteration = iter + 1`
   - `max_iterations = effectiveMax`（若旗標有提供）
   - `base_revision = newBase`
   - `head_sha = newHead`
   - 其他欄位不動。透過 `iterate.js::saveState` 的 tmp + rename 保證原子性。
9. **印 banner + reviewer 報告**（若 Copilot 成功），或印錯誤摘要（若 Copilot 失敗）。成功時的 banner 格式：

    ```
    🔄 Code Review Loop continued!

    Iteration: <iter+1>  (cap: <max>)
    Reviewer model: <model>
    Mode: <mode> (.<mode>/)

    ROLE SEPARATION — STRICT
      You are the writer/fixer. The reviewer is the Copilot CLI subagent.
      You MUST NOT emit <promise>APPROVAL</promise> — that token is
      reviewer-exclusive. The stop hook inspects the reviewer's
      persisted report, not your messages.

    ─── Reviewer report ───
    <copilot stdout>
    ─── End of report ───

    Your job now:
      1. Fix every Critical and Important finding above.
      2. Exit your turn; the stop hook continues the loop or
         suspends on the new cap.
    ```

    Banner 文字（role separation / terminator 提醒）抽到 `iterate.js` 常量區，與 `reviewer.js::printMissionStart` 共用以避免重複維護。

### 退出碼

| 情境 | exit code |
|------|-----------|
| 正常完成、report 持久化 | 0 |
| 驗證失敗（state 缺、旗標錯、無新 diff） | 1 |
| Copilot 呼叫失敗 | 1（並刪除陳舊 report，維持 session-stop.js 的 invariant） |

---

## Section 4：`iterate.js` 共用 helper

### 目的

`session-stop.js` 第 293~393 行（snapshot / 算 base..head / 組 prompt / 呼叫 copilot / 持久化 report / 更新 state）這段邏輯，`continue.js` 需要完整重用。把它抽成 `iterate.js` 可以避免兩份分歧的實作。

### API

```js
// 計算本次 iteration 的 base..head 範圍
// 回傳 { base, head } 或 { base: null, head: null, reason: <code> }
function computeNextRange(state, workspaceRoot) { ... }

// 呼叫 Copilot reviewer，回傳 stdout 或 null（失敗）
// 內部用 execFileSync 對 copilot.js
function invokeReviewer({ workspaceRoot, model, prompt }) { ... }

// 組出 iteration 2+ 的 reviewer prompt（含 exclusion clause、emotional stimuli）
function composeIterationPrompt({ base, head, iteration, maxIterations }) { ... }

// 重新匯出 session-stop.js 共用的 state I/O
exports.parseFrontmatter = ...;
exports.serializeFrontmatter = ...;
exports.loadState = ...;
exports.saveState = ...;
exports.clearState = ...;
exports.readReportFile = ...;
exports.writeReportFile = ...;
exports.clearReportFile = ...;
exports.resolveStateFile = ...;
exports.resolveReportFile = ...;
exports.resolveWorkspaceRoot = ...;
exports.gitStashCreate = ...;
exports.gitHeadCommit = ...;
exports.hasApprovalInReport = ...;
exports.APPROVAL_LINE_PATTERN = ...;
```

### 遷移做法

`session-stop.js` 對應段落改為從 `iterate.js` 匯入；行為完全不變。這是純搬家，既有 evals（1~19）不會受影響。

---

## Section 5：`session-stop.js` 訊息調整

Suspend 分支（目前印 `🛑 Code review loop: max iterations (X) reached at iteration Y. Loop suspended; state preserved.`）擴充為：

```
🛑 Code review loop: max iterations (3) reached at iteration 3. Loop suspended; state preserved.
  - To continue the loop, run /continue-loop --max-iterations <N>  (N > 3).
  - To discard state, run /cancel-review.
```

**不變**：不呼叫 Copilot、不清 state、不改 `active`、沒有 block decision、exit code 0。eval 11 的 assertions（`suspension_message_with_limits`、`message_mentions_cancel_review`、`state_file_preserved`、`no_copilot_invocation` 等）仍然成立。

**eval 11 的微幅更新**：新增一個 assertion 確認訊息包含 `/continue-loop` 提示；原本的 `message_mentions_raising_max` 改為接受新/舊任一種措辭以避免誤判。

---

## Section 6：`code-review-loop/SKILL.md` 更新

在現有「How the loop works」Section（SKILL.md 第 74 行起）的 Step 4 補充：

> 4. **Exit** — the loop only *terminates and clears state* when the reviewer's latest report ends with the terminator token. If `--max-iterations` is reached without approval, the loop is **suspended**: state is preserved so you can run `/continue-loop --max-iterations <N>` to resume (which raises the cap and immediately triggers the next review), inspect the state file manually, or run `/cancel-review` to discard it explicitly.

其他章節（Purpose、Hard rules、Your role、Approval semantics）不動。

---

## Section 7：Eval 覆蓋

新增 4 個 eval，id 接在現有最大 id 之後：

### Eval 20：`continue-loop-rejects-without-active-state`

**Prompt**：執行 `node plugins/code-review/skills/code-review-loop/scripts/continue.js --max-iterations 5`，工作目錄為一個全新 git repo（沒有 `.claude/code-review.local.md`）。

**Assertions**：
- stderr / stdout 包含 `No active code review loop found`。
- exit code 為 1。
- 沒有建立任何新檔案。
- Copilot 未被呼叫。

### Eval 21：`continue-loop-rejects-at-cap-without-flag`

**Setup**：git repo + `.claude/code-review.local.md`（`iteration: 3`、`max_iterations: 3`、`active: true`）。

**Prompt**：執行 `node ... continue.js`（無旗標）。

**Assertions**：
- stderr 包含 `Loop is at its cap` 與 `Pass --max-iterations`。
- exit code 1。
- state 檔 `iteration` 仍為 3、`max_iterations` 仍為 3。
- Copilot 未被呼叫。

### Eval 22：`continue-loop-raises-cap-and-runs-reviewer`

**Setup**：git repo + state（`iteration: 3`、`max_iterations: 3`、`model: 'gpt-5.4'`、`head_sha: <prev>`）+ working tree 有新變更（`git stash create` 能產生 snapshot）。`copilot.js` 改為 shim，回傳 `Mock review output\nImportant: foo\n`。

**Prompt**：執行 `node ... continue.js --max-iterations 5`。

**Assertions**：
- state 檔 `iteration` 變為 4、`max_iterations` 變為 5。
- `.claude/code-review.last-report.md` 內容為 shim stdout。
- stdout 包含 banner（`Code Review Loop continued`、`Iteration: 4`、`ROLE SEPARATION`）與 reviewer 報告。
- exit code 0。
- Copilot shim 被呼叫一次，`--model gpt-5.4` 被轉傳，prompt 含 `REVIEW SCOPE — EXCLUSIONS`。

### Eval 23：`continue-loop-rejects-without-new-diff`

**Setup**：git repo + state（`iteration: 3`、`max_iterations: 3`、`head_sha` = 當前 HEAD、working tree 清潔、HEAD 未前進）。

**Prompt**：執行 `node ... continue.js --max-iterations 5`。

**Assertions**：
- stderr 包含 `No new changes since iteration 3`。
- exit code 1。
- state 檔完全未動（iteration / max_iterations 都不變）。
- Copilot 未被呼叫。

### 既有 eval

| Eval id | 狀態 |
|---------|------|
| 1, 2, 3, 4 | 不動（`reviewer.js` 與 `copilot.js` 未改邏輯，`buildExclusionClause` / `buildLoopContextSuffix` 介面不變） |
| 5, 6, 7, 8, 9, 10, 12, 13, 14, 15, 16, 17, 18, 19 | 不動 |
| 11 | 微調訊息 assertion，改為接受新舊兩種措辭；新增「提示 `/continue-loop`」assertion |

---

## Section 8：風險與 trade-off

### 已知風險

1. **`continue.js` 與 `reviewer.js` 的 banner 可能重複維護**：兩者都需要印 role separation 文字。緩解：將 banner 文字抽到 `iterate.js` 或 `copilot.js` 的常量區，兩邊共用。
2. **`iterate.js` 重構造成 session-stop.js 一次較大搬家**：雖然行為不變，但 diff 會較大。緩解：分兩個 commit——先抽 `iterate.js` 並讓 `session-stop.js` 改用（行為保持），再加 `continue.js` 與 `/continue-loop` skill。
3. **`--max-iterations 0`（unlimited）後再 suspend 的狀況**：一旦改成 unlimited，正常路徑不會再撞 cap，suspend 分支不會觸發，`/continue-loop` 也就沒有用武之地。這是 `reviewer.js` 本來就支援的語意，沒有新問題。

### 已被刻意排除

- **問題 #2（state 檔不會自動清除）**：使用者明確要求留到 `/continue-loop` 落地後再討論。本設計完全不改清除規則。
- **自動 verification review**：先前提案的「撞 cap 後自動跑一次驗證」被使用者的 `/continue-loop` 設計取代；verification 交由使用者顯式觸發。

---

## Section 9：交付順序建議

1. **Commit 1**：抽出 `iterate.js`、`session-stop.js` 改用；執行既有 evals 確認未退化。
2. **Commit 2**：新增 `continue.js`、`/continue-loop` skill、`session-stop.js` suspend 訊息更新、`code-review-loop/SKILL.md` 說明更新；新增 eval 20~23；執行完整 eval 套件。

每個 commit 都要能獨立通過既有 evals 與新 evals。

---

## Section 10：驗收條件

- 使用者在撞 cap 後，可以用單一指令 `/continue-loop --max-iterations N` 恢復 loop 並立刻看到下一輪 review。
- `/continue-loop` 在四種失敗情境（state 缺、撞 cap 無旗標、旗標不合法、無新 diff）都回傳清楚的錯誤並退出碼 1。
- `session-stop.js` 的 suspend 訊息明確指引使用者有 `/continue-loop` 這條路徑。
- 新增 eval 20~23 全綠，既有 eval 1~19 完全不退化。
- state 清除規則維持「只有 APPROVAL 會清」的 invariant。
