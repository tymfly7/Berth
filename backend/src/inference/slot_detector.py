"""
Slot Detector — Multi-Slot Detection from Full Parking Lot Image
=================================================================
Detects parking availability across multiple predefined slots in a
full parking lot image.

For each slot:
    1. Crop the region from the full image
    2. Run the classifier
    3. Label as vacant/occupied with confidence
    4. Draw bounding box overlay (green=vacant, red=occupied)
"""

import sys
import json
import logging
from pathlib import Path
import cv2
import numpy as np
import config
from src.inference.classifier import get_classifier
from src.roi.roi_store import RoiStore

logger = logging.getLogger("berth.slot_detector")
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))


class SlotDetector:
    """
    Detects occupied/vacant status for predefined parking slots.

    Loads slot coordinates from spots_config.json and uses the
    ParkingClassifier to classify each cropped region.
    Falls back to ROI-based detection when ROIs are configured.

    Args:
        model_name (str): Model to use for classification
        spots_config_path (str): Path to JSON with slot coordinates
        camera_id (str): Camera identifier for ROI lookup
    """

    def __init__(self, model_name=None, spots_config_path=None, camera_id: str = "default"):
        self.camera_id = camera_id
        self.spots_config_path = Path(spots_config_path or config.SPOTS_CONFIG_PATH)
        self.classifier = get_classifier(model_name=model_name)
        self.slots = []

        self._load_slots()
        self.classifier.load()

    def _load_slots(self):
        """Load parking slot coordinates from JSON config."""
        if self.spots_config_path.exists():
            with open(self.spots_config_path) as f:
                data = json.load(f)
                self.slots = data.get("slots", [])
            logger.info(f"📍 Loaded {len(self.slots)} parking slots from config")
        else:
            logger.warning(f"⚠️  No spots config found at {self.spots_config_path}")
            self.slots = []

    def detect(self, frame, camera_id: str = "default") -> dict:
        """
        Analyze a full parking lot image and detect slot status.

        Uses ROIs from RoiStore when configured; falls back to
        spots_config.json otherwise.

        Args:
            frame (ndarray): Full parking lot image (BGR, from OpenCV)
            camera_id (str): Camera ID for ROI lookup

        Returns:
            dict: {
                "slots": [...],
                "total": int,
                "available": int,
                "occupied": int,
                "occupancy_percent": float,
                "avg_confidence": float,
            }
        """
        rois = RoiStore.get_rois(camera_id)
        if rois:
            return self._detect_from_rois(frame, rois)
        return self._detect_from_slots(frame)

    def _detect_from_slots(self, frame) -> dict:
        """Detect using hardcoded slot coordinates from spots_config.json."""
        if not self.slots:
            return self._empty_result()

        crops = []
        fh, fw = frame.shape[:2]

        for slot in self.slots:
            x = max(0, min(slot["x"], fw - 1))
            y = max(0, min(slot["y"], fh - 1))
            w = min(slot["width"], fw - x)
            h = min(slot["height"], fh - y)
            crops.append(frame[y:y + h, x:x + w] if w > 5 and h > 5 else None)

        valid_crops = [c for c in crops if c is not None]
        predictions = (
            self.classifier.predict_batch(valid_crops)
            if valid_crops and self.classifier.is_loaded()
            else []
        )

        results = []
        pred_idx = 0
        for i, slot in enumerate(self.slots):
            if crops[i] is not None and pred_idx < len(predictions):
                pred = predictions[pred_idx]
                pred_idx += 1
            else:
                pred = {"status": "unknown", "confidence": 0.0, "probability": 0.5}
            results.append({
                "id": slot.get("id", i + 1),
                "status": pred["status"],
                "confidence": pred["confidence"],
                "bbox": [slot["x"], slot["y"], slot["width"], slot["height"]],
            })

        return self._aggregate(results)

    def _detect_from_rois(self, frame, rois: list[dict]) -> dict:
        """Detect using normalized ROI polygons from RoiStore."""
        fh, fw = frame.shape[:2]
        crops = []

        for roi in rois:
            polygon = roi["polygon"]
            xs = [p[0] for p in polygon]
            ys = [p[1] for p in polygon]
            x1 = max(0, int(min(xs) * fw))
            y1 = max(0, int(min(ys) * fh))
            x2 = min(fw, int(max(xs) * fw))
            y2 = min(fh, int(max(ys) * fh))
            bw, bh = x2 - x1, y2 - y1
            if bw > 5 and bh > 5:
                crop = frame[y1:y2, x1:x2].copy()
                # Mask pixels outside the exact polygon so diagonal slots don't
                # bleed adjacent-slot content into this crop.
                poly_pts = np.array(
                    [[int(p[0] * fw) - x1, int(p[1] * fh) - y1] for p in polygon],
                    dtype=np.int32,
                )
                mask = np.zeros(crop.shape[:2], dtype=np.uint8)
                cv2.fillPoly(mask, [poly_pts], 255)
                crop[mask == 0] = 128  # neutral gray — minimises model bias
            else:
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

    def draw_overlay(self, frame, detection_result):
        """
        Draw bounding boxes on the frame with color coding.
            Green = Vacant
            Red = Occupied

        Args:
            frame (ndarray): Original frame (will be modified in-place)
            detection_result (dict): Result from detect()

        Returns:
            ndarray: Annotated frame
        """
        overlay = frame.copy()

        for slot in detection_result["slots"]:
            x, y, w, h = slot["bbox"]
            status = slot["status"]
            conf = slot["confidence"]

            if status == "vacant":
                color = (0, 200, 0)
            elif status == "occupied":
                color = (0, 0, 200)
            else:
                color = (128, 128, 128)

            cv2.rectangle(overlay, (x, y), (x+w, y+h), color, -1)
            cv2.rectangle(frame, (x, y), (x+w, y+h), color, 2)

            label = f"#{slot['id']} {status[0].upper()} {conf:.0%}"
            font_scale = 0.4
            thickness = 1
            (tw, th), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, font_scale, thickness)
            cv2.rectangle(frame, (x, y - th - 6), (x + tw + 4, y), color, -1)
            cv2.putText(
                frame, label,
                (x + 2, y - 4),
                cv2.FONT_HERSHEY_SIMPLEX, font_scale, (255, 255, 255), thickness
            )

        alpha = 0.25
        frame[:] = cv2.addWeighted(overlay, alpha, frame, 1 - alpha, 0)

        fh, fw = frame.shape[:2]
        bar_h = 40
        cv2.rectangle(frame, (0, fh - bar_h), (fw, fh), (30, 30, 30), -1)
        summary = (
            f"Total: {detection_result['total']}  |  "
            f"Available: {detection_result['available']}  |  "
            f"Occupied: {detection_result['occupied']}  |  "
            f"Occupancy: {detection_result['occupancy_percent']:.1f}%"
        )
        cv2.putText(
            frame, summary, (10, fh - 12),
            cv2.FONT_HERSHEY_SIMPLEX, 0.55, (255, 255, 255), 1
        )

        return frame

    def _empty_result(self):
        return {
            "slots": [],
            "total": 0,
            "available": 0,
            "occupied": 0,
            "occupancy_percent": 0.0,
            "avg_confidence": 0.0,
        }
