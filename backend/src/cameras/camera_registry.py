"""
Camera Registry — multi-camera persistence and lifecycle management.
"""

import json
import logging
import os
import threading
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse, urlunparse

import config
from src.inference.video_processor import VideoProcessor

logger = logging.getLogger("smartpark.cameras")

CAMERAS_FILE = Path(__file__).resolve().parent.parent.parent / "cameras.json"


def _redact_url_credentials(url: str) -> str:
    """Strip username/password from a URL before persisting to disk."""
    try:
        p = urlparse(url)
        if p.username or p.password:
            netloc = p.hostname + (f":{p.port}" if p.port else "")
            return urlunparse(p._replace(netloc=netloc))
    except Exception:
        pass
    return url


def _env_source_key(cam_id: str) -> str:
    """Env-var name that overrides the stored source URL for a camera.
    Example: camera id 'lot-a-1f3c2d' → SMARTPARK_CAM_SOURCE_LOT_A_1F3C2D
    Set this var to an rtsp:// URL that includes credentials so they never
    touch cameras.json.
    """
    return "SMARTPARK_CAM_SOURCE_" + cam_id.upper().replace("-", "_")


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
        # Env-var override lets operators store RTSP credentials outside cameras.json.
        env_src = os.getenv(_env_source_key(cam["id"]), "")
        src = env_src if env_src else cam["source"]
        if cam["type"] == "usb":
            try:
                return int(src)
            except (ValueError, TypeError):
                return 0
        # youtube: return the raw watch URL — resolution happens in VideoProcessor.
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
            # Strip credentials before persisting — store them in the env var instead.
            stored_source = _redact_url_credentials(source) if type_ in ("rtsp", "youtube") else source
            if stored_source != source:
                logger.warning(
                    f"Credentials stripped from source URL for camera '{id}'. "
                    f"Set {_env_source_key(id)} in your environment to supply them at runtime."
                )
            cam = {
                "id": id,
                "name": name,
                "source": stored_source,
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
                proc.set_video_source(self._resolve_source(cam), source_type=cam["type"])
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

    def shutdown(self):
        """Stop all processors on server exit without touching cameras.json active flags."""
        with self._lock:
            for id in list(self._processors.keys()):
                proc = self._processors.pop(id, None)
                if proc:
                    try:
                        proc.stop_processing()
                    except Exception:
                        pass

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
