# advisor:orchestration skill — 使用問題與改進建議

記錄本次以 `advisor:orchestration`（architect-as-orchestrator）搭配 `codex-implementer` 執行 M0 骨架時遭遇的問題，供該 skill 迭代優化。日期：2026-07-20，平台：Windows 11 / PowerShell + Git Bash，codex-cli 0.144.4。

## 嚴重問題

### 1.【Critical】取消 codex-implementer 未終止底層 `codex exec` 子行程 → 孤兒行程碰撞

- **情境**：dispatch 第一個 `codex-implementer`（codex-m0）後，使用者臨時追加安裝規範，我以 `TaskStop` 取消該 agent，`git status` 當下為乾淨，遂 dispatch 第二個（codex-m0b，新規範）。
- **問題**：`TaskStop` 只停掉 teammate agent 包裝層，**底層 `codex exec` 子行程仍存活**，並在數十秒後（codex 先推理才動手）開始依「舊 spec」寫檔，與 codex-m0b 同時修改同一批檔案，互相覆蓋，最終在 root `package.json` 留下不屬於任一方預期的手寫 `devDependencies` 區塊。
- **偵測來源**：是**第二個 agent 自己察覺**（看到「file modified by user/linter」且內容近似但不同）並主動停手回報，**不是** harness 或 skill 機制發現。
- **影響**：工作樹進入不一致狀態，需整棵 reset 重做。
- **建議**：
  - 在 `codex-implementer` agent 文件與 orchestration doctrine 明確警告：**取消/中止一個 codex lane 不保證終止 `codex exec` 子行程**；必須以 PID 層級確認終止（記錄啟動的 codex PID，取消後 kill）。
  - 加一條硬規則：**在確認前一次 codex 子行程已死之前，不得於同一工作樹 dispatch 第二個 lane**。
  - 提供跨平台的「確認並清除孤兒 codex 行程」小節（Windows：`Get-Process codex`／`Stop-Process`）。

### 2.【High】同一工作樹的並行／重派缺乏防護

- doctrine 有提到高風險工作用 worktree 隔離做「刻意並行」，但**未涵蓋「取消後重派」也會碰撞**的情境；也沒有「同樹單一寫入者」的預設保護。
- **建議**：預設「同一工作樹同時只有一個會寫檔的 lane」；任何並行（含重派）都應走 `isolation: worktree` 或序列化，並在 doctrine 顯著位置說明。

## 中度問題

### 3.【Medium】codex 於 Windows 的 sandbox 卡死風險未提示

- 使用者提醒：codex 在 Windows 下常因 sandbox 問題卡死。doctrine 的 codex 執行 recipe 用 `--sandbox workspace-write`，未針對 Windows 給出風險提示或緩解（本次實際未卡死，但屬已知風險）。
- **建議**：recipe 補 Windows 註記與逾時/卡死的判斷與處置建議。

### 4.【Medium】codex 行程模型使 PID／行程數的 liveness 偵測不可靠

- `codex exec` 的實際工作可能跑在**常駐 host 行程**之下，不一定產生獨立可辨識的 codex PID；以「codex 行程數」判斷 lane 存活會失準（本次行程數持續為 1，無法用來判斷子任務起訖）。
- **建議**：monitoring 指引改以「檔案系統實際變更」為主訊號，而非行程數；或由 lane 主動回報進度。

### 5.【Medium】長時間背景 codex 缺乏 hang 偵測指引

- doctrine 要求「自己重跑驗證」，但對「背景長跑的 codex 如何判斷卡死 vs 正常運作」無指引。我需自建 watchdog（檔案變更 + stall 偵測）。且 watchdog 若只看部分路徑會誤報 stall（本次 install / 根層編輯 / 推理階段都被誤判為 stall）。
- **建議**：doctrine 附一個「背景 lane 進度/卡死 watchdog」樣板，並提醒涵蓋 install、根層檔案、推理等「不產生目標檔案」的階段，避免誤報。

## 流程問題

### 6.【Process】spec 中途變更需取消重派，與孤兒問題疊加

- doctrine 對「lane 回報 spec gap」有處理（給修正後的 spec），但對「**使用者中途改需求**」需取消重派的情境無指引；此情境又與問題 1（孤兒行程）疊加放大風險。
- **建議**：加「安全中止並重派」流程：先確認子行程終止 → 確認工作樹狀態 → 再重派。

### 7.【Low】重置 lane 部分產物時的清理安全提示不足（本次操作者失誤）

- 清理被污染的工作樹時，操作者用了過廣的 `git clean -fdx`，因 `.gitignore` 只含 `node_modules/`，連未追蹤的 `.claude/`、`.agents/` 一併刪除（不可復原）。此為操作者失誤，非 skill 缺陷，但 doctrine 可加一則安全提示。
- **建議**：doctrine 的「重置/清理」相關建議加註：清理 lane 產物時用**路徑精準**的刪除，避免 `git clean -x` 誤刪未追蹤但重要的目錄；優先 `git stash -u` 或明列路徑。

### 8.【Medium】審查 subagent 自行呼叫 CC 原生 advisor,增加延遲且層級重複(2026-07-22,F9 T6.1 審查)

- **情境**:負責 T6.1 獨立審查的 subagent(驅動 `codex exec -s read-only` 的審查 lane)在流程中另外等待 CC 原生 advisor 回覆,使整輪審查時間顯著拉長(architect 一度誤判 lane 卡死而催報)。
- **問題**:審查鏈已有三層獨立視角(codex 跨供應商審查、subagent 自己的逐行覆核、architect 對每個 finding 的重驗),subagent 內再掛 advisor 是第四層,不增加新的失效偵測面,只增加延遲。且 doctrine 本來就明文「不得以 host 的 full-transcript advisor 替代 judgment lane」——advisor 的定位是 architect 在 commitment boundary 用的,不是 lane 內部工具;lane 的職責是產出 findings,裁決權在 architect。
- **建議**:
  - doctrine 在 lane 職責段落補一句硬規則:**implementer/review lane 不得自行呼叫任何 advisor/額外判斷層**;產出 findings 即回報,判斷交給 architect。
  - architect 派 lane 時在 spec 模板固定加註此限制(本專案自此開始照做)。

### 9.【Process】審查 lane 的兩段式判定未收斂前不應 commit(2026-07-22,F9 T6.2)

- **情境**:審查 lane 的流程是「自己驗證 → 先送判定 → codex 背景複查跑完再補充」。T6.2 拿到 lane 自驗的 APPROVE(帶 2 個非阻擋 finding)後,architect 修完即 commit;約 20 分鐘後背景 codex 複查完成,**推翻為 REQUEST-CHANGES**(2 HIGH:registry files 缺檔、跨 tree 實例無隔離——皆為 lane 自驗漏抓、architect 逐段讀 diff 也漏抓的真缺陷),只能以 follow-up commit 補修。
- **教訓**:兩段式審查的價值正是第二段的獨立視角;「先送判定」只是進度回報,不是可執行的收斂結果。cross-vendor 的第二段多次抓到第一段(同為 Claude 系)漏掉的問題(T6.1 第一輪同樣如此:lane 自驗草稿 APPROVE,codex 抓出 2 HIGH)。
- **建議**:doctrine 明定——lane 宣告「複查收斂」前,architect 不 commit(本地未 push 的情況下 follow-up 成本低,但若已 push/發佈,漏網 HIGH 的代價完全不同);若時間壓力必須先行,需在 commit 訊息明註「審查未收斂」。

### 10.【High】codex exec stdin hang 重複發生,prompt 層級提醒無效(2026-07-22,已兩次)

- **情境**:`codex exec` 未重導 stdin 時會停在「Reading additional input from stdin...」永久等待。已發生**兩次**:F8 審查(PID 33256,21 分鐘)與 F9 T6.2 收斂審查(PID 33628,43 分鐘、CPU 僅 2.5 秒),皆由 architect 以「wall time 長 + CPU 近零」特徵判定後手動 kill。
- **關鍵**:兩次派工 prompt 都**明確寫了**「記得 `</dev/null`」,lane 仍在多次呼叫中漏掉其中一次——次數一多,靠提醒必然失守。提醒不等於機制。
- **建議(結構性修法,擇一或並用)**:
  - agent 定義(`agents/codex-implementer.md`)的執行 recipe 把 stdin 重導寫成**硬性規則**:所有 `codex exec` 一律 `</dev/null`(或 `--no-stdin` 若 CLI 支援),不是「必要時」。
  - skill 提供 wrapper(如 `scripts/codex-exec.sh`)封裝重導與逾時,lane 只准經 wrapper 呼叫。
  - watchdog 常規化——但**不得以 CPU 時間為訊號**:第二次事件事後證實為誤判(該 codex exec 實際正常完成,exit 0、輸出完整;architect 依「43 分 wall + CPU 2.5 秒」誤殺於完成之後)。codex exec 的推理在遠端執行,本地行程 CPU 本來就近零,「wall 長 + CPU 低」對 codex 是常態不是 hang。可靠訊號是**輸出檔/stdout 是否推進**與是否停在「Reading additional input from stdin...」字樣;watchdog 應以輸出進度為準。
- **追加(使用者指出,第三次延宕的可疑根因)**:architect 派工時寫的 `</dev/null` 是 **Bash 專用**;lane 若在 PowerShell 執行,`<` 是保留字元,命令直接解析失敗——「提醒帶重導」本身就可能是跨 shell 的錯誤指令。skill 的 recipe 必須給**成對**的寫法:Bash `</dev/null`、PowerShell `$null | codex exec ...`,並註明不可混用;或乾脆由 wrapper script 統一(見上)。另:lane 失敗時**靜默閒置不回報**也是缺陷,agent 定義應要求「命令失敗必回報 stderr,不得靜默」。

### 11.【Process】互動元件的已知缺陷類型應前置於 spec,而非靠審查輪發現(2026-07-22,F9 T6.2)

- **情境**:T6.2(DnD × 虛擬化)歷經多輪審查才收斂,抓到的洞多屬 DnD 元件的**可預期缺陷類型**:事件 Enter/Leave 配對矩陣(含同列 zone 切換、目標卸載、卸載後直接命中另一列)、多實例隔離、拖曳中資料/回呼變更、drop 後殘留狀態、分發清單完整性(registry files vs import)。
- **教訓**:這些不是新奇缺陷,是這類元件的固定 checklist。architect 在初始 spec 就該列出,讓實作 lane 一次做對;事後靠審查輪逐個發現,每輪都是完整的「實作→重驗→審查」成本。
- **另一教訓(措辭校準)**:architect 每輪讀 diff 後應回報「未發現問題」而非「確認正確」——單次審查對互動語意的召回率有限,過度承諾會在下一輪被推翻,侵蝕對驗證聲明的信任。
- **建議**:skill 為常見元件類型(DnD、virtual list、表單、非同步快取)附「已知缺陷類型 checklist」模板,派工 spec 強制帶上對應段落。

### 12.【Process】lane 失效時,先驗證是否為 architect 自己的指令問題,再施加修正(2026-07-22,使用者指示)

- **情境**:codex 相關的多次「失效」中,至少一次的可疑根因是 **architect 派工指令本身**——`</dev/null` 為 Bash 專用語法,lane 若在 PowerShell 執行會直接解析失敗;architect 卻先後採取了 kill 行程、催報、重派等「修 lane」動作,而沒有先驗證自己的指令在對方執行環境是否有效。
- **原則(使用者明定)**:對 lane 的任何失效,**修正前先驗證失效的歸因**——依序排查:(1) architect 指令的語法/環境相容性(shell 差異、路徑、引號),(2) lane 的執行方式,(3) 工具本身。歸因未確認前不施加破壞性修正(kill/重派)。
- **建議**:doctrine 的 troubleshooting 段落把「先問是不是自己指令的問題」列為第一步;跨 shell 指令一律成對給出或改用 wrapper(見 #10)。

## 運作良好、值得保留的部分

- **preflight（`command -v codex && codex --version && codex login status`）**：能明確、快速確認 lane 可啟動；本次一次到位。
- **五段式 spec 契約**：context-free、可直接餵給 codex；codex 依 spec 正確產出（含遵守 pnpm add + 具名 catalog 規範）。
- **「不採信 lane 自述、自己重跑驗證」**：正確且必要。
- **cross-vendor 審查價值**：由 Claude architect 審 GPT 產出，確實抓到需要修正處。
- **允許 lane 讀取參考專案（filter-search）取 mechanics**：大幅降低猜測（TS 雙軌 alias、catalog、tsconfig 一次到位）。
