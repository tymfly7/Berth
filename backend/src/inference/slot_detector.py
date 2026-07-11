"""
Slot Detector — ROI-based Parking Detection
============================================
Detects parking availability for ROI-configured cameras.
Returns empty results when no ROIs are defined for the camera.
"""

import logging
import numpy as np
from src.inference.classifier import get_classifier
from src.roi.roi_crop import crop_roi
from src.roi.roi_store import RoiStore

logger = logging.getLogger("berth.slot_detector")


class SlotDetector:
    def __init__(self, model_name=None, camera_id: str = "default"):
        self.camera_id = camera_id
        self.classifier = get_classifier(model_name=model_name)
        self.classifier.load()

    def detect(self, frame, camera_id: str = "default") -> dict:
        rois = RoiStore.get_rois(camera_id)
        if not rois:
            return self._empty_result()
        return self._detect_from_rois(frame, rois)

    def _detect_from_rois(self, frame, rois: list[dict]) -> dict:
        fh, fw = frame.shape[:2]
        crops = []

        for roi in rois:
            polygon = roi["polygon"]
            # Axis-aligned bbox — the frontend overlay draws from this field.
            xs = [p[0] for p in polygon]
            ys = [p[1] for p in polygon]
            x1 = max(0, int(min(xs) * fw))
            y1 = max(0, int(min(ys) * fh))
            x2 = min(fw, int(max(xs) * fw))
            y2 = min(fh, int(max(ys) * fh))
            bw, bh = x2 - x1, y2 - y1
            # Perspective-warped deskewed crop — identical to training crops.
            crop = crop_roi(frame, polygon)
            if crop is None or crop.shape[1] <= 5 or crop.shape[0] <= 5:
                crop = None
            crops.append((roi, crop, x1, y1, bw, bh))

        valid_crops = [c for _, c, *_ in crops if c is not None]
        predictions = (
            self.classifier.predict_batch(valid_crops)
            if valid_crops and self.classifier.is_loaded()
            else []
        )

        results = []
        pred_idx = 0
        for roi, crop, x1, y1, bw, bh in crops:
            if crop is not None and pred_idx < len(predictions):
                pred = predictions[pred_idx]
                pred_idx += 1
            else:
                pred = {"status": "unknown", "confidence": 0.0, "probability": 0.5}
            results.append({
                "id": roi["id"],
                "status": pred["status"],
                "confidence": pred["confidence"],
                "bbox": [x1, y1, bw, bh],
            })

        return self._aggregate(results)

    def _aggregate(self, results: list[dict]) -> dict:
        available = sum(1 for r in results if r["status"] == "vacant")
        occupied  = sum(1 for r in results if r["status"] == "occupied")
        total     = len(results)
        avg_conf  = np.mean([r["confidence"] for r in results]) if results else 0.0
        return {
            "slots": results,
            "total": total,
            "available": available,
            "occupied": occupied,
            "occupancy_percent": round(100.0 * occupied / total, 1) if total > 0 else 0.0,
            "avg_confidence": round(float(avg_conf), 4),
        }

    def _empty_result(self):
        return {
            "slots": [],
            "total": 0,
            "available": 0,
            "occupied": 0,
            "occupancy_percent": 0.0,
            "avg_confidence": 0.0,
        }
