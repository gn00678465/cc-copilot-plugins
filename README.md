# cc-copilot-plugins

本專案收錄多個可重用的 AI 編碼代理插件，支援 Claude Code、Codex 及 OpenCode 等平台。

## 插件清單

| 插件 | 版本 | 適用平台 | 說明 |
|------|------|----------|------|
| `cc-copilot-plugin` | 0.1.3 | Claude Code / Codex | Commit / PR 工作流插件，包含 `commit-message`、`pull-request` 等技能 |
| `code-review` | 0.1.0 | Claude Code | 自動化多輪 code review loop，強制分離 writer / reviewer 角色，提供 `/code-review-loop`、`/continue-loop` 與 `/cancel-review` |
| `review-forge` | 0.1.0 | Claude Code / Codex / OpenCode | 多模型程式碼審查工作流：獨立審查 → 彙總去重 → 交叉投票 → 信心排序最終報告 → 核准修復 → 獨立驗證 |

## Claude Code 安裝方式

先加入 Marketplace 來源：

```text
/plugin marketplace add gn00678465/cc-copilot-plugins
```

再依需求安裝插件：

**option1**
```text
/plugin install cc-copilot-plugin@cc-copilot-plugins
/plugin install code-review@cc-copilot-plugins
/plugin install review-forge@cc-copilot-plugins
/reload-plugins
```

**option2**
.claude/settings.json
```
{
  "enabledPlugins": {
    "cc-copilot-plugin@cc-copilot-plugins": true,
    "code-review@cc-copilot-plugins": true,
    "review-forge@cc-copilot-plugins": true
  }
}
```

安裝完成後可使用：

- `cc-copilot-plugin`: `commit-message`、`pull-request`
- `code-review`: `/code-review-loop`、`/continue-loop`、`/cancel-review`
- `review-forge`: `review-forge` skill（`review` / `synthesize` / `vote` / `report` / `fix` / `verify` 六階段命令）

> `code-review` 另需先安裝 GitHub Copilot CLI，並確認 `copilot` 可於 `PATH` 中執行。

## Codex 安裝方式

**方式一：透過 opencode-market**

```bash
npx opencode-market add gn00678465/cc-copilot-plugins
npx opencode-market install review-forge@cc-copilot-plugins --local
```

**方式二：手動複製 skill 目錄**

將 skill 檔案複製到專案的 `.agents/skills/` 目錄，Codex 會自動發現：

```bash
cp -r plugins/review-forge/skills/review-forge .agents/skills/
cp -r plugins/cc-copilot-plugin/skills/* .agents/skills/
```

每個 skill 目錄內含 `agents/openai.yaml` 提供 Codex UI 顯示名稱與預設 prompt。

## OpenCode 安裝方式

**方式一：透過 opencode-market（推薦）**

```bash
# 註冊 marketplace
npx opencode-market add gn00678465/cc-copilot-plugins

# 安裝到 .opencode/（OpenCode 專用）
npx opencode-market install review-forge@cc-copilot-plugins --opencode

# 或安裝到 .agents/（跨平台共用）
npx opencode-market install review-forge@cc-copilot-plugins --local
```

**方式二：手動複製 skill 目錄**

將 skill 複製到專案的 `.opencode/skills/`，OpenCode 會自動發現：

```bash
cp -r plugins/review-forge/skills/review-forge .opencode/skills/
```

## 目錄

- [`plugins/cc-copilot-plugin`](./plugins/cc-copilot-plugin)
- [`plugins/code-review`](./plugins/code-review)
- [`plugins/review-forge`](./plugins/review-forge)

## 參考

- [Claude Code Plugins](https://docs.anthropic.com/en/docs/claude-code/plugins)
- [Codex Agent Skills](https://github.com/openai/skills)
- [OpenCode Plugins](https://opencode.ai/docs/plugins/)
- [OpenCode Skills](https://opencode.ai/docs/skills/)
