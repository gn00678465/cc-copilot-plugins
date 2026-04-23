# Pull Request 描述範本 (v0.4.0)

這是 Pull Request 描述與標題的標準格式指南。SKILL.md 會依據 PR 規模選擇使用精簡版或完整版。

---

## 標題格式 (Conventional Commits)

標題必須嚴格遵循：`<type>(<scope>): <summary>`

### 範例：
- **功能 (Feature)**: `feat(auth): 實作 JWT 登入機制`
- **修復 (Bug Fix)**: `fix(ui): 修正購物車跳轉錯誤`
- **破壞性變更 (Breaking Change)**: `feat(api)!: 移除 v1 版本舊端點`
- **無 Scope (General)**: `chore: 更新開發套件版本`

---

## PR 規模判斷

| 條件 | 使用版本 |
|------|---------|
| commits ≤ 2 **且** 變更檔案 ≤ 10 | 精簡版 |
| 其餘情況 | 完整版 |

判斷方式（先動態偵測預設分支，避免硬編 `main`）：
```bash
BASE=$(gh repo view --json defaultBranchRef --jq '.defaultBranchRef.name')

# commit 數
git log "origin/$BASE..HEAD" --oneline | wc -l

# 變更檔案數
git diff --name-only "origin/$BASE..HEAD" | wc -l
```

---

## 精簡版描述（Small PR）

使用時機：commits ≤ 2 且變更檔案 ≤ 10

```markdown
### 摘要
[一句話描述此 PR 核心目的]

### 修改內容
- 變更點一
- 變更點二

### Why（選填，動機不明顯時填寫）
[若變更原因不明顯，一句話說明]

### 變更類型
- [ ] 新增功能 (feat)
- [ ] 修復錯誤 (fix)
- [ ] 重構 (refactor)
- [ ] 文件 (docs)
- [ ] 測試 (tests)
- [ ] 其他 (chore / ci / perf)
```

---

## 完整版描述（Standard PR）

使用時機：其餘情況

```markdown
### 摘要
[一句話總結此 PR 的核心目的]

### 修改內容
- 變更點一：描述具體的修改內容
- 變更點二：描述具體的修改內容
- 變更點三：描述具體的修改內容

### Why
**商業背景：** [說明這個變更解決什麼問題或滿足什麼需求]
**技術理由：** [說明為何採用此技術方案，有哪些備選方案被排除]

### Testing
- [ ] 單元測試通過且覆蓋新功能
- [ ] 使用者介面變更已完成手動測試
- [ ] 效能 / 安全性考量已確認

### ⚠️ 風險評估與破壞性變更
[評估此 PR 是否有破壞性變更。若無，標註：「無破壞性變更」]

常見風險：
- 資料庫 Schema 變更 (Migration)
- API 回應格式變更 (Breaking API)
- 環境變數變更 (ENV Change)

### 相關連結
- [Linear 連結](https://linear.app/...)
- GitHub Issue 參照（格式見下方「Issue 參照語法」）

### 變更類型
- [ ] 新增功能 (feat)
- [ ] 修復錯誤 (fix)
- [ ] 重構 (refactor)
- [ ] 文件 (docs)
- [ ] 測試 (tests)
- [ ] 其他 (chore / ci / perf)

### 備註（選填）
- 測試帳號、部署提示或截圖
```

---

## Deployment 區塊（選用）

**觸發條件：** 符合以下任一情況時，在完整版描述的「備註」前插入此區塊：
- 使用者訊息含 `deploy`、`migration`、`env`、`feature flag` 等字詞
- Commit 訊息含 `migration`、`deploy`、`infra` 等字詞
- 變更檔案路徑含 `migrations/`、`infra/`、`.env` 等模式

```markdown
### Deployment
- [ ] 資料庫 Migration 腳本已準備，Rollback 計畫確認
- [ ] 環境變數更新需求已列出
- [ ] Feature Flag 設定已確認
- [ ] 第三方服務整合已更新
- [ ] 相關文件已同步更新
```

---

## Issue 參照語法

在 PR 描述中可使用下列關鍵字連結或關閉 issue：

| 語法 | 效果 |
|------|------|
| `Fixes #1234` | PR merge 時自動關閉 GitHub issue #1234 |
| `Closes #1234` | 同上（等效於 Fixes） |
| `Resolves #1234` | 同上（等效於 Fixes） |
| `Refs #1234` | 僅連結，不關閉 issue |
| `Fixes OWNER/REPO#1234` | 跨 repo 關閉（需有權限） |
| `Refs LINEAR-ABC-123` | 連結 Linear 單號（純文字標記） |
| `Refs INTERNAL-1234` | 連結內部單號（純文字標記，避免 PII） |

> **注意**：GitHub 只會因 `Fixes` / `Closes` / `Resolves` 這類關鍵字在 merge 時自動關閉 issue；其他標記僅作連結之用。

---

## 標題編寫指南

1. **祈使句 (Imperative)**:
   - ✅ `feat: Add login api`
   - ❌ `feat: Added login api`
2. **首字母大寫 (Capitalized)**:
   - ✅ `fix: Resolve memory leak`
   - ❌ `fix: resolve memory leak`
3. **結尾無句點 (No period)**:
   - ✅ `docs: Update readme`
   - ❌ `docs: Update readme.`
4. **破壞性變更標記 (!)**:
   - 當變更會造成既有功能無法運作時，務必在類型後加上 `!`。
