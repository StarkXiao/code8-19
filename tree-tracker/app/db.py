"""SQLite 数据层：连接与建表。"""
import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).resolve().parent.parent / "data" / "trees.db"

SCHEMA = """
CREATE TABLE IF NOT EXISTS trees (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    code        TEXT NOT NULL UNIQUE,           -- 档案编号
    name        TEXT NOT NULL,                  -- 树种中文名
    latin_name  TEXT NOT NULL DEFAULT '',       -- 拉丁学名
    age         INTEGER,                        -- 树龄（年）
    level       TEXT NOT NULL DEFAULT '三级古树', -- 保护级别
    location    TEXT NOT NULL DEFAULT '',       -- 生长地点
    lng         REAL,                           -- 经度
    lat         REAL,                           -- 纬度
    owner       TEXT NOT NULL DEFAULT '',       -- 权属/管护单位
    status      TEXT NOT NULL DEFAULT '存活',   -- 存活 / 死亡 / 迁移
    remark      TEXT NOT NULL DEFAULT '',
    created_at  TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

-- 体检记录：一株古树可有多条
CREATE TABLE IF NOT EXISTS checkups (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    tree_id     INTEGER NOT NULL REFERENCES trees(id) ON DELETE CASCADE,
    check_date  TEXT NOT NULL,                  -- 体检日期 YYYY-MM-DD
    conclusion  TEXT NOT NULL,                  -- 健康 / 基本健康 / 衰弱 / 濒危
    trunk       TEXT NOT NULL DEFAULT '',       -- 树干状况
    crown       TEXT NOT NULL DEFAULT '',       -- 树冠状况
    root        TEXT NOT NULL DEFAULT '',       -- 根系状况
    pest        TEXT NOT NULL DEFAULT '',       -- 病虫害情况
    suggestion  TEXT NOT NULL DEFAULT '',       -- 处理建议
    examiner    TEXT NOT NULL DEFAULT '',       -- 体检单位/人员
    created_at  TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

-- 复壮措施：完成日期（end_date）起算两年跟踪期
CREATE TABLE IF NOT EXISTS treatments (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    tree_id      INTEGER NOT NULL REFERENCES trees(id) ON DELETE CASCADE,
    measure_type TEXT NOT NULL,                 -- 措施类型
    content      TEXT NOT NULL,                 -- 措施内容
    start_date   TEXT NOT NULL DEFAULT '',      -- 开始日期
    end_date     TEXT NOT NULL DEFAULT '',      -- 完成日期
    executor     TEXT NOT NULL DEFAULT '',      -- 实施单位
    created_at   TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

-- 跟踪记录：复壮完成后两年内的存活情况
CREATE TABLE IF NOT EXISTS followups (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    tree_id     INTEGER NOT NULL REFERENCES trees(id) ON DELETE CASCADE,
    track_date  TEXT NOT NULL,                  -- 跟踪日期
    survival    TEXT NOT NULL,                  -- 存活 / 衰弱 / 死亡
    growth_desc TEXT NOT NULL DEFAULT '',       -- 生长情况
    recorder    TEXT NOT NULL DEFAULT '',       -- 记录人
    created_at  TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE INDEX IF NOT EXISTS idx_checkups_tree   ON checkups(tree_id);
CREATE INDEX IF NOT EXISTS idx_treatments_tree ON treatments(tree_id);
CREATE INDEX IF NOT EXISTS idx_followups_tree  ON followups(tree_id);
"""


def connect():
    """每次请求新建连接（线程安全），调用方负责关闭。"""
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db():
    with connect() as conn:
        conn.executescript(SCHEMA)
