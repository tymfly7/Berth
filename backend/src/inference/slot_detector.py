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
from src.inference.classifier import ParkingClassifier

logger = logging.getLogger("smartpark.slot_detector")
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))


class SlotDetector:
    """
    Detects occupied/vacant status for predefined parking slots.

    Loads slot coordinates from spots_config.json and uses the
    ParkingClassifier to classify each cropped region.

    Args:
        model_name (str): Model to use for classification
        spots_config_path (str): Path to JSON with slot coordinates
    """

    def __init__(self, model_name=None, spots_config_path=None):
        self.spots_config_path = Path(spots_config_path or config.SPOTS_CONFIG_PATH)
        self.classifier = ParkingClassifier(model_name=model_name)
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

    def detect(self, frame):
        """
        Analyze a full parking lot image and detect slot status.

        Args:
            frame (ndarray): Full parking lot image (BGR, from OpenCV)

        Returns:
            dict: {
                "slots": [
                    {
                        "id": int,
                        "status": "occupied"|"vacant",
                        "confidence": float,
                        "bbox": [x, y, w, h]
                    },
                    ...
                ],
                "total": int,
                "available": int,
                "occupied": int,
                "occupancy_percent": float,
                "avg_confidence": float,
            }
        """
        if not self.slots:
            return self._empty_result()

        results = []
        crops = []

        # Crop each slot region
        for slot in self.slots:
            x = slot["x"]
            y = slot["y"]
            w = slot["width"]
            h = slot["height"]

            # Bounds checking
            fh, fw = frame.shape[:2]
            x = max(0, min(x, fw - 1))
            y = max(0, min(y, fh - 1))
            w = min(w, fw - x)
            h = min(h, fh - y)

            if w > 5 and h > 5:
                crop = frame[y:y+h, x:x+w]
                crops.append(crop)
            else:
                crops.append(None)

        # Batch classify all valid crops
        valid_crops = [c for c in crops if c is not None]
        if valid_crops and self.classifier.is_loaded():
            predictions = self.classifier.predict_batch(valid_crops)
        else:
            predictions = []

        # Build results
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

        # Aggregate stats
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

            # Color coding
            if status == "vacant":
                color = (0, 200, 0)      # Green
            elif status == "occupied":
                color = (0, 0, 200)      # Red
            else:
                color = (128, 128, 128)  # Gray for unknown

            # Draw filled rectangle with transparency
            cv2.rectangle(overlay, (x, y), (x+w, y+h), color, -1)

            # Draw border
            cv2.rectangle(frame, (x, y), (x+w, y+h), color, 2)

            # Draw label
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

        # Blend overlay for transparent fill effect
        alpha = 0.25
        frame[:] = cv2.addWeighted(overlay, alpha, frame, 1 - alpha, 0)

        # Draw summary bar at bottom
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
