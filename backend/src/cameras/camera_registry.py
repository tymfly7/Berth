"""
Camera Registry — multi-camera persistence and lifecycle management.
"""

import json
import logging
import threading
from datetime import datetime, timezone
from pathlib import Path

import config
from src.inference.video_processor import VideoProcessor

logger = logging.getLogger("smartpark.cameras")

CAMERAS_FILE = Path(__file__).resolve().parent.parent.parent / "cameras.json"


class CameraRegistry:
    def __init__(self):
        self._lock = threading.RLock()
        self._cameras: dict = {}          # id -> camera dict
        self._processors: dict = {}       # id -> VideoProcessor
        self._load()
        self._restore_active()

    # ── Persistence ────────────────────────────────────────────────────────

    def _load(self):
        if CAMERAS_FILE.exists():
            try:
                with open(CAMERAS_FILE) as f:
                    data = json.load(f)
                for cam in data:
                    self._cameras[cam["id"]] = cam
            except Exception as e:
                logger.warning(f"Could not load cameras.json: {e}")

    def _save(self):
        try:
            with open(CAMERAS_FILE, "w") as f:
                json.dump(list(self._cameras.values()), f, indent=2)
        except Exception as e:
            logger.error(f"Could not save cameras.json: {e}")

    # ── Internal helpers ───────────────────────────────────────────────────

    def _resolve_source(self, cam: dict):
        src = cam["source"]
        if cam["type"] == "usb":
            try:
                return int(src)
            except (ValueError, TypeError):
                return 0
        return src

    def _restore_active(self):
        for cam in list(self._cameras.values()):
            if cam.get("active"):
                try:
                    self.activate(cam["id"])
                except Exception as e:
                    logger.warning(f"Could not restore camera '{cam['id']}': {e}")

    def _deactivate(self, id: str):
        proc = self._processors.pop(id, None)
        if proc:
            try:
                proc.stop_processing()
            except Exception:
                pass
        if id in self._cameras:
            self._cameras[id]["active"] = False

    # ── Public API ─────────────────────────────────────────────────────────

    def add_camera(self, id: str, name: str, source: str, type_: str,
                   roi_camera_id: str = None) -> dict:
        with self._lock:
            if id in self._cameras:
                raise ValueError(f"Camera id '{id}' already exists")
            cam = {
                "id": id,
                "name": name,
                "source": source,
                "type": type_,
                "roi_camera_id": roi_camera_id or id,
                "active": False,
                "added_at": datetime.now(timezone.utc).isoformat(),
            }
            self._cameras[id] = cam
            self._save()
            return dict(cam)

    def remove_camera(self, id: str) -> bool:
        with self._lock:
            if id not in self._cameras:
                return False
            self._deactivate(id)
            del self._cameras[id]
            self._save()
            return True

    def activate(self, id: str, model_name: str = None) -> bool:
        with self._lock:
            cam = self._cameras.get(id)
            if not cam:
                return False
            self._deactivate(id)
            try:
                mn = model_name or config.ACTIVE_MODEL
                roi_id = cam.get("roi_camera_id") or id
                proc = VideoProcessor(model_name=mn, camera_id=roi_id)
                proc.set_video_source(self._resolve_source(cam))
                proc.start_processing()
                self._processors[id] = proc
                self._cameras[id]["active"] = True
                self._save()
                logger.info(f"Camera '{id}' activated ({cam['type']}:{cam['source']})")
                return True
            except Exception as e:
                logger.error(f"Failed to activate camera '{id}': {e}")
                return False

    def deactivate(self, id: str) -> bool:
        with self._lock:
            if id not in self._cameras:
                return False
            self._deactivate(id)
            self._save()
            logger.info(f"Camera '{id}' deactivated")
            return True

    def get_all(self) -> list:
        with self._lock:
            return [dict(c) for c in self._cameras.values()]

    def get(self, id: str) -> dict | None:
        with self._lock:
            cam = self._cameras.get(id)
            return dict(cam) if cam else None

    def get_processor(self, id: str) -> VideoProcessor | None:
        with self._lock:
            return self._processors.get(id)


camera_registry = CameraRegistry()
