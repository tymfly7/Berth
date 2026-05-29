"""
Video Processor — Real-Time Parking Detection from Camera or Video File
========================================================================
Reads frames from a webcam or video file, classifies each parking slot
using a trained CNN model, and streams annotated frames + metrics.

Implements the same interface as DemoProcessor so main.py can swap
between them transparently.
"""

import sys
import base64
import threading
import time
import logging
from collections import deque
from datetime import datetime, timezone
from pathlib import Path
import cv2
import config

logger = logging.getLogger("smartpark.video")
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))


class VideoProcessor:
    """
    Reads video frames, classifies parking slots, and streams results.

    Args:
        model_name (str): Model architecture to use for inference.
    """

    def __init__(self, model_name=None, camera_id: str = "default"):
        self.model_name = model_name or config.ACTIVE_MODEL
        self.camera_id = camera_id
        self._source = 0          # 0 = first webcam; str = video file path

        self.running = False
        self._thread = None
        self._lock = threading.Lock()
        self._frame = None
        self._metrics = self._default_metrics()
        self._history = deque(maxlen=100)
        self._heatmap = {}

        self._detector = self._load_detector()

    # ── Setup ──────────────────────────────────────────────────────────────

    def _load_detector(self):
        from src.inference.slot_detector import SlotDetector
        try:
            detector = SlotDetector(model_name=self.model_name, camera_id=self.camera_id)
            if detector.classifier.is_loaded():
                logger.info(f"VideoProcessor ready: {self.model_name}")
            else:
                logger.warning(
                    f"Model weights not found for '{self.model_name}' — "
                    "predictions will show as unknown until a model is trained"
                )
            return detector
        except Exception as e:
            logger.error(f"SlotDetector init failed: {e}")
            raise

    # ── Control ────────────────────────────────────────────────────────────

    def start_processing(self):
        if self.running:
            return
        self.running = True
        self._thread = threading.Thread(target=self._loop, daemon=True)
        self._thread.start()
        logger.info(f"VideoProcessor started (source: {self._source})")

    def stop_processing(self):
        self.running = False
        if self._thread:
            self._thread.join(timeout=3)

    def set_video_source(self, source):
        was_running = self.running
        if was_running:
            self.stop_processing()
        self._source = source
        if was_running:
            self.start_processing()
        logger.info(f"Video source: {source}")

    # ── Background loop ────────────────────────────────────────────────────

    def _loop(self):
        cap = cv2.VideoCapture(self._source)
        if not cap.isOpened():
            logger.error(f"Cannot open video source: {self._source}")
            self.running = False
            return

        try:
            while self.running:
                ret, raw_frame = cap.read()
                if not ret:
                    if isinstance(self._source, str):
                        # Loop video file back to start
                        cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
                        continue
                    else:
                        logger.warning("Camera frame grab failed, retrying...")
                        time.sleep(0.1)
                        continue

                frame = cv2.resize(raw_frame, (config.FRAME_WIDTH, config.FRAME_HEIGHT))
                result = self._detector.detect(frame, camera_id=self.camera_id)
                annotated = self._detector.draw_overlay(frame.copy(), result)

                cv2.putText(
                    annotated,
                    f"Smart Parking AI — {self.model_name}",
                    (15, 25),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.65, (200, 200, 200), 2,
                )

                metrics = self._result_to_metrics(result)
                ts = datetime.now(timezone.utc).isoformat()

                with self._lock:
                    self._frame = annotated
                    self._metrics = metrics
                    self._history.append({
                        "timestamp": ts,
                        "available": metrics["available"],
                        "occupied": metrics["occupied"],
                        "occupancy_percent": metrics["occupancy_percent"],
                    })
                    self._update_heatmap(result["slots"])

                time.sleep(1.0 / config.STREAM_FPS)
        finally:
            cap.release()

    # ── Helpers ────────────────────────────────────────────────────────────

    def _result_to_metrics(self, result):
        return {
            "total": result["total"],
            "available": result["available"],
            "occupied": result["occupied"],
            "occupancy_percent": result["occupancy_percent"],
            "avg_confidence": result["avg_confidence"],
            "slots": [
                {
                    "id": s["id"],
                    "status": s["status"],
                    "confidence": s["confidence"],
                    "bbox": s["bbox"],
                }
                for s in result["slots"]
            ],
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }

    def _update_heatmap(self, slots):
        for slot in slots:
            sid = str(slot["id"])
            if sid not in self._heatmap:
                self._heatmap[sid] = {"occupied_count": 0, "total_count": 0}
            self._heatmap[sid]["total_count"] += 1
            if slot["status"] == "occupied":
                self._heatmap[sid]["occupied_count"] += 1

    # ── Public getters ─────────────────────────────────────────────────────

    def get_latest_frame_base64(self):
        with self._lock:
            if self._frame is None:
                return None
            _, buf = cv2.imencode(
                ".jpg", self._frame,
                [cv2.IMWRITE_JPEG_QUALITY, config.JPEG_QUALITY],
            )
            return base64.b64encode(buf).decode("utf-8")

    def get_metrics(self):
        with self._lock:
            return dict(self._metrics)

    def get_history(self):
        with self._lock:
            return list(self._history)

    def get_heatmap(self):
        with self._lock:
            result = []
            for sid, data in self._heatmap.items():
                total = data["total_count"]
                occ = data["occupied_count"]
                try:
                    slot_id = int(sid)
                except (ValueError, TypeError):
                    slot_id = sid
                result.append({
                    "slot_id": slot_id,
                    "occupancy_rate": round(occ / total * 100, 1) if total else 0,
                    "total_observations": total,
                })
            return result

    def _default_metrics(self):
        return {
            "total": 0, "available": 0, "occupied": 0,
            "occupancy_percent": 0.0, "avg_confidence": 0.0,
            "slots": [], "timestamp": datetime.now(timezone.utc).isoformat(),
        }
