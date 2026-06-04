"""
SQLite persistence layer for occupancy history, alert events, and training runs.
"""

import sqlite3
import threading
import logging
from datetime import datetime, timezone, timedelta
from pathlib import Path
import config

logger = logging.getLogger("berth.db")

DB_PATH = config.DB_PATH

_local = threading.local()


def _conn() -> sqlite3.Connection:
    if not hasattr(_local, "conn"):
        _local.conn = sqlite3.connect(str(DB_PATH), check_same_thread=False)
        _local.conn.row_factory = sqlite3.Row
        _local.conn.execute("PRAGMA journal_mode=WAL")
    return _local.conn


def init_db() -> None:
    c = _conn()
    c.executescript("""
        CREATE TABLE IF NOT EXISTS occupancy_history (
            id                INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp         TEXT    NOT NULL,
            camera_id         TEXT    NOT NULL DEFAULT 'default',
            available         INTEGER NOT NULL,
            occupied          INTEGER NOT NULL,
            occupancy_percent REAL    NOT NULL,
            synced            INTEGER NOT NULL DEFAULT 0,
            UNIQUE (camera_id, timestamp)
        );
        CREATE INDEX IF NOT EXISTS idx_occ_ts     ON occupancy_history(timestamp);
        CREATE INDEX IF NOT EXISTS idx_occ_cam_ts ON occupancy_history(camera_id, timestamp);

        CREATE TABLE IF NOT EXISTS alert_events (
            id                INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp         TEXT NOT NULL,
            camera_id         TEXT NOT NULL DEFAULT 'default',
            level             TEXT NOT NULL,
            occupancy_percent REAL NOT NULL,
            message           TEXT,
            synced            INTEGER NOT NULL DEFAULT 0,
            UNIQUE (camera_id, timestamp, level)
        );
        CREATE INDEX IF NOT EXISTS idx_alert_ts ON alert_events(timestamp);

        CREATE TABLE IF NOT EXISTS training_runs (
            id               INTEGER PRIMARY KEY AUTOINCREMENT,
            model_name       TEXT NOT NULL,
            started_at       TEXT NOT NULL,
            finished_at      TEXT,
            epochs           INTEGER,
            final_accuracy   REAL,
            dataset_size     INTEGER,
            status           TEXT NOT NULL DEFAULT 'running'
        );
    """)
    # Migrate existing DBs that predate the synced column.
    for table in ("occupancy_history", "alert_events"):
        cols = [r[1] for r in c.execute(f"PRAGMA table_info({table})").fetchall()]
        if "synced" not in cols:
            c.execute(f"ALTER TABLE {table} ADD COLUMN synced INTEGER NOT NULL DEFAULT 0")
    c.commit()
    logger.info(f"SQLite DB ready at {DB_PATH}")


# ── Occupancy ─────────────────────────────────────────────────────────────────

def record_occupancy(camera_id: str, available: int, occupied: int,
                     occupancy_percent: float) -> None:
    ts = datetime.now(timezone.utc).isoformat()
    c = _conn()
    c.execute(
        "INSERT INTO occupancy_history (timestamp, camera_id, available, occupied, occupancy_percent) "
        "VALUES (?, ?, ?, ?, ?)",
        (ts, camera_id, int(available), int(occupied), occupancy_percent),
    )
    c.commit()


_BUCKET_CONFIG = {
    "week":  (timedelta(days=7),  "strftime('%Y-%m-%d %H:00:00', timestamp)"),
    "month": (timedelta(days=30), "strftime('%Y-%m-%d', timestamp)"),
}


def query_trends(range_: str, camera_id: str = None):
    """
    Returns occupancy data for the given range.
      today/day: raw per-snapshot values (no time-bucketing), summed across cameras per timestamp
      week/month: hourly/daily averages rounded to integers
    Each row: { timestamp, available, occupied, occupancy_percent }
    """
    if range_ not in (*_BUCKET_CONFIG, "today", "day"):
        raise ValueError(f"Invalid range '{range_}': must be today, day, week, or month")

    cam_filter = "AND camera_id = ?" if camera_id else ""

    if range_ in ("today", "day"):
        if range_ == "today":
            now = datetime.now(timezone.utc)
            since = now.replace(hour=0, minute=0, second=0, microsecond=0).isoformat()
        else:
            since = (datetime.now(timezone.utc) - timedelta(hours=24)).isoformat()
        params = [since] + ([camera_id] if camera_id else [])
        rows = _conn().execute(
            f"""
            SELECT
                timestamp                                    AS ts,
                CAST(ROUND(SUM(available))  AS INTEGER)      AS available,
                CAST(ROUND(SUM(occupied))   AS INTEGER)      AS occupied,
                ROUND(AVG(occupancy_percent), 1)             AS occupancy_percent
            FROM occupancy_history
            WHERE timestamp >= ? {cam_filter}
            GROUP BY timestamp
            ORDER BY ts
            """,
            params,
        ).fetchall()
    else:
        delta, group_expr = _BUCKET_CONFIG[range_]
        since = (datetime.now(timezone.utc) - delta).isoformat()
        params = [since] + ([camera_id] if camera_id else [])
        rows = _conn().execute(
            f"""
            SELECT
                {group_expr}                              AS ts,
                CAST(ROUND(AVG(available))  AS INTEGER)  AS available,
                CAST(ROUND(AVG(occupied))   AS INTEGER)  AS occupied,
                ROUND(AVG(occupancy_percent), 1)         AS occupancy_percent
            FROM occupancy_history
            WHERE timestamp >= ? {cam_filter}
            GROUP BY {group_expr}
            ORDER BY ts
            """,
            params,
        ).fetchall()

    return [
        {
            "timestamp": r["ts"].replace(" ", "T"),
            "available": r["available"],
            "occupied":  r["occupied"],
            "occupancy_percent": r["occupancy_percent"],
        }
        for r in rows
    ]


# ── Alerts ────────────────────────────────────────────────────────────────────

_alert_cooldown: dict[str, datetime] = {}
_alert_cooldown_lock = threading.Lock()
_COOLDOWN_MINUTES = 10


def maybe_record_alert(camera_id: str, occupancy_percent: float) -> None:
    level = None
    if occupancy_percent >= config.ALERT_THRESHOLD_CRITICAL:
        level = "critical"
    elif occupancy_percent >= config.ALERT_THRESHOLD_WARNING:
        level = "warning"
    elif occupancy_percent >= config.ALERT_THRESHOLD_INFO:
        level = "info"

    if level is None:
        return

    key = f"{camera_id}:{level}"
    now = datetime.now(timezone.utc)
    with _alert_cooldown_lock:
        last = _alert_cooldown.get(key)
        if last and (now - last).total_seconds() < _COOLDOWN_MINUTES * 60:
            return
        _alert_cooldown[key] = now

    msg = f"Occupancy at {occupancy_percent:.1f}%"
    c = _conn()
    c.execute(
        "INSERT INTO alert_events (timestamp, camera_id, level, occupancy_percent, message) "
        "VALUES (?, ?, ?, ?, ?)",
        (now.isoformat(), camera_id, level, occupancy_percent, msg),
    )
    c.commit()


def get_alerts(limit: int = 50):
    rows = _conn().execute(
        "SELECT timestamp, camera_id, level, occupancy_percent, message "
        "FROM alert_events ORDER BY timestamp DESC LIMIT ?",
        (limit,),
    ).fetchall()
    return [dict(r) for r in rows]


# ── Training runs ─────────────────────────────────────────────────────────────

def start_training_run(model_name: str, dataset_size: int = 0) -> int:
    ts = datetime.now(timezone.utc).isoformat()
    cur = _conn().execute(
        "INSERT INTO training_runs (model_name, started_at, dataset_size, status) VALUES (?, ?, ?, 'running')",
        (model_name, ts, dataset_size),
    )
    _conn().commit()
    return cur.lastrowid


def finish_training_run(run_id: int, status: str, final_accuracy: float = None,
                        epochs: int = None) -> None:
    ts = datetime.now(timezone.utc).isoformat()
    _conn().execute(
        "UPDATE training_runs SET finished_at=?, status=?, final_accuracy=?, epochs=? WHERE id=?",
        (ts, status, final_accuracy, epochs, run_id),
    )
    _conn().commit()


def get_training_runs(limit: int = 20):
    rows = _conn().execute(
        "SELECT id, model_name, started_at, finished_at, epochs, final_accuracy, dataset_size, status "
        "FROM training_runs ORDER BY started_at DESC LIMIT ?",
        (limit,),
    ).fetchall()
    return [dict(r) for r in rows]


# ── Edge sync helpers ──────────────────────────────────────────────────────────

def get_unsynced_occupancy(limit: int = 200) -> list:
    rows = _conn().execute(
        "SELECT id, timestamp, camera_id, available, occupied, occupancy_percent "
        "FROM occupancy_history WHERE synced=0 ORDER BY id LIMIT ?",
        (limit,),
    ).fetchall()
    return [dict(r) for r in rows]


def mark_synced_occupancy(ids: list[int]) -> None:
    if not ids:
        return
    placeholders = ",".join("?" * len(ids))
    _conn().execute(
        f"UPDATE occupancy_history SET synced=1 WHERE id IN ({placeholders})", ids
    )
    _conn().commit()


def get_unsynced_alerts(limit: int = 200) -> list:
    rows = _conn().execute(
        "SELECT id, timestamp, camera_id, level, occupancy_percent, message "
        "FROM alert_events WHERE synced=0 ORDER BY id LIMIT ?",
        (limit,),
    ).fetchall()
    return [dict(r) for r in rows]


def mark_synced_alerts(ids: list[int]) -> None:
    if not ids:
        return
    placeholders = ",".join("?" * len(ids))
    _conn().execute(
        f"UPDATE alert_events SET synced=1 WHERE id IN ({placeholders})", ids
    )
    _conn().commit()


def upsert_occupancy_batch(rows: list[dict]) -> int:
    """Insert occupancy rows from an edge node; skip duplicates on (camera_id, timestamp)."""
    inserted = 0
    c = _conn()
    for r in rows:
        cur = c.execute(
            "INSERT OR IGNORE INTO occupancy_history "
            "(timestamp, camera_id, available, occupied, occupancy_percent, synced) "
            "VALUES (?, ?, ?, ?, ?, 1)",
            (r["timestamp"], r["camera_id"], r["available"],
             r["occupied"], r["occupancy_percent"]),
        )
        inserted += cur.rowcount
    c.commit()
    return inserted


def upsert_alerts_batch(rows: list[dict]) -> int:
    """Insert alert rows from an edge node; skip duplicates on (camera_id, timestamp, level)."""
    inserted = 0
    c = _conn()
    for r in rows:
        cur = c.execute(
            "INSERT OR IGNORE INTO alert_events "
            "(timestamp, camera_id, level, occupancy_percent, message, synced) "
            "VALUES (?, ?, ?, ?, ?, 1)",
            (r["timestamp"], r["camera_id"], r["level"],
             r["occupancy_percent"], r.get("message", "")),
        )
        inserted += cur.rowcount
    c.commit()
    return inserted
