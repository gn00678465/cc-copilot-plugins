# coding-agent-toolkit

本專案收錄多個可重用的 AI 編碼代理插件，支援 Claude Code、Codex 及 OpenCode 等平台。

## 插件清單

| 插件 | 版本 | 適用平台 | 說明 |
|------|------|----------|------|
| `cc-copilot-plugin` | 0.1.3 | Claude Code / Codex | Commit / PR 工作流插件，包含 `commit-message`、`pull-request` 等技能 |
| `advisor` | 1.0.0 | Claude Code / Codex | 架構師模式 model-routing：session 跑在 Claude 最強模型上負責規格與驗證，實作路由給 Grok 4.5（Grok CLI）與 GPT-5.6 Sol（Codex），並提供承諾邊界 advisor |
| `review-forge` | 0.1.0 | Claude Code / Codex / OpenCode | 多模型程式碼審查工作流：獨立審查 → 彙總去重 → 交叉投票 → 信心排序最終報告 → 核准修復 → 獨立驗證 |

## Claude Code 安裝方式

先加入 Marketplace 來源：

```text
/plugin marketplace add gn00678465/coding-agent-toolkit
```

再依需求安裝插件：

**option1**
```text
/plugin install cc-copilot-plugin@coding-agent-toolkit
/plugin install advisor@coding-agent-toolkit
/plugin install review-forge@coding-agent-toolkit
/reload-plugins
```

**option2**
.claude/settings.json
```
{
  "enabledPlugins": {
    "cc-copilot-plugin@coding-agent-toolkit": true,
    "advisor@coding-agent-toolkit": true,
    "review-forge@coding-agent-toolkit": true
  }
}
```

安裝完成後可使用：

- `cc-copilot-plugin`: `commit-message`、`pull-request`
- `advisor`: `orchestration` skill 與 `claude-advisor`、`grok-implementer`、`codex-implementer` agents
- `review-forge`: `review-forge` skill（`review` / `synthesize` / `vote` / `report` / `fix` / `verify` 六階段命令）

> `advisor` 另需先安裝 [Grok CLI](https://x.ai/cli) 與 Codex CLI，並確認 `grok`、`codex` 可於 `PATH` 中執行。

## Codex 安裝方式

先加入 Marketplace 來源：

```text
codex plugin marketplace add gn00678465/coding-agent-toolkit
```

再依需求安裝插件：

```text
codex plugin add cc-copilot-plugin@coding-agent-toolkit
codex plugin add advisor@coding-agent-toolkit
codex plugin add review-forge@coding-agent-toolkit
```

每個 skill 目錄內含 `agents/openai.yaml` 提供 Codex UI 顯示名稱與預設 prompt。

## OpenCode 安裝方式

**方式一：透過 opencode-market（推薦）**

```bash
# 註冊 marketplace
npx opencode-market add gn00678465/coding-agent-toolkit

# 安裝到 .opencode/（OpenCode 專用）
npx opencode-market install review-forge@coding-agent-toolkit --opencode

# 或安裝到 .agents/（跨平台共用）
npx opencode-market install review-forge@coding-agent-toolkit --local
```

**方式二：手動複製 skill 目錄**

將 skill 複製到專案的 `.opencode/skills/`，OpenCode 會自動發現：

```bash
cp -r plugins/review-forge/skills/review-forge .opencode/skills/
```

## 目錄

- [`plugins/advisor`](./plugins/advisor)
- [`plugins/cc-copilot-plugin`](./plugins/cc-copilot-plugin)
- [`plugins/review-forge`](./plugins/review-forge)

## 參考

- [Claude Code Plugins](https://docs.anthropic.com/en/docs/claude-code/plugins)
- [Codex Agent Skills](https://github.com/openai/skills)
- [OpenCode Plugins](https://opencode.ai/docs/plugins/)
- [OpenCode Skills](https://opencode.ai/docs/skills/)
