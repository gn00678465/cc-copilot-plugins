# Commit Message 範例

本文件提供各類型 commit message 的完整範例，供參考使用。

## 基礎範例

### feat：新增功能

```
feat: 新增使用者登入功能

- 實作 JWT 認證機制
- 新增登入表單驗證
- 整合第三方 OAuth 登入
```

### fix：修復錯誤

```
fix: 修正購物車金額計算錯誤

- 修正折扣碼套用順序問題
- 更新稅金計算邏輯
```

### docs：文件更新

```
docs: 更新 API 使用說明文件

- 補充認證流程說明
- 新增錯誤代碼對照表
- 修正範例程式碼錯誤
```

### style：程式碼格式

```
style: 統一程式碼縮排格式

- 將 tab 轉換為 2 個空格
- 移除多餘的空白行
- 統一引號使用單引號
```

### refactor：重構程式碼

```
refactor(auth): 重構認證模組架構

- 抽離共用驗證邏輯至 utils
- 簡化 token 刷新流程
- 移除重複的錯誤處理程式碼
```

### perf：效能優化

```
perf(api): 優化資料庫查詢效能

- 新增索引至常用查詢欄位
- 實作查詢結果快取機制
- 減少 N+1 查詢問題
```

### test：測試相關

```
test(auth): 新增認證模組單元測試

- 新增登入流程測試案例
- 新增 token 過期處理測試
- 補充邊界條件測試
```

### build：建置系統

```
build: 升級建置工具至 Vite 5.0

- 更新 vite.config.ts 設定
- 調整建置輸出路徑
- 新增環境變數檔案範本
```

### ci：CI 設定

```
ci: 新增 GitHub Actions 自動部署流程

- 設定 main 分支自動部署至 production
- 新增 PR 自動執行測試
- 設定建置快取提升效率
```

### chore：雜項

```
chore(eslint): 設定 ESLint 樣式規則與自動修復功能

- 在 playground 中新增 ESLint stylistic 設定
- 設定 VSCode 儲存時自動使用 ESLint 修復
- 新增 lint:fix 腳本至 package.json
- 更新 ESLint 與 TypeScript 相關套件至最新版本
```

### revert：撤銷提交

```
revert: 撤銷「新增實驗性功能」

This reverts commit abc1234.

- 該功能導致生產環境效能問題
- 需重新評估實作方式
```

## 進階範例

### 含作用範圍（Scope）

```
feat(parser): 新增陣列解析功能

- 支援巢狀陣列結構
- 處理空陣列邊界條件
- 新增型別推斷機制
```

```
fix(payment): 修正信用卡付款失敗問題

- 修正卡號驗證正則表達式
- 處理跨國交易匯率轉換
- 新增付款失敗重試機制
```

### 破壞性變更（Breaking Changes）

**方式一：使用 `!` 標記**

```
feat(auth)!: 升級認證機制至 OAuth 2.0

- 移除舊版 session-based 認證
- 實作 OAuth 2.0 授權碼流程
- 更新所有 API 端點認證方式

BREAKING CHANGE: 所有 API 端點需使用新的 Bearer Token 認證
```

**方式二：僅在頁腳標示**

```
feat(api): 重新設計使用者 API 端點

- 將 /user 改為 /users
- 統一回應格式為 JSON:API 規範
- 移除已棄用的 v1 端點

BREAKING CHANGE: API 路徑與回應格式已變更，請參考遷移指南
```

**多項破壞性變更**

```
feat!: 升級至 v2.0 架構

- 重新設計資料模型
- 更新所有 API 端點
- 移除舊版相容層

BREAKING CHANGE: 資料庫 schema 已變更，需執行遷移腳本
BREAKING CHANGE: API v1 端點已移除，請使用 v2 端點
```

### 含問題編號

```
fix: 修正使用者無法登出的問題

- 清除本地儲存的 token
- 重設應用程式狀態
- 導向登入頁面

Closes #123
```

```
feat(search): 實作全文檢索功能

- 整合 Elasticsearch 搜尋引擎
- 新增搜尋結果高亮顯示
- 支援中文分詞搜尋

Refs #456, #789
```

### 含共同作者

```
feat: 新增多語系支援

- 實作 i18n 框架整合
- 新增繁體中文語系檔
- 新增英文語系檔

Co-authored-by: 王小明 <wang@example.com>
Co-authored-by: 李小華 <lee@example.com>
```

### 複雜變更（多段正文）

```
refactor(core): 重構核心引擎架構

本次重構旨在提升程式碼可維護性與測試覆蓋率。

主要變更：
- 採用依賴注入模式
- 抽離業務邏輯至 services 層
- 統一錯誤處理機制

效能影響：
- 初始化時間增加約 50ms
- 記憶體使用量減少 20%
- API 回應時間無明顯變化

遷移注意事項：
- 需更新 DI 容器設定
- 舊版 plugin 需重新編譯
```

## 不良範例（避免）

### ❌ 描述過於模糊

```
fix: 修正問題
```

應改為：

```
fix(cart): 修正購物車數量更新後未重新計算總價
```

### ❌ 混合多種類型

```
feat: 新增登入功能並修正註冊表單驗證
```

應拆分為：

```
feat(auth): 新增使用者登入功能
```

```
fix(auth): 修正註冊表單電子郵件驗證
```

### ❌ 描述加句號

```
feat: 新增搜尋功能。
```

應改為：

```
feat: 新增搜尋功能
```

### ❌ 未使用祈使句

```
feat: 新增了使用者登入功能
```

應改為：

```
feat: 新增使用者登入功能
```
