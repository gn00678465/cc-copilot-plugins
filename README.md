# Copilot Plugin

本專案包含一組用於 VS Code 與 GitHub Copilot CLI 的自定義插件與 Prompt 集合。

## 安裝與使用方式

### 1. VS Code (Agent Plugins & Custom Prompts)

VS Code 現已支援「Agent Plugins (Preview)」，這是一種更結構化的方式來封裝指令、技能與 Hook。

#### **A. 啟用 Agent Plugins 支援**
由於此功能目前處於預覽階段，請先確保您的 VS Code `settings.json` 具備以下設定：
```json
{
  "chat.plugins.enabled": true
}
```

#### **B. 遠端安裝 (Remote Plugin)**
您可以直接將此 GitHub 儲存庫註冊為插件來源：
1.  開啟 VS Code 設定 (JSON)。
2.  在 `chat.plugins.marketplaces` 中加入此儲存庫：
    ```json
    "chat.plugins.marketplaces": [
      "gn00678465/copilot-starter"
    ]
    ```
3.  **安裝插件**：
    - 開啟「延伸模組 (Extensions)」側邊欄。
    - 在搜尋框輸入 `@agentPlugins`（或點擊「...」> `Views` > `Agent Plugins`）。
    - 找到 **copilot-plugin-starter** 並點擊「安裝 (Install)」。
4. 設定 hooks 執行路徑
    - 設定外部 hooks 執行路徑設定以正確執行 hooks
    - 設定 COPILOT_PLUGIN_ROOT 環境變數或使用 .vscode/settings.json 設定
    ```json
    {
      "chat.hookFilesLocations": {
        "~/AppData/Roaming/Code/agentPlugins/github.com/github/copilot-plugins/plugins/copilot-starter/hooks/hooks.json": true,
      }
    }
    ```

#### **C. 其他自定義設定 (Legacy/Support)**
若要直接使用專案中的 Prompt 檔案或 Hook，本專案預設提供的 `.vscode/settings.json` 已包含：
- **Custom Prompts**: `chat.promptFilesLocations` (在 Chat 中輸入 `#` 引用 `prompts/` 內容)。
- **Hooks**: `chat.hookFilesLocations` (執行時自動載入 `./hooks` 邏輯)。
- **Commit Instructions**: 符合規範的 commit message 生成指令。

### 2. GitHub Copilot CLI (Remote Plugin)

如果您已安裝 [GitHub Copilot CLI](https://github.com/github/copilot-cli)，可以從 GitHub 遠端安裝此插件：

```bash
# 從 GitHub 安裝
copilot plugin install gn00678465/copilot-starter
```

安裝後，您可以透過以下指令查看已安裝的插件：
```bash
copilot plugin list
```


## 參考

- [VS Code docs: Custom prompt files](https://code.visualstudio.com/docs/copilot/customization/overview?originUrl=%2Fdocs%2Fcopilot%2Fcustomization%2Fprompt-files)
- [GitHub Docs: Plugins for Copilot CLI](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/plugins-finding-installing)
- [Will 保哥整理的最佳GitHub Copilot 設定](https://github.com/doggy8088/github-copilot-configs)
- [Awesome GitHub Copilot Customizations](https://github.com/github/awesome-copilot)