# /// script
# requires-python = ">=3.10"
# ///
"""分析 staged git 變更，輸出結構化 JSON 供 commit-message skill 使用。"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
from dataclasses import asdict, dataclass, field

# 確保所有輸出以 UTF-8 編碼，避免 Windows 預設 cp950 造成非 UTF-8 輸出
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")

LOCK_FILES: frozenset[str] = frozenset(
    {
        "package-lock.json",
        "yarn.lock",
        "pnpm-lock.yaml",
        "bun.lockb",
        "Cargo.lock",
        "go.sum",
        "poetry.lock",
        "Gemfile.lock",
        "composer.lock",
    }
)

MAIN_BRANCHES: frozenset[str] = frozenset({"main", "master"})

IGNORED_KEYWORDS: frozenset[str] = frozenset(
    {"index", "main", "app", "file1", "file2", "SKILL"}
)


@dataclass(frozen=True)
class StagedFiles:
    new: list[str] = field(default_factory=list)
    modified: list[str] = field(default_factory=list)
    deleted: list[str] = field(default_factory=list)
    renamed: list[str] = field(default_factory=list)


@dataclass(frozen=True)
class Report:
    branch: str
    is_main: bool
    score: int
    risk_factors: list[str]
    files_changed: int
    total_lines: int
    insertions: int
    deletions: int
    files: StagedFiles
    suggested_branches: list[str]


def run_git(args: list[str]) -> str:
    """執行 git 指令並回傳 stdout。git 不存在或非零 exit 時，往 stderr 輸出錯誤並 sys.exit(1)。"""
    try:
        result = subprocess.run(
            ["git", *args],
            capture_output=True,
            text=True,
            encoding="utf-8",
            check=False,
        )
    except FileNotFoundError:
        print("Error: git executable not found in PATH.", file=sys.stderr)
        sys.exit(1)

    if result.returncode != 0:
        stderr = result.stderr.strip() or f"git {' '.join(args)} returned {result.returncode}"
        print(f"Error: {stderr}", file=sys.stderr)
        sys.exit(1)

    return result.stdout.strip()


def parse_file_statuses() -> StagedFiles:
    """
    解析 `git status --porcelain=v1 -z` 以取得每個 staged 檔案的變更類型。

    -z 採用 NUL 分隔，檔名可安全包含空白與特殊字元。
    X = staging 狀態；Y = 工作目錄狀態。本函式只讀取 X 欄位。
    """
    raw = run_git(["status", "--porcelain=v1", "-z"])
    new_files: list[str] = []
    modified_files: list[str] = []
    deleted_files: list[str] = []
    renamed_files: list[str] = []

    # NUL-separated. For R/C entries, the next token is the old path.
    tokens = raw.split("\x00")
    i = 0
    while i < len(tokens):
        entry = tokens[i]
        if not entry or len(entry) < 3:
            i += 1
            continue

        x = entry[0]
        path = entry[3:]

        if x in ("R", "C"):
            # NUL-format: "XY new_path\x00old_path"
            old_path = tokens[i + 1] if i + 1 < len(tokens) else ""
            renamed_files.append(f"{old_path} -> {path}" if old_path else path)
            i += 2
            continue

        if x == "A":
            new_files.append(path)
        elif x == "M":
            modified_files.append(path)
        elif x == "D":
            deleted_files.append(path)
        elif x not in (" ", "?"):
            # T (type change), U (unmerged) 等合法 staged 狀態視為修改
            modified_files.append(path)

        i += 1

    return StagedFiles(
        new=new_files,
        modified=modified_files,
        deleted=deleted_files,
        renamed=renamed_files,
    )


def parse_diff_stat(stat_raw: str) -> tuple[int, int, int]:
    """解析 `git diff --staged --stat` 最後一行，回傳 (files_changed, insertions, deletions)。"""
    lines = stat_raw.splitlines()
    if not lines:
        return 0, 0, 0

    last = lines[-1]
    files = int(m.group(1)) if (m := re.search(r"(\d+) file", last)) else 0
    ins = int(m.group(1)) if (m := re.search(r"(\d+) insertion", last)) else 0
    dels = int(m.group(1)) if (m := re.search(r"(\d+) deletion", last)) else 0
    return files, ins, dels


def compute_score(
    files_changed: int,
    total_lines: int,
    files_list: list[str],
    all_staged: list[str],
) -> tuple[int, list[str]]:
    """依變更量與高風險關鍵字計算複雜度分數。"""
    score = 0
    risk_factors: list[str] = []

    if total_lines > 200:
        score += 3
        risk_factors.append(f"大量變更 ({total_lines} 行)")

    if files_changed > 5:
        score += 2
        risk_factors.append(f"變更檔案過多 ({files_changed} 個)")

    found_locks = [f for f in files_list if os.path.basename(f) in LOCK_FILES]
    if found_locks:
        score += 5
        risk_factors.append(f"包含 Lock 檔案: {', '.join(found_locks)}")

    if any(re.search(r"auth|security|permission|login", f, re.I) for f in all_staged):
        score += 3
        risk_factors.append("涉及認證或安全邏輯")

    if any(re.search(r"migration|schema|database|db", f, re.I) for f in all_staged):
        score += 3
        risk_factors.append("涉及資料庫變更")

    return score, risk_factors


def infer_primary_type(files: StagedFiles) -> str:
    """依檔案狀態推斷主要 commit type。"""
    if files.renamed and not files.new and not files.modified:
        return "refactor"
    if files.deleted and not files.new and not files.modified:
        return "chore"
    if files.new:
        return "feat"
    if any(re.search(r"fix|bug|patch", f, re.I) for f in files.modified):
        return "fix"
    if any(re.search(r"refactor", f, re.I) for f in files.modified):
        return "refactor"
    if any(re.search(r"build|ci|chore", f, re.I) for f in files.modified):
        return "build"
    return "fix"


def suggest_branches(
    primary_type: str, files_list: list[str], risk_factors: list[str]
) -> list[str]:
    """根據檔案關鍵字與風險因子建議分支名稱。"""
    keywords: list[str] = []
    for f in files_list:
        name = os.path.basename(f).split(".")[0]
        if name and name not in IGNORED_KEYWORDS:
            keywords.append(name)

    top_keyword = keywords[0] if keywords else "work"
    branches = [f"{primary_type}/{top_keyword}"]

    if any("認證或安全" in rf for rf in risk_factors):
        branches.append(f"{primary_type}/auth-logic")
    if any("資料庫" in rf for rf in risk_factors):
        branches.append(f"{primary_type}/db-migration")

    return branches


def analyze() -> Report:
    branch = run_git(["branch", "--show-current"])

    stat_raw = run_git(["diff", "--staged", "--stat"])
    if not stat_raw:
        print("Error: No staged changes found.", file=sys.stderr)
        sys.exit(1)

    files_changed, insertions, deletions = parse_diff_stat(stat_raw)
    total_lines = insertions + deletions

    files_list_raw = run_git(["diff", "--staged", "--name-only"])
    files_list = files_list_raw.splitlines() if files_list_raw else []

    files = parse_file_statuses()

    # 對於 rename，將 old/new 兩側路徑與完整 "old -> new" 字串都納入風險評估
    all_staged = (
        files.new
        + files.modified
        + files.deleted
        + files.renamed
        + [p for entry in files.renamed for p in entry.split(" -> ") if p]
    )

    score, risk_factors = compute_score(files_changed, total_lines, files_list, all_staged)
    primary_type = infer_primary_type(files)
    suggested = suggest_branches(primary_type, files_list, risk_factors)

    return Report(
        branch=branch,
        is_main=branch in MAIN_BRANCHES,
        score=score,
        risk_factors=risk_factors,
        files_changed=files_changed,
        total_lines=total_lines,
        insertions=insertions,
        deletions=deletions,
        files=files,
        suggested_branches=suggested,
    )


def main() -> None:
    report = analyze()
    print(json.dumps(asdict(report), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
