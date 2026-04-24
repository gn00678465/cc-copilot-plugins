# gh CLI 指令對照（建立 / 修改 / 查詢 PR）

本 skill 實際使用的 GitHub CLI 指令模式。所有指令假設已通過 `gh auth status`。

> **編碼鐵律**：含中文的欄位（title / body）一律以檔案輸入給 gh（`--body-file`、`-f key=@file`），**嚴禁** `--body "$(cat file)"` / `-f body="$(cat file)"` 類 shell 展開寫法。檔案必須是 UTF-8 無 BOM。完整背景見 `SKILL.md` 的「編碼規範」章節。

---

## 偵測預設分支

```bash
BASE=$(gh repo view --json defaultBranchRef --jq '.defaultBranchRef.name')
```

- 動態取得 repo 的預設分支（`main` / `master` / `develop` / 其他），取代硬編常數。
- 後續的 `git log "origin/$BASE..HEAD"` 與 `git diff "origin/$BASE...HEAD"` 皆應引用此變數。

---

## Pre-flight：檢查未提交變更

```bash
git status --porcelain
```

- 輸出為空 → 工作區乾淨，可進入後續流程。
- 輸出非空 → 停止流程，提示使用者先執行 `cc-copilot-plugin:commit-message` skill。

---

## 建立 PR

```bash
# 先把 PR 描述寫入 pr-body.md
gh pr create \
  --draft \
  --title "<type>(<scope>): <summary>" \
  --body-file pr-body.md

# 成功或失敗皆清理暫存
rm -f pr-body.md
```

- 預設使用 `--draft`，CI 通過後以 `gh pr ready <number>` 轉正式。
- 需要指定 base branch 時加 `--base "$BASE"`；預設為 repo 預設分支。

---

## 修改 PR（標題 / 描述）

> `gh pr edit --title` / `--body` 因 Projects (classic) 棄用而不可靠，改用 REST API。
>
> **中文內容務必用 `@filename` 讓 gh 自己讀檔**，不要用 `"$(cat file)"` 讓 shell 展開——在 Windows 非 UTF-8 終端機會造成網頁亂碼。

```bash
# 僅更新標題（短字串可直接傳；標題含中文且終端機非 UTF-8，改走檔案模式）
gh api -X PATCH "repos/:owner/:repo/pulls/<number>" \
  -f title='<新標題>'

# 標題檔案模式（防止 cp950 亂碼）
printf '%s' '<新標題>' > pr-title.txt
gh api -X PATCH "repos/:owner/:repo/pulls/<number>" -f title=@pr-title.txt
rm -f pr-title.txt

# 僅更新描述（先把內容寫到 pr-body.md，UTF-8 無 BOM）
gh api -X PATCH "repos/:owner/:repo/pulls/<number>" -f body=@pr-body.md
rm -f pr-body.md

# 一次更新標題與描述
gh api -X PATCH "repos/:owner/:repo/pulls/<number>" \
  -f title=@pr-title.txt \
  -f body=@pr-body.md
rm -f pr-body.md pr-title.txt
```

`:owner/:repo` 為 gh 的自動替換佔位符，無須手動填入。`-f key=@file` 語法讓 gh 直接以 UTF-8 位元組讀檔，繞過 shell 轉碼。

---

## 修改 PR（標籤 / 審核者 / 指派）

```bash
# 標籤
gh pr edit <number> --add-label "bug,release" --remove-label "wip"

# 審核者
gh pr edit <number> --add-reviewer "user1,user2"

# 指派
gh pr edit <number> --add-assignee "user1"
```

若上述指令回報 Projects 相關錯誤，改用 REST：

```bash
# 加標籤
gh api -X POST "repos/:owner/:repo/issues/<number>/labels" \
  -f "labels[]=bug" -f "labels[]=release"

# 加審核者
gh api -X POST "repos/:owner/:repo/pulls/<number>/requested_reviewers" \
  -f "reviewers[]=user1"
```

---

## 查詢 PR 狀態與內容

```bash
gh pr status                                          # 當前分支的 PR 狀態總覽
gh pr view                                            # 當前分支 PR 詳情
gh pr view <number> --json number,title,body,labels,assignees
gh pr checks <number>                                 # CI 檢查結果
gh pr diff <number>                                   # 檢視 diff
```

---

## 其他常用

```bash
gh pr ready <number>        # 從 draft 轉為正式
gh pr close <number>        # 關閉 PR
gh pr reopen <number>       # 重新開啟
gh pr merge <number>        # 合併（互動式）
```
