# PR Review Comment 格式規範

定義 PR 審查意見的格式標準，確保 review 報告一致、可掃描、易行動。

---

## 層級化格式

### Critical & Important → 完整三段 + Emoji

格式：

```
<emoji> **Issue:** <描述問題>
**Suggestion:** <具體改善方式或程式碼範例>
**Why:** <理由與影響說明>
```

範例（安全性）：

```
🔒 **Issue:** JWT token 簽發時未設定 expiry
**Suggestion:** 在 `jwt.sign()` 的 options 加入 `expiresIn: '1h'`
**Why:** 無期限 token 一旦洩漏無法撤銷，形成持續性安全漏洞
```

範例（效能）：

```
⚡ **Issue:** `getUserPosts()` 在迴圈內各自發出一次 DB query（N+1）
**Suggestion:** 改用 `include: { posts: true }` 以單次 JOIN 取得資料
**Why:** 100 個 user 會觸發 101 次查詢，在資料量大時嚴重影響回應時間
```

### Suggestion → 單行 + Emoji

格式：

```
<emoji> <描述建議>
```

範例：

```
🧹 `getUserList` 建議改為 `getUsers`，更符合 REST 命名慣例
📚 `processPayment()` 的複雜流程缺少內嵌說明，建議加上步驟註解
```

### 提問釐清 → 單行 + 💭

使用時機：不確定程式碼意圖時，先提問再給意見。

範例：

```
💭 `retryCount` 的預設值 3 是固定的業務規則，還是可調整的設定值？
```

### 正向回饋 → 單行 + ✅

使用時機：看到值得稱讚的設計或實作時，明確說出來。

範例：

```
✅ 使用 early return 避免深層巢狀，可讀性大幅提升
```

---

## Emoji 對應表

| Emoji | 類別 | 對應嚴重度 |
|-------|------|-----------|
| 🚨 | 阻擋合併的問題 | Critical |
| 🔒 | 安全性問題 | Critical / Important |
| ⚡ | 效能問題 | Important / Suggestion |
| 🧹 | 程式碼清理 | Suggestion |
| 📚 | 文件缺漏 | Suggestion |
| ✅ | 正向回饋 | — |
| 💭 | 提問釐清 | — |

---

## 嚴重程度定義

| 等級 | 定義 | 格式 |
|------|------|------|
| **Critical** | 程式崩潰、資料遺失、重大安全漏洞 | 完整三段 |
| **Important** | 違反規範、引入技術債、明顯影響維護性 | 完整三段 |
| **Suggestion** | 可改善清晰度但非錯誤 | 單行 |

---

## 報告結構

Review 報告（`gh-pr-review.md`）使用以下結構：

> 若某個等級無任何問題，該子區塊可省略，不需寫「無」。

```markdown
## PR Review：<PR 標題>

### 摘要
[整體評估，2-3 句話]

### 議題清單

#### 🚨 Critical
[完整三段格式的 critical 問題]

#### ⚠️ Important
[完整三段格式的 important 問題]

#### 建議
[單行格式的 suggestion 項目]

#### ✅ 值得稱讚
[正向回饋]

### 最終建議 (Verdict)
- **Approve** / **Request Changes** / **Comment**
- 理由說明
```
