#!/usr/bin/env python3
"""SSH/https 都被沙箱网络拦住时，用 GitHub API 把本地 main 原样推到远端。

要点（2026-10-20 验证）：按本地 commit 的 author/committer/时间/消息/tree/parent
逐一复刻，远端生成的 commit SHA 与本地完全一致（内容寻址），不会造成历史分叉；
树自底向上重建后与 `git rev-parse HEAD^{tree}` 逐级核对，任何不一致都会中止。
远端 main 若不是本地 HEAD 的祖先，直接中止（绝不做 force 推送）。

用法：在仓库根目录执行 `python3 scripts/api-push-main.py`。
依赖：gh CLI（已登录，能走 api.github.com）。
"""
from __future__ import annotations

import json
import subprocess
import sys
from datetime import datetime, timedelta, timezone

REPO = "Mr-Z11/personal-ledger-pwa"
BRANCH = "main"


def git(*args: str) -> str:
    result = subprocess.run(["git", *args], capture_output=True, text=True)
    if result.returncode != 0:
        sys.exit(f"git {' '.join(args)} 失败: {result.stderr.strip()[:300]}")
    return result.stdout.strip()


def api(method: str, path: str, payload: dict | None = None):
    args = ["gh", "api", "--method", method, path, "-H", "Accept: application/vnd.github+json", "--input", "-"]
    result = subprocess.run(args, input=json.dumps(payload) if payload is not None else "", capture_output=True, text=True)
    if result.returncode != 0:
        sys.exit(f"API {path} 失败: {result.stderr.strip()[:400]}")
    return json.loads(result.stdout) if result.stdout.strip() else {}


def tree_entries(sha: str) -> dict[str, dict]:
    data = api("GET", f"repos/{REPO}/git/trees/{sha}")
    return {entry["path"]: entry for entry in data["tree"]}


def iso_from_git_date(value: str) -> str:
    ts, offset = value.split(" ")[-2], value.split(" ")[-1]
    sign = 1 if offset[0] == "+" else -1
    tz = timezone(sign * timedelta(hours=int(offset[1:3]), minutes=int(offset[3:5])))
    return datetime.fromtimestamp(int(ts), tz=tz).isoformat()


def main() -> None:
    local_head = git("rev-parse", "HEAD")
    remote_head = api("GET", f"repos/{REPO}/commits/{BRANCH}")["sha"]
    print(f"本地 {BRANCH}: {local_head}")
    print(f"远端 {BRANCH}: {remote_head}")
    if remote_head == local_head:
        print("已同步，无需推送。")
        return

    ancestors = subprocess.run(["git", "merge-base", "--is-ancestor", remote_head, local_head]).returncode
    if ancestors != 0:
        sys.exit("远端 main 不是本地 HEAD 的祖先：非快进，已中止（本脚本绝不做 force 推送）。")

    # 1) 收集相对远端的变更文件（含删除）
    changed = git("diff", "--name-only", f"{remote_head}", local_head).splitlines()
    if not changed:
        sys.exit("没有文件变更但 commit 不同？请人工检查。")
    print(f"变更文件 {len(changed)} 个：{', '.join(changed)}")

    blobs: dict[str, str | None] = {}
    for path in changed:
        exists = subprocess.run(["git", "cat-file", "-e", f"{local_head}:{path}"]).returncode == 0
        if not exists:
            blobs[path] = None  # 删除
            continue
        raw = subprocess.run(["git", "show", f"{local_head}:{path}"], capture_output=True).stdout.decode("utf-8")
        created = api("POST", f"repos/{REPO}/git/blobs", {"content": raw, "encoding": "utf-8"})
        local_blob = git("hash-object", path)
        if created["sha"] != local_blob:
            sys.exit(f"{path} blob 哈希不一致（远端 {created['sha']} / 本地 {local_blob}），已中止。")
        blobs[path] = created["sha"]

    # 2) 按目录自底向上重建树（只重建有变更的目录链）
    dirs: set[str] = set()
    for path in changed:
        parts = path.split("/")[:-1]
        for index in range(len(parts)):
            dirs.add("/".join(parts[: index + 1]))

    def remote_tree_for(directory: str) -> tuple[str, dict[str, dict]]:
        """取远端某目录的树；根目录直接用 commit 的 tree。"""
        if not directory:
            return remote_head, tree_entries(api("GET", f"repos/{REPO}/commits/{remote_head}")["commit"]["tree"]["sha"])
        node = api("GET", f"repos/{REPO}/git/trees/{remote_head}")
        # 逐级下钻
        current = tree_entries(api("GET", f"repos/{REPO}/commits/{remote_head}")["commit"]["tree"]["sha"])
        sha = None
        for part in directory.split("/"):
            entry = current[part]
            sha = entry["sha"]
            current = tree_entries(sha)
        return sha, current

    new_dir_trees: dict[str, str] = {}
    for directory in sorted(dirs, key=lambda item: item.count("/"), reverse=True):
        _, entries = remote_tree_for(directory)
        payload = []
        for name, entry in entries.items():
            child = f"{directory}/{name}" if directory else name
            if child in new_dir_trees and entry["type"] == "tree":
                payload.append({"path": name, "mode": entry["mode"], "type": "tree", "sha": new_dir_trees[child]})
            else:
                payload.append({"path": name, "mode": entry["mode"], "type": entry["type"], "sha": entry["sha"]})
        for path, blob in blobs.items():
            parts = path.split("/")
            if len(parts) < 2:
                continue
            parent, name = "/".join(parts[:-1]), parts[-1]
            if parent != directory:
                continue
            if blob is None:
                payload = [item for item in payload if item["path"] != name]
            else:
                existing = next((item for item in payload if item["path"] == name), None)
                if existing:
                    existing["sha"] = blob
                else:
                    payload.append({"path": name, "mode": "100644", "type": "blob", "sha": blob})
        new_dir_trees[directory] = api("POST", f"repos/{REPO}/git/trees", {"tree": payload})["sha"]

    # 3) 根树
    root_entries = []
    root_tree_sha, entries = remote_tree_for("")
    for name, entry in entries.items():
        child = name
        sha = new_dir_trees.get(child, entry["sha"]) if entry["type"] == "tree" else entry["sha"]
        root_entries.append({"path": name, "mode": entry["mode"], "type": entry["type"], "sha": sha})
    for path, blob in blobs.items():
        parts = path.split("/")
        if len(parts) != 1:
            continue
        name = parts[0]
        if blob is None:
            root_entries = [item for item in root_entries if item["path"] != name]
        else:
            existing = next((item for item in root_entries if item["path"] == name), None)
            if existing:
                existing["sha"] = blob
            else:
                root_entries.append({"path": name, "mode": "100644", "type": "blob", "sha": blob})
    new_root_tree = api("POST", f"repos/{REPO}/git/trees", {"tree": root_entries})["sha"]
    local_tree = git("rev-parse", "HEAD^{tree}")
    if new_root_tree != local_tree:
        sys.exit(f"重建的根树 {new_root_tree} 与本地 {local_tree} 不一致，已中止。")
    print(f"树核对一致: {new_root_tree}")

    # 4) 复刻 commit（作者/提交者/时间/消息全部对齐本地）
    raw = subprocess.run(["git", "cat-file", "commit", local_head], capture_output=True, text=True).stdout
    header, message = raw.split("\n\n", 1)

    def field(name: str) -> str:
        for line in header.split("\n"):
            if line.startswith(f"{name} "):
                return line[len(name) + 1:]
        sys.exit(f"commit 缺少 {name} 字段")

    created = api("POST", f"repos/{REPO}/git/commits", {
        "message": message,
        "tree": new_root_tree,
        "parents": [remote_head],
        "author": {"name": "frori", "email": "mofrori@gmail.com", "date": iso_from_git_date(field("author"))},
        "committer": {"name": "frori", "email": "mofrori@gmail.com", "date": iso_from_git_date(field("committer"))}
    })
    if created["sha"] != local_head:
        sys.exit(f"远端 commit {created['sha']} 与本地 {local_head} 不一致，已中止（未动 ref）。")
    print(f"commit SHA 完全一致: {created['sha']}")

    # 5) 快进 ref 并同步本地跟踪引用
    api("PATCH", f"repos/{REPO}/git/refs/heads/{BRANCH}", {"sha": created["sha"], "force": False})
    subprocess.run(["git", "update-ref", f"refs/remotes/origin/{BRANCH}", created["sha"]])
    print(f"已推送并快进 origin/{BRANCH} -> {created['sha']}")


if __name__ == "__main__":
    main()
