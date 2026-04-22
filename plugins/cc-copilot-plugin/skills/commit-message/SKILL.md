---
name: commit-message
description: 分析 git staged changes 並根據 Conventional Commits (1.0.0-beta.4) 規範自動生成繁體中文 commit message 與建議的分支名稱。使用時機包括：(1) 需要為已暫存 (staged) 的變更生成符合規範的提交訊息、(2) 需要根據變更內容建議一個有意義的分支名稱、(3) 確保提交包含正確的類型 (type) 與範圍 (scope)、(4) 在主分支 (main/master) 工作時需要自動化分支建議。適用於包含「幫我寫 commit message」、「產生 commit」、「建立 branch」、「取個分支名」、「提交變更」等請求的情境。會根據變更量與風險自動選擇簡單或詳細的提交模式。
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

- **描述、正文必須使用繁體中文**（台灣慣用技術詞彙，見下方「常用技術詞彙對照」）

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
3. **將完整的 Commit Message 覆寫至 `.git/COMMIT_EDITMSG`**（使用檔案寫入工具）。
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

## 常用技術詞彙對照

| 英文 | 繁體中文（台灣慣用） |
|------|---------------------|
| package | 套件 |
| config/configuration | 設定 |
| script | 腳本 |
| dependency | 相依性 |
| component | 元件 |
| module | 模組 |
| function | 函式 |
| variable | 變數 |
| parameter | 參數 |
| implement | 實作 |
| initialize | 初始化 |
| optimize | 優化 |
| refactor | 重構 |
| validate | 驗證 |
| authentication | 認證 |
| authorization | 授權 |
| bug | 臭蟲 |
| pull request | 拉取請求 |

## 參考資料

- `references/conventional-commits-spec.md` - 慣例式提交 1.0.0-beta.4 完整規範
- `references/examples.md` - 各類型 commit message 範例集
- [Conventional Commits 官方網站](https://www.conventionalcommits.org/zh-hant/v1.0.0-beta.4/)
- [SemVer 語意化版本](https://semver.org/lang/zh-TW/)
- [@commitlint/config-conventional](https://github.com/conventional-changelog/commitlint/tree/master/%40commitlint/config-conventional)
