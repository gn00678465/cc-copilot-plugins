---
name: commit-message
description: 分析 git staged changes 並根據 Conventional Commits (1.0.0-beta.4) 規範自動生成繁體中文 commit message 與建議的分支名稱。使用時機包括：(1) 需要為已暫存 (staged) 的變更生成符合規範的提交訊息、(2) 需要根據變更內容建議一個有意義的分支名稱、(3) 確保提交包含正確的類型 (type) 與範圍 (scope)、(4) 在主分支 (main/master) 工作時需要自動化分支建議。適用於包含「commit this」、「create a commit」、「make a commit」、「write a commit message」、「save my changes」、「commit staged changes」、「幫我寫 commit message」、「產生 commit」、「建立 branch」、「取個分支名」、「提交變更」等請求的情境。會根據變更量與風險自動選擇簡單或詳細的提交模式。
---

# 慣例式提交與分支助手

根據 [Conventional Commits 1.0.0-beta.4](https://www.conventionalcommits.org/zh-hant/v1.0.0-beta.4/) 規範，分析 git staged changes 並自動生成繁體中文 commit message 與建議的分支名稱。

> **完整規範細節請參考 `references/conventional-commits-spec.md`**；本檔只保留 skill 的執行流程與本 skill 特有的格式約束。

## 核心功能

1. **分支建議 (Branch Suggestion)**：根據變更檔案內容自動生成語意化的 Git 分支名稱。
2. **提交訊息 (Commit Message)**：自動生成符合 Conventional Commits 規範的繁體中文提交訊息。
3. **主分支保護 (Main Branch Protection)**：防止在 `main`/`master` 直接提交，並引導切換至建議分支。
4. **原子化拆分引導 (Atomic Split Guide)**：偵測高複雜度變更，引導使用者分批提交。

## 本 Skill 的格式約束

### 語言

- **描述、正文必須使用繁體中文**（台灣慣用技術詞彙對照見 `references/terminology.md`）

### 描述（Subject）

- 緊接在類型/作用範圍的冒號與空格之後
- 限制在 **50 字元以內**
- 使用**祈使句**（如：「新增」、「修正」、「更新」）
- **不加句號**
- 清楚描述變更的核心內容

### 正文（Body）- 可選

- 描述後一個空行之後開始
- 使用項目符號列表（`-` 開頭）
- 每個項目描述一個具體變更
- **優先說明做了什麼，必要時補充原因**

### 作用範圍（Scope）- 可選

- 由描述程式區段的名詞組成，用括號包覆
- 範例：`feat(parser):`、`fix(api):`、`chore(eslint):`

### 類型速查表

| 類型 | 用途 | SemVer |
|------|------|--------|
| `feat` | 新增功能 | MINOR |
| `fix` | 修正臭蟲 | PATCH |
| `docs` | 文件更新 | — |
| `style` | 程式碼格式調整（不影響功能） | — |
| `refactor` | 重構程式碼 | — |
| `perf` | 效能優化 | — |
| `test` | 測試相關 | — |
| `build` | 建置系統或外部相依性 | — |
| `ci` | CI 設定檔案 | — |
| `chore` | 其他雜項 | — |
| `revert` | 撤銷先前的 commit | — |

### 重大變更（Breaking Changes）

兩種標示方式（擇一或合併使用）：

1. 類型後加 `!`：`feat(api)!: 變更使用者認證機制`
2. 頁腳標示：`BREAKING CHANGE: <描述>`（**`BREAKING CHANGE` 必須大寫**）

使用 `!` 時，正文或頁腳**必須**包含 `BREAKING CHANGE: description`。完整範例見 `references/examples.md`。

## 執行步驟

### 步驟 1：取得分析資訊

執行輔助腳本，輸出為單一 JSON 物件：

```bash
uv run <skill-dir>/scripts/analyze_git.py
# 或（無 uv 時）
python <skill-dir>/scripts/analyze_git.py
```

**輸出 JSON schema：**

```json
{
  "branch": "feature/foo",
  "is_main": false,
  "score": 7,
  "risk_factors": ["大量變更 (250 行)", "涉及認證或安全邏輯"],
  "files_changed": 4,
  "total_lines": 250,
  "insertions": 200,
  "deletions": 50,
  "files": {
    "new": ["src/login.tsx"],
    "modified": ["src/auth.ts"],
    "deleted": [],
    "renamed": []
  },
  "suggested_branches": ["feat/login", "feat/auth-logic"]
}
```

| 欄位 | 說明 |
|------|------|
| `files.new` | 新增的檔案（`git status` 顯示 `A`） |
| `files.modified` | 修改的現有檔案（顯示 `M`） |
| `files.deleted` | 刪除的檔案（顯示 `D`） |
| `files.renamed` | 重新命名或複製的檔案（`R`/`C`，格式 `"old -> new"`） |

若無 staged 變更，腳本會以非零 exit code 結束並於 stderr 輸出錯誤。

### 步驟 2：檢查分支

依 `is_main` 判斷：

**情況 A（安全分支）：** `is_main = false`
- 繼續執行步驟 3。

**情況 B（主分支）：** `is_main = true`
- **停止**後續操作。
- 依 `suggested_branches` 建議符合規範的**新分支名稱**（例如：`feat/login-form-validation`、`fix/payment-bug`）。
- **回報錯誤**：`請先切換至建議的分支（或自訂分支）後，再執行 commit。`

### 步驟 3：分析複雜度與模式

依 `score` 與 `risk_factors` 決定生成深度：

| 分數 | 模式 | 行為 |
|------|------|------|
| `< 4` | 簡單 | 生成單行 commit message（type + subject） |
| `4 ≤ score ≤ 8` | 詳細 | 生成含正文（Body）的 commit message |
| `> 8` | 拆分 | **進入步驟 4，停止單一 commit 流程** |

當 staged 變更**橫跨多種提交類型**（例如同時含 `feat` 與 `build`）時，即使 score ≤ 8 也應進入步驟 4。

### 步驟 4：原子化拆分提交

停止產出單一 commit message，改以拆分引導回應使用者：

1. 依變更類型/作用範圍將檔案分群。
2. 對每群輸出：
   - `git reset` 指令（取消目前 staging）
   - 該群要重新 `git add` 的檔案清單
   - 對應的 Commit Message
3. 建議使用者依序執行每群的 stage + commit。
4. 詢問是否需要協助逐步執行。

#### 範例

```markdown
### ⚠️ 偵測到高複雜度變更 (Score: 10)

本次變更涉及認證邏輯重構與套件更新，建議拆分為兩個提交以符合原子化原則：

#### 第一步：重構認證邏輯
1. 執行：`git reset`
2. 執行：`git add src/auth.ts src/security.ts`
3. Commit Message：`refactor(auth): 重構認證模組安全性邏輯`

#### 第二步：更新套件
1. 執行：`git add pnpm-lock.yaml`
2. Commit Message：`build: 更新相依性鎖定檔`
```

### 步驟 5：生成 Commit Message、寫入檔案並確認

1. **依檔案狀態決定 commit type**（優先使用，再搭配 diff 內容確認）：

   | 狀況 | 建議類型 |
   |------|---------|
   | `files.new` 為主，且為功能性程式碼 | `feat` |
   | `files.new` 為主，且為測試檔案（`*.test.*`, `*.spec.*`） | `test` |
   | `files.new` 為主，且為文件（`.md`, `.txt`） | `docs` |
   | 僅有 `files.modified`，修正問題邏輯 | `fix` |
   | 僅有 `files.modified`，程式碼重構（無功能變更） | `refactor` |
   | 僅有 `files.renamed` 或檔案搬移 | `refactor` |
   | 僅有 `files.deleted`（清理舊程式碼） | `chore` 或 `refactor` |
   | 混合多種狀態，涉及功能新增 | `feat`（並考慮拆分） |

2. 結合 `git diff` 內容確認描述的精確性。
3. **將完整的 Commit Message 覆寫至 `.git/COMMIT_EDITMSG`**：
   - ⚠️ **不要使用 Claude Code 的 `Write` 工具**。`.git/COMMIT_EDITMSG` 在任何一次 commit 之後就已經存在，`Write` 會以 `File has not been read yet. Read it first before writing to it.` 失敗。
   - ⚠️ **下方語法不可互換**。動手前先確認你的**執行通道**，選對應語法：

     | 執行通道 | 用哪段範例 | 判斷依據 |
     |---------|-----------|---------|
     | Claude Code `Bash` 工具 | **POSIX shell** | 即使在 Windows 也是 git-bash (`/usr/bin/bash`)。**不要**用 PowerShell 語法 |
     | Claude Code `PowerShell` 工具 | **PowerShell Core (`pwsh`, 6+)** | Claude Code 內建呼叫 `pwsh`（目前通常 7+），**不是** Windows 5.1 內建的 `powershell.exe` |
     | 終端機：bash / zsh / sh | POSIX | `echo $SHELL` |
     | 終端機：PowerShell | `$PSVersionTable.PSEdition` 判斷：`Core` → pwsh 範例、`Desktop` → 5.1 fallback | `$PSVersionTable.PSEdition` |
     | 其他 agent harness（Codex / Aider / 自訂） | 視該 harness 的 shell 而定，預設先試 POSIX；報 `Set-Content not found` 再切 PowerShell | 看 harness 文件或執行時觀察錯誤 |
     | `cmd.exe` | 本節範例皆不適用 | 切到 bash 或 pwsh |

     **常見誤用對照**：
     - PowerShell 的 `@'...'@`、`Set-Content` 丟給 bash → `@: No such file or directory`、`Set-Content: command not found`
     - bash 的 `<<'EOF'` 丟給 PowerShell → 被當成重新導向解析失敗
     - ⚠️ **不要用 PowerShell 的 `>` / `>>`**：5.1 的 `>` 走 `Out-File` 預設 UTF-16LE，會直接污染 commit 檔案
   - 確認通道後改用 shell 直接覆寫：
     - **POSIX shell (bash/zsh)**：
       ```bash
       cat > .git/COMMIT_EDITMSG <<'EOF'
       <type>(<scope>): <subject>

       - bullet 1
       - bullet 2
       EOF
       ```
     - **PowerShell Core (`pwsh`, 6+)**：
       > ⚠️ 閉合的 `'@` **必須在第 0 欄，不能有縮排**，否則 here-string 解析失敗。

       ```powershell
       @'
       <type>(<scope>): <subject>

       - bullet 1
       - bullet 2
       '@ | Set-Content -Encoding utf8NoBOM .git/COMMIT_EDITMSG
       ```

       必須用 `utf8NoBOM`（pwsh 6+ 才有此選項）。`Set-Content -Encoding utf8` 在 **Windows PowerShell 5.1** 會寫入 UTF-8 BOM (`EF BB BF`)，git 會把 BOM 當成 subject 首字元，破壞 commit 訊息。
     - **Windows PowerShell 5.1 fallback**：改用 .NET API 寫出無 BOM，並以 `git rev-parse --absolute-git-dir` 取得絕對路徑（支援 worktree 與子目錄；同時避免 .NET 與 PS 的 cwd 不同步）：
       ```powershell
       $msg = @'
       <type>(<scope>): <subject>

       - bullet 1
       - bullet 2
       '@
       $path = Join-Path (git rev-parse --absolute-git-dir) 'COMMIT_EDITMSG'
       [System.IO.File]::WriteAllText($path, $msg, [System.Text.UTF8Encoding]::new($false))
       ```
   - 若上述寫法在你的執行環境都不可用（例如受限 shell 或沒有檔案系統存取的沙箱），才退回「先 `Read` `.git/COMMIT_EDITMSG` 再 `Write`」的兩步流程。
4. 輸出對應的 `git commit` 指令：
   ```bash
   git commit -F .git/COMMIT_EDITMSG
   ```
5. **詢問使用者**：是否需要協助執行上述 commit 指令？

## 範例

詳細範例請參考 `references/examples.md`，涵蓋：

- **基礎範例**：feat、fix、docs、style、refactor、perf、test、build、ci、chore、revert
- **進階範例**：含作用範圍、破壞性變更、問題編號、共同作者、複雜變更
- **不良範例**：常見錯誤寫法與修正建議

**快速參考：**

```
feat: 新增使用者登入功能

- 實作 JWT 認證機制
- 新增登入表單驗證
```

```
fix(cart): 修正購物車金額計算錯誤

- 修正折扣碼套用順序問題
```

## 注意事項

- **僅 staged 狀態的變更會被考慮**；未 staged 的變更不會納入分析。建議先用 `git add` 選擇性地 stage 要提交的變更。
- **Lock 檔案偵測範圍**：`package-lock.json`、`yarn.lock`、`pnpm-lock.yaml`、`bun.lockb`、`Cargo.lock`、`go.sum`、`poetry.lock`、`Gemfile.lock`、`composer.lock`。
- 變更過於複雜時，優先拆分為多個獨立 commit。
- 當提交符合一或多種提交類型時，應盡可能切成多個提交。

## 參考資料

- `references/conventional-commits-spec.md` - 慣例式提交 1.0.0-beta.4 完整規範
- `references/examples.md` - 各類型 commit message 範例集
- `references/terminology.md` - 繁體中文（台灣慣用）技術詞彙對照
- [Conventional Commits 官方網站](https://www.conventionalcommits.org/zh-hant/v1.0.0-beta.4/)
- [SemVer 語意化版本](https://semver.org/lang/zh-TW/)
- [@commitlint/config-conventional](https://github.com/conventional-changelog/commitlint/tree/master/%40commitlint/config-conventional)
