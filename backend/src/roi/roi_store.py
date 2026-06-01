import json
import logging
import re
from pathlib import Path
from typing import Optional

import cv2
import numpy as np

logger = logging.getLogger("smartpark.roi")

_ROI_DIR = Path(__file__).resolve().parent.parent.parent.parent / "roi_configs"

# Only allow safe characters in camera IDs to prevent path traversal.
_SAFE_CAM_ID = re.compile(r'^[a-zA-Z0-9_\-]{1,64}$')


def _validate_camera_id(camera_id: str) -> None:
    if not _SAFE_CAM_ID.match(camera_id):
        raise ValueError(f"Invalid camera_id '{camera_id}': only letters, digits, hyphens, and underscores are allowed")


class RoiStore:
    @classmethod
    def _ensure_dir(cls) -> Path:
        _ROI_DIR.mkdir(parents=True, exist_ok=True)
        return _ROI_DIR

    @classmethod
    def _roi_path(cls, camera_id: str) -> Path:
        _validate_camera_id(camera_id)
        return cls._ensure_dir() / f"{camera_id}.json"

    @classmethod
    def _snapshot_path(cls, camera_id: str) -> Path:
        _validate_camera_id(camera_id)
        return cls._ensure_dir() / f"{camera_id}_snapshot.jpg"

    @classmethod
    def get_rois(cls, camera_id: str) -> list[dict]:
        path = cls._roi_path(camera_id)
        if not path.exists():
            return []
        with open(path) as f:
            return json.load(f)

    @classmethod
    def save_rois(cls, camera_id: str, rois: list[dict]) -> None:
        for roi in rois:
            for pt in roi.get("polygon", []):
                x, y = pt[0], pt[1]
                if not (0.0 <= x <= 1.0 and 0.0 <= y <= 1.0):
                    raise ValueError(f"Coordinate ({x}, {y}) is outside 0.0–1.0")
        with open(cls._roi_path(camera_id), "w") as f:
            json.dump(rois, f)
        logger.info(f"Saved {len(rois)} ROIs for camera '{camera_id}'")

    @classmethod
    def delete_roi(cls, camera_id: str, roi_id: str) -> bool:
        rois = cls.get_rois(camera_id)
        new_rois = [r for r in rois if r.get("id") != roi_id]
        if len(new_rois) == len(rois):
            return False
        with open(cls._roi_path(camera_id), "w") as f:
            json.dump(new_rois, f)
        logger.info(f"Deleted ROI '{roi_id}' from camera '{camera_id}'")
        return True

    @classmethod
    def save_snapshot(cls, camera_id: str, image_bytes: bytes) -> dict:
        cls._ensure_dir()
        nparr = np.frombuffer(image_bytes, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if img is None:
            raise ValueError("Could not decode image")
        path = cls._snapshot_path(camera_id)
        cv2.imwrite(str(path), img)
        h, w = img.shape[:2]
        logger.info(f"Saved snapshot for camera '{camera_id}': {w}x{h}")
        return {"path": str(path), "width": w, "height": h}

    @classmethod
    def get_snapshot_path(cls, camera_id: str) -> Optional[Path]:
        path = cls._snapshot_path(camera_id)
        return path if path.exists() else None
