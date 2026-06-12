"""
Active-operation tracking
=========================
In-memory registry of long-running operations (training, uploads, analysis)
surfaced by GET /api/status so the UI can show a busy indicator. Self-evicts
stale entries left behind by operations that crashed before finishing.
"""

import threading
import uuid
from datetime import datetime, timezone

_active_operations: dict = {}
_ops_lock = threading.Lock()
_STALE_SECONDS = 3600


def register_op(op_type: str, label: str) -> str:
    op_id = uuid.uuid4().hex[:8]
    now = datetime.now(timezone.utc)
    with _ops_lock:
        # Evict stale entries (crashed ops that never called finish_op).
        stale = [k for k, v in _active_operations.items()
                 if (now - datetime.fromisoformat(v["started_at"])).total_seconds() > _STALE_SECONDS]
        for k in stale:
            del _active_operations[k]
        _active_operations[op_id] = {
            "id": op_id, "type": op_type, "label": label,
            "progress": 0.0,
            "started_at": now.isoformat(),
        }
    return op_id


def update_op_progress(op_id: str, progress: float) -> None:
    with _ops_lock:
        if op_id in _active_operations:
            _active_operations[op_id]["progress"] = progress


def finish_op(op_id: str) -> None:
    with _ops_lock:
        _active_operations.pop(op_id, None)


def list_ops() -> list:
    with _ops_lock:
        return list(_active_operations.values())
