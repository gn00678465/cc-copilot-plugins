# Pull Request 描述範本 (v0.2.0)

這是 Pull Request 描述與標題的標準格式指南。

---

## 標題格式 (Conventional Commits)

標題必須嚴格遵循：`<type>(<scope>): <summary>`

### 範例：
- **功能 (Feature)**: `feat(auth): 實作 JWT 登入機制`
- **修復 (Bug Fix)**: `fix(ui): 修正購物車跳轉錯誤`
- **破壞性變更 (Breaking Change)**: `feat(api)!: 移除 v1 版本舊端點`
- **無 Scope (General)**: `chore: 更新開發套件版本`

---

## 描述格式 (Standard Body)

```markdown
### 摘要
[一句話總結此 PR 的核心目的，例如：「實作使用者登入功能並整合 JWT 驗證」]

### 修改內容
- 變更點一：描述具體的修改內容
- 變更點二：描述具體的修改內容
- 變更點三：描述具體的修改內容

### ⚠️ 風險評估與破壞性變更
[評估此 PR 是否有破壞性變更、需要特別注意的地方]

常見風險：
- 資料庫 Schema 變更 (Migration)
- API 回應格式變更 (Breaking API)
- 環境變數變更 (ENV Change)

若無風險，標註：「無破壞性變更」

### 相關連結
- [Linear 連結](https://linear.app/...)
- [GitHub Issue] (closes #123)

### 備註 (選填)
- 測試帳號、部署提示或截圖。
```

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
   - 當變更會造成既有功能無法運作時，務必在標記加上 `!`。
