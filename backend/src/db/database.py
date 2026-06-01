"""
SQLite persistence layer for occupancy history, alert events, and training runs.
"""

import sqlite3
import threading
import logging
from datetime import datetime, timezone, timedelta
from pathlib import Path
import config

logger = logging.getLogger("smartpark.db")

DB_PATH = config.BASE_DIR / "smartpark.db"

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
            occupancy_percent REAL    NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_occ_ts     ON occupancy_history(timestamp);
        CREATE INDEX IF NOT EXISTS idx_occ_cam_ts ON occupancy_history(camera_id, timestamp);

        CREATE TABLE IF NOT EXISTS alert_events (
            id                INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp         TEXT NOT NULL,
            camera_id         TEXT NOT NULL DEFAULT 'default',
            level             TEXT NOT NULL,
            occupancy_percent REAL NOT NULL,
            message           TEXT
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
    c.commit()
    logger.info(f"SQLite DB ready at {DB_PATH}")


# ── Occupancy ─────────────────────────────────────────────────────────────────

def record_occupancy(camera_id: str, available: int, occupied: int,
                     occupancy_percent: float) -> None:
    ts = datetime.now(timezone.utc).isoformat()
    _conn().execute(
        "INSERT INTO occupancy_history (timestamp, camera_id, available, occupied, occupancy_percent) "
        "VALUES (?, ?, ?, ?, ?)",
        (ts, camera_id, available, occupied, occupancy_percent),
    )
    _conn().commit()


def query_trends(range_: str, camera_id: str = None):
    """
    Returns aggregated occupancy data for the given range.
      range_: 'day' (hourly, last 24h) | 'week' | 'month' (daily, last 7/30 days)
    Each row: { timestamp, available, occupied, occupancy_percent }
    """
    now = datetime.now(timezone.utc)

    if range_ == "day":
        since = (now - timedelta(hours=24)).isoformat()
        # 5-minute buckets via Unix epoch arithmetic
        group_expr = "datetime(strftime('%s', timestamp) - (strftime('%s', timestamp) % 300), 'unixepoch')"
    elif range_ == "week":
        since = (now - timedelta(days=7)).isoformat()
        group_expr = "strftime('%Y-%m-%d %H:00:00', timestamp)"
    else:  # month
        since = (now - timedelta(days=30)).isoformat()
        group_expr = "strftime('%Y-%m-%d', timestamp)"

    cam_filter = "AND camera_id = ?" if camera_id else ""
    params = [since] + ([camera_id] if camera_id else [])

    rows = _conn().execute(
        f"""
        SELECT
            {group_expr} AS ts,
            ROUND(AVG(available), 1)         AS available,
            ROUND(AVG(occupied), 1)          AS occupied,
            ROUND(AVG(occupancy_percent), 1) AS occupancy_percent
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
            "occupied": r["occupied"],
            "occupancy_percent": r["occupancy_percent"],
        }
        for r in rows
    ]


# ── Alerts ────────────────────────────────────────────────────────────────────

_alert_cooldown: dict[str, datetime] = {}
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
    last = _alert_cooldown.get(key)
    if last and (now - last).total_seconds() < _COOLDOWN_MINUTES * 60:
        return

    _alert_cooldown[key] = now
    msg = f"Occupancy at {occupancy_percent:.1f}%"
    _conn().execute(
        "INSERT INTO alert_events (timestamp, camera_id, level, occupancy_percent, message) "
        "VALUES (?, ?, ?, ?, ?)",
        (now.isoformat(), camera_id, level, occupancy_percent, msg),
    )
    _conn().commit()


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
