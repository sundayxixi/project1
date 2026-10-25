"""数据库引导脚本（SQLite，无需 Docker）

由 start.bat 调用，负责把本地数据库调整到可用状态。自动处理以下几种情况：

1. 数据库文件不存在     -> 建表 + 灌入演示数据 + 标记迁移版本为最新
2. 缺少迁移版本表       -> 直接标记为最新（通常由 init_data.py 建库导致）
3. 迁移版本落后         -> 执行 alembic upgrade head
4. 迁移失败（脏状态）   -> 备份旧库后重建

只依赖标准库，可在虚拟环境未激活时由 start.bat 用解释器直接调用。
"""
from __future__ import annotations

import sqlite3
import subprocess
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DB_FILE = ROOT / "chenguang.db"
PY = sys.executable


def log(msg: str) -> None:
    print(f"       {msg}", flush=True)


def run(*args: str, check: bool = True) -> subprocess.CompletedProcess:
    return subprocess.run([PY, *args], cwd=ROOT, check=check)


def table_exists(name: str) -> bool:
    if not DB_FILE.exists():
        return False
    conn = sqlite3.connect(DB_FILE)
    try:
        return (
            conn.execute(
                "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (name,)
            ).fetchone()
            is not None
        )
    finally:
        conn.close()


def has_rows() -> bool:
    """判断库里是否已有业务数据（users 表有记录即认为已初始化）"""
    if not table_exists("users"):
        return False
    conn = sqlite3.connect(DB_FILE)
    try:
        return (conn.execute("SELECT COUNT(*) FROM users").fetchone()[0] or 0) > 0
    finally:
        conn.close()


def build_fresh() -> None:
    """建立全新的库：ORM 建表 + 演示数据 + 标记迁移版本"""
    log("创建数据表并写入演示数据 ...")
    run("init_data.py")
    run("-m", "alembic", "stamp", "head")
    log("数据库初始化完成")


def rebuild_from_backup() -> None:
    """迁移失败时备份旧库并重建"""
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    backup = ROOT / f"chenguang.db.bak_{stamp}"
    try:
        DB_FILE.replace(backup)
        log(f"旧库已备份为 {backup.name}")
    except OSError as exc:
        log(f"备份失败（{exc}），直接删除旧库")
        DB_FILE.unlink(missing_ok=True)
    build_fresh()


def main() -> int:
    # 情况 1：全新环境
    if not DB_FILE.exists():
        log("未发现数据库文件，开始初始化 ...")
        build_fresh()
        return 0

    # 情况 2：有库但缺迁移版本表（init_data.py 的 create_all 不会写入该表）
    if not table_exists("alembic_version"):
        log("缺少迁移版本表，标记为最新 ...")
        if not has_rows():
            build_fresh()
        else:
            run("-m", "alembic", "stamp", "head")
        return 0

    # 情况 3：正常升级
    result = run("-m", "alembic", "upgrade", "head", check=False)
    if result.returncode == 0:
        log("数据库已是最新版本")
        return 0

    # 情况 4：升级失败，说明库结构与迁移记录不一致
    log("迁移执行失败，数据库处于不一致状态")
    rebuild_from_backup()
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except subprocess.CalledProcessError as exc:
        print(f"[错误] 命令执行失败: {exc}", file=sys.stderr)
        sys.exit(1)
    except Exception as exc:  # noqa: BLE001
        print(f"[错误] 数据库初始化失败: {exc}", file=sys.stderr)
        sys.exit(1)
