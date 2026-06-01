"""
Edge → Hub Sync Worker
========================
Background thread that pushes buffered occupancy and alert rows from the
edge node's local SQLite DB to the hub server every SYNC_INTERVAL_SECONDS.

Only starts when SMARTPARK_EDGE_HUB_URL is set. Completely inert on the hub.

Offline resilience: if the hub is unreachable, rows stay in the local DB
(synced=0) and are retried on the next tick — no data is lost.
"""

import logging
import threading
import time
import urllib.request
import urllib.error
import json

import config
from src.db import database as db

logger = logging.getLogger("smartpark.sync")

SYNC_INTERVAL_SECONDS = 60
_BATCH_SIZE = 200


class SyncWorker:
    """Push unsynced DB rows to the hub on a fixed interval."""

    def __init__(self):
        self._thread: threading.Thread | None = None

    def start(self) -> None:
        if not config.EDGE_HUB_URL:
            logger.info("SMARTPARK_EDGE_HUB_URL not set — sync worker inactive")
            return
        self._thread = threading.Thread(target=self._loop, daemon=True, name="sync-worker")
        self._thread.start()
        logger.info(f"Sync worker started — hub: {config.EDGE_HUB_URL}")

    def _loop(self) -> None:
        while True:
            time.sleep(SYNC_INTERVAL_SECONDS)
            try:
                self._push_occupancy()
                self._push_alerts()
            except Exception as exc:
                logger.warning(f"Sync tick failed: {exc}")

    def _push_occupancy(self) -> None:
        rows = db.get_unsynced_occupancy(limit=_BATCH_SIZE)
        if not rows:
            return
        ids = [r["id"] for r in rows]
        payload = [
            {k: v for k, v in r.items() if k != "id"}
            for r in rows
        ]
        self._post("/api/ingest/occupancy", payload)
        db.mark_synced_occupancy(ids)
        logger.info(f"Synced {len(rows)} occupancy rows to hub")

    def _push_alerts(self) -> None:
        rows = db.get_unsynced_alerts(limit=_BATCH_SIZE)
        if not rows:
            return
        ids = [r["id"] for r in rows]
        payload = [
            {k: v for k, v in r.items() if k != "id"}
            for r in rows
        ]
        self._post("/api/ingest/alerts", payload)
        db.mark_synced_alerts(ids)
        logger.info(f"Synced {len(rows)} alert rows to hub")

    def _post(self, path: str, payload: list) -> None:
        url = config.EDGE_HUB_URL.rstrip("/") + path
        body = json.dumps(payload).encode()
        req = urllib.request.Request(
            url,
            data=body,
            method="POST",
            headers={
                "Content-Type": "application/json",
                "X-API-Key": config.API_KEY or "",
            },
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            if resp.status not in (200, 201):
                raise RuntimeError(f"Hub returned HTTP {resp.status}")
