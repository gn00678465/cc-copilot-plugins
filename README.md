# cc-copilot-plugins

本專案是一個 Claude Code Marketplace 倉庫，收錄多個可重用插件；其中也包含供 GitHub Copilot CLI 工作流使用的相關技能與設定。

## 插件清單

| 插件 | 版本 | 適用環境 | 說明 |
|------|------|----------|------|
| `cc-copilot-plugin` | 0.1.2 | Claude Code / GitHub Copilot CLI 工作流 | Commit / PR 工作流插件，包含 `commit-message`、`pull-request` 等技能 |
| `code-review` | 0.1.0 | Claude Code + 本機 `copilot` CLI | 自動化多輪 code review loop，強制分離 writer / reviewer 角色，提供 `/code-review-loop` 與 `/cancel-review` |

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
/reload-plugins
```

**option2**
.claude/settings.json
```
{
  "enabledPlugins": {
    "cc-copilot-plugin@cc-copilot-plugins": true,
    "code-review@cc-copilot-plugins": true
  }
}
```

安裝完成後可使用：

- `cc-copilot-plugin`: `commit-message`、`pull-request`
- `code-review`: `/code-review-loop`、`/cancel-review`

> `code-review` 另需先安裝 GitHub Copilot CLI，並確認 `copilot` 可於 `PATH` 中執行。

## VS Code (Agent Plugins & Custom Prompts)

VS Code 已支援 Agent Plugins（Preview）。若您要在 VS Code 內使用本倉庫的插件來源，請先確認 `settings.json` 已啟用：

```json
{
  "chat.plugins.enabled": true
}
```

接著可在 `chat.plugins.marketplaces` 中加入此儲存庫：

```json
"chat.plugins.marketplaces": [
  "gn00678465/cc-copilot-plugins"
]
```

若要直接使用專案中的 prompt 檔案，也可搭配 `chat.promptFilesLocations` 指向 `prompts/`。

## GitHub Copilot CLI

如果您已安裝 [GitHub Copilot CLI](https://github.com/github/copilot-cli)，可以安裝對應插件並查看清單：

```bash
copilot plugin install gn00678465/cc-copilot-plugins
copilot plugin list
```

## 目錄

- [`plugins/cc-copilot-plugin`](./plugins/cc-copilot-plugin)
- [`plugins/code-review`](./plugins/code-review)

## 參考

- [VS Code docs: Custom prompt files](https://code.visualstudio.com/docs/copilot/customization/overview?originUrl=%2Fdocs%2Fcopilot%2Fcustomization%2Fprompt-files)
- [GitHub Docs: Plugins for Copilot CLI](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/plugins-finding-installing)
- [Will 保哥整理的最佳 GitHub Copilot 設定](https://github.com/doggy8088/github-copilot-configs)
- [Awesome GitHub Copilot Customizations](https://github.com/github/awesome-copilot)
