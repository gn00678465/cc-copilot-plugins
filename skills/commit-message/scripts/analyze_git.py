import subprocess
import os
import sys
import re

def run_command(cmd):
    try:
        result = subprocess.run(cmd, shell=True, capture_output=True, text=True, encoding='utf-8')
        return result.stdout.strip()
    except Exception:
        return ""

def parse_file_statuses():
    """
    解析 git status --porcelain 以取得每個 staged 檔案的變更類型。
    回傳四個清單：新增(A)、修改(M)、刪除(D)、重新命名/複製(R/C) 的檔案。

    Porcelain 格式：
      XY PATH          (一般變更)
      XY OLD -> NEW    (重新命名／複製)

    X = 暫存區（staging area）狀態，Y = 工作目錄狀態。
    本函式只讀取 X 欄位（staged 狀態）。
    """
    status_raw = run_command("git status --porcelain")
    new_files = []
    modified_files = []
    deleted_files = []
    renamed_files = []

    for line in status_raw.splitlines():
        if len(line) < 3:
            continue
        x = line[0]   # 暫存區狀態
        path = line[3:]  # 跳過 "XY " 三個字元

        if x == 'A':
            new_files.append(path)
        elif x == 'M':
            modified_files.append(path)
        elif x == 'D':
            deleted_files.append(path)
        elif x in ('R', 'C'):
            renamed_files.append(path)  # 格式為 "old -> new"
        elif x not in (' ', '?'):
            # 其他合法的 staged 狀態 (例如 T: type change, U: unmerged) 一律視為修改
            modified_files.append(path)

    return new_files, modified_files, deleted_files, renamed_files

def analyze():
    # 1. 檢查分支
    current_branch = run_command("git branch --show-current")
    is_main = current_branch in ["main", "master"]

    # 2. 取得統計數據
    stats_raw = run_command("git diff --staged --stat")
    if not stats_raw:
        print("Error: No staged changes found.")
        sys.exit(1)

    # 解析統計資料 (e.g. " 5 files changed, 20 insertions(+), 10 deletions(-)")
    files_changed = 0
    insertions = 0
    deletions = 0

    stats_lines = stats_raw.splitlines()
    if stats_lines:
        last_line = stats_lines[-1]
        files_match = re.search(r'(\d+) file', last_line)
        ins_match = re.search(r'(\d+) insertion', last_line)
        del_match = re.search(r'(\d+) deletion', last_line)

        if files_match: files_changed = int(files_match.group(1))
        if ins_match: insertions = int(ins_match.group(1))
        if del_match: deletions = int(del_match.group(1))

    total_lines = insertions + deletions

    # 3. 取得變更檔案清單與各別狀態
    files_list_raw = run_command("git diff --staged --name-only")
    files_list = files_list_raw.splitlines() if files_list_raw else []

    new_files, modified_files, deleted_files, renamed_files = parse_file_statuses()
    # 彙整所有 staged 檔案（用於風險評估）
    # 對於 rename，將 old/new 兩側路徑與完整 "old -> new" 字串都納入，以避免只看新路徑時漏判風險
    all_staged = (
        new_files
        + modified_files
        + deleted_files
        + renamed_files
        + [path for p in renamed_files for path in p.split(' -> ') if path]
    )

    # 4. 計算分數
    score = 0
    risk_factors = []

    if total_lines > 200:
        score += 3
        risk_factors.append(f"大量變更 ({total_lines} 行)")
    if files_changed > 5:
        score += 2
        risk_factors.append(f"變更檔案過多 ({files_changed} 個)")

    # 高風險檔案檢查
    lock_files = [
        "package-lock.json", "yarn.lock", "pnpm-lock.yaml", "bun.lockb",
        "Cargo.lock", "go.sum", "poetry.lock", "Gemfile.lock", "composer.lock"
    ]
    found_locks = [f for f in files_list if os.path.basename(f) in lock_files]
    if found_locks:
        score += 5
        risk_factors.append(f"包含 Lock 檔案: {', '.join(found_locks)}")

    # 安全與資料庫檢查
    has_auth = any(re.search(r'auth|security|permission|login', f, re.I) for f in all_staged)
    has_db = any(re.search(r'migration|schema|database|db', f, re.I) for f in all_staged)

    if has_auth:
        score += 3
        risk_factors.append("涉及認證或安全邏輯")
    if has_db:
        score += 3
        risk_factors.append("涉及資料庫變更")

    # 5. 建議分支名稱邏輯（使用檔案狀態優先推斷類型）
    suggested_branches = []

    # 優先使用檔案狀態推斷類型，再用檔名關鍵字補充
    if renamed_files and not new_files and not modified_files:
        primary_type = "refactor"
    elif deleted_files and not new_files and not modified_files:
        primary_type = "chore"
    elif new_files:
        primary_type = "feat"
    elif any(re.search(r'fix|bug|patch', f, re.I) for f in modified_files):
        primary_type = "fix"
    elif any(re.search(r'refactor', f, re.I) for f in modified_files):
        primary_type = "refactor"
    elif any(re.search(r'build|ci|chore', f, re.I) for f in modified_files):
        primary_type = "build"
    else:
        primary_type = "fix"  # 僅修改現有檔案，預設 fix（LLM 可依 diff 內容覆寫）

    # 根據檔案名稱提取關鍵詞
    keywords = []
    for f in files_list:
        name = os.path.basename(f).split('.')[0]
        if name and name not in ["index", "main", "app", "file1", "file2", "SKILL"]:
            keywords.append(name)

    top_keyword = keywords[0] if keywords else "work"
    suggested_branches.append(f"{primary_type}/{top_keyword}")
    if has_auth: suggested_branches.append(f"{primary_type}/auth-logic")
    if has_db: suggested_branches.append(f"{primary_type}/db-migration")

    # 輸出結果
    def fmt_list(lst):
        return ', '.join(lst) if lst else '(none)'

    print(f"Branch: {current_branch}")
    print(f"IsMain: {str(is_main).lower()}")
    print(f"Score: {score}")
    print(f"RiskFactors: {', '.join(risk_factors) if risk_factors else 'None'}")
    print(f"FilesChanged: {files_changed}")
    print(f"TotalLines: {total_lines}")
    print(f"NewFiles: {fmt_list(new_files)}")
    print(f"ModifiedFiles: {fmt_list(modified_files)}")
    print(f"DeletedFiles: {fmt_list(deleted_files)}")
    print(f"RenamedFiles: {fmt_list(renamed_files)}")
    print(f"SuggestedBranches: {', '.join(suggested_branches)}")
    print("-" * 20)
    print(stats_raw)

if __name__ == "__main__":
    analyze()
