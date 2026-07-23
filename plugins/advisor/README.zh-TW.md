# Advisor

*[English](README.md) | [繁體中文](README.zh-TW.md)*

**最聰明的模型負責決策,便宜的模型負責打字。**

Claude Code 讓每個 subagent 都能跑在不同模型上——而且 session 本身也可以跑在跟它的 subagent 不同的模型上。這個 plugin 利用這一點,建立**架構師模式(architect pattern)**:你的 session 跑在 **Fable 5**(Anthropic 最強的模型)上,全職擔任架構師。它負責需求、拆解、規格與驗證——並把每個實作任務路由到成本最低、足以勝任的 lane:

| Lane | 產出者 | 呼叫方式 | 適用時機 |
|---|---|---|---|
| Routine | **Grok 4.5** | `grok-implementer` agent(預設) | spec 已經完全決定結果——Grok 透過 [Grok CLI](https://x.ai/cli) 負責打字 |
| Cross-vendor | GPT-5.6 Sol(高推理) | `codex-implementer` agent | 正確性要求高,或想要一份獨立實作來比對 |
| Judgment | Fable 5(→ 不可用時降級為 Opus 4.8) | `claude-advisor` agent | 承諾邊界(commitment boundaries)——見下方 |

Token 依照用量分配:貴的模型只出最少的 token(判斷跟 spec),便宜的 lane 出最多(程式碼)。實作機制佔一個 session 約 90% 的 token,而 Grok 4.5 能以接近同等的品質處理——所以這樣跑遠比全程用 Fable 便宜,而且每一次實作都來自跟架構師**不同的模型家族**:跨供應商審查是內建在路由裡的,不是事後補上去的。對高風險工作,可以讓 `grok-implementer` 跟 `codex-implementer` 對同一份 spec 賽跑——每個 lane 各自在獨立的 `git worktree` 裡跑,絕不共用同一棵工作樹——architect 再挑出比較強的 diff。

這個 plugin 隨附 **orchestration skill**——教 session 什麼時候用哪個 lane 的路由 doctrine、讓貴模型自己的 token 用量降到最低的成本紀律(輸出判斷而非輸出量、保持 context 精簡、想一次就交出去)、讓 context-free 委派安全的五段式 spec contract(外加一條 data-governance 規則,確保機密跟憑證不會被送進第三方的 `grok`/`codex` CLI),以及讓便宜 lane 保持誠實的驗證規則。

## 安裝

```
claude plugin marketplace add <your-org-or-path>/advisor
claude plugin install advisor@advisor
```

更新既有安裝到最新版本:

```
claude plugin marketplace update advisor
claude plugin update advisor@advisor
```

接著把你的 session 啟動為架構師:

```
/model fable
```

**輕量模式——一個檔案,30 秒搞定。** 不想要完整的模式?把 [`agents/claude-advisor.md`](agents/claude-advisor.md) 複製到 `~/.claude/agents/`,session 繼續留在 Sonnet 上。你會在承諾邊界拿到 advisor 諮詢,但不需要整套 orchestration layer(見下方「Advisor-only 模式」)。

## 需求

- **Claude Code ≥ 2.1.170**,訂閱方案要包含 Fable 5(Pro、Max、Team 或 Enterprise——目前所有消費者方案都符合)。
- **完全沒有 Fable 權限**(例如用 API key 計費)?把 session 改用 `/model opus`,並把 advisor 檔案裡的 `model: fable` 改成 `model: opus`。同樣的模式,模型層級整體降一階。(這跟 Fable **暫時性不可用**是兩回事——那種情況 Judgment lane 已經會自動降級到 Opus 4.8,不需要手動改。)
- **Grok lane(預設的實作者):** `grok-implementer` agent 需要裝好並登入 [xAI Grok CLI](https://x.ai/cli)(從 [x.ai/cli](https://x.ai/cli) 安裝,然後 `grok login`)。它會以無介面模式驅動 **Grok 4.5**(`grok --prompt-file … -m grok-4.5`)。沒裝的話,agent 會回報 `STATUS: unavailable`——它絕對不會靜默退回成 Claude 模型。
- **Codex lane(選用):** `codex-implementer` agent 需要裝好並登入 [OpenAI Codex CLI](https://github.com/openai/codex)(`npm i -g @openai/codex`,然後 `codex login`)。它會以 `gpt-5.6-sol`、`model_reasoning_effort=high` 呼叫 **GPT-5.6 Sol**。GPT-5.6 的存取權在預覽期間可能受限;沒有模型存取權、沒裝/沒登入 CLI,或認證失敗時,agent 會回報 `STATUS: unavailable`,其他 lane 不受影響。
- 提醒:如果你帳號裡沒有某個釘選的 Claude 模型,Claude Code 會靜默退回到你的 session 模型——這個模式會悄悄降級,不會報錯。如果結果感覺沒那麼厲害,檢查一下你的方案。(這種靜默退回只適用於 Claude 模型的釘選;grok 跟 codex 這兩個 lane 永遠會用結構化錯誤大聲回報失敗。)

Claude Code 的模型解析順序:`CLAUDE_CODE_SUBAGENT_MODEL` 環境變數 → 每次呼叫的 `model` 參數 → agent frontmatter → session 模型。

## 開始使用

session 跑在 Fable 上時,直接開口要求工作——orchestration skill 會負責路由:

```
Add rate limiting to our public API. Design it, delegate the
implementation, and verify the evidence before you call it done.
```

架構師會寫 spec、挑 lane(這個 rate limiting 涉及並行處理,適合讓 `grok-implementer` 跟 `codex-implementer` 賽跑)、在報告回來時讀 diff 跟驗證證據,最後才回報完成。

想讓這套 doctrine 永遠自動套用,在你專案的 `CLAUDE.md` 加一行:

```
You are the architect running the most expensive model — minimize your
own token volume. Delegate all implementation through the orchestration
skill's routing table (never type code yourself), delegate broad codebase
exploration to cheap read-only agents, and verify evidence before
accepting any lane's report.
```

**單次呼叫可以釘住 advisor 用的模型**,用 `--advisor <fable|opus>`,繞過預設的 Fable-first 邏輯:

```
/orchestration --advisor opus fix the checkout race
```

這個旗標只會釘住誰來跑 `claude-advisor`(Judgment lane)——`grok-implementer`、`codex-implementer` 是產出者,不是顧問,所以沒有對應的旗標可以強制指定其中之一;要強制指定實作者,直接在任務描述裡講清楚(例如「用 grok-implementer 做這個」)。詳情見 orchestration skill 的「Overriding the advisor model」章節。

## 在 Claude Code 之外使用

`agents/*.md` 是 Claude Code 專屬的 subagent 定義檔——只有 Claude Code 的 Agent 工具能載入。如果你的 session 本身是跑在別的 CLI 裡(Codex、Grok,或任何非 Claude Code 的 shell):

- `claude-advisor` 用內附的腳本:`node scripts/dispatch-claude-advisor.js <briefFile> [model] [fallbackModel]`。把 advisor 的 persona 灌進一個裸的 `claude -p` 子行程,是一個真正棘手的機制問題(system prompt 注入、model-fallback 偵測),值得寫一支專門的腳本,而不是每次呼叫都重新兜一次。它會印出單行 JSON 狀態(`{"status": "complete"|"timeout"|"invocation_error"|"unavailable", "outputFile": ..., "modelUsed": ..., "degraded": ...}`),不會讀 diff、不會重跑驗證、也不會寫報告——這些判斷工作留給架構師,跟透過 Agent 工具派工時一樣。
- `codex-implementer`——以及任何唯讀的 codex 審查 pass——用內附的 dispatcher:`node scripts/dispatch-codex.js <specFile> [--mode implement|review] [--timeout <秒>] [--pidfile <path>]`。spec 全文確實就是完整的 prompt,但行程生命週期並不簡單:腳本會在寫入 spec 後關閉 codex 的 stdin(繼承到開著的 pipe 會讓 `codex exec` 永久等待 EOF)、在行程內強制執行逾時上限、逾時或取消時擊殺整棵行程樹,並在啟動當下記錄子行程 PID 供安全重派查核。在任何 host 上都禁止手組 `codex exec` 指令。
- `grok-implementer` 沒有對應腳本——`grok --prompt-file` 從檔案讀 spec(沒有 stdin 風險),直接照 `agents/grok-implementer.md` 裡記載的方式組出 CLI 呼叫就好。

## 承諾邊界(Commitment boundaries)

就連架構師也需要第二意見。`claude-advisor` agent 是一個唯讀的懷疑論者——在架構決策、遷移、API 設計之前,以及任何問題卡了兩次以上時被諮詢。它會讀你實際的程式碼,在 300 字以內給出判斷。它從不動手實作。就算 session 已經跑在 Fable 上,呼叫它依然值得——它能用不帶對話累積假設的新鮮視角看程式碼。

**精簡的諮詢摘要——只給路徑,不給檔案全文。** orchestration skill 的 **consult contract** 是 implementer 用的 **spec contract** 在判斷面的對應版本。五個必要項目都要給:Decision、Constraints、Options、Stakes、Pointers(≤8 個路徑/符號)。不要塞對話歷史、檔案全文或工具紀錄;advisor 會自己開啟列出的路徑,不完整的摘要會被判定為 `INVALID BRIEF`。拿到判斷後,架構師必須明確下達 `DISPOSITION: ADOPT | REJECT | RECONSULT — <evidence>`——悶不吭聲就是流程失敗。RECONSULT 每個決策最多兩輪;到第三輪就該改成單方面下決定,避免一個可以無限次重新諮詢的決策,反過來拖垮這套模式原本要維護的成本紀律。諮詢驗證就是那三個關卡(摘要備妥 → 判斷可用 → 下決定);實作完成後,架構師仍然要**自己重跑**驗證指令,不能只讀 lane 回報的內容。

## Advisor-only 模式(原始版本)

反過來的安排,如果你想讓 session 本身維持便宜:session 跑 Sonnet,只在承諾邊界諮詢 `claude-advisor`。

```
Migrate our checkout sessions from Postgres to Redis — plan it,
consult your advisor before committing (lean brief: decision, options,
constraints, stakes, file pointers), then implement.
```

一次諮詢通常只要幾分錢。想自動套用,加進專案的 `CLAUDE.md`:

```
Before committing to any architecture decision, migration, or refactor
touching 3+ files, consult the claude-advisor agent with the consult
contract (Decision, Constraints, Options, Stakes, Pointers — no file
dumps), act on its verdict or surface disagreement (disposition), then
continue.
```

## 常見問題

**這是 Anthropic 的「advisor tool」嗎?** 不是——那是伺服器端的 API 功能。這裡用的是純粹的 Claude Code subagent 加上一個 skill:可讀、可改,不需要任何 beta flag。

**在 claude.ai 上能用嗎?** 不行——subagent 模型路由只有 Claude Code 才有(CLI、桌面版、VS Code、網頁版)。

**為什麼不乾脆全程用 Fable?** 可以,它很強。但它也是每個 token 最貴的 lane,而一個 session 大部分的 token 都花在實作機制上,便宜的 lane 能以接近同等的品質處理。把預算花在真正需要判斷力的地方。

**為什麼一個 Claude plugin 裡會有 Grok 跟 GPT-5.6 Sol 這兩個 lane?** 供應商多樣性。同一個模型家族容易有共同的盲點;來自不同系譜的獨立實作,能抓到同家族審查抓不到的東西——而且因為架構師是 Claude,現在**每一份** diff 都免費拿到跨供應商審查。架構師固定是 Claude——這些 lane 是產出者,不是裁判。

## 深入閱讀

我在 [**Attention Heads**](https://attentionheads.substack.com/?utm_source=github&utm_medium=readme&utm_campaign=advisor) 寫關於 AI、認知與 agentic engineering 的深度、有實證支持的文章。**Agentic Engineering Field Notes** 系列是我發布 AI 實務應用心得的地方。[訂閱](https://attentionheads.substack.com/subscribe?utm_source=github&utm_medium=readme&utm_campaign=advisor)以收到新文章通知。

## 授權

MIT
