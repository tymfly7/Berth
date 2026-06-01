"""
Video Processor — Real-Time Parking Detection from Camera or Video File
========================================================================
Reads frames from a webcam or video file, classifies each parking slot
using a trained CNN model, and streams annotated frames + metrics.
"""

import os
import sys
import base64
import queue
import threading
import time
import logging
from collections import deque
from datetime import datetime, timezone
from pathlib import Path
import cv2
import numpy as np
import config
from src.roi.roi_store import RoiStore
from src.db import database as db

# FFMPEG capture options applied to all VideoCapture instances:
#
# multiple_requests;0  — disable persistent HTTP connections.  YouTube HLS
#   segments are served from different CDN hosts; ffmpeg's reconnect logic hits
#   a host-mismatch check on every segment, logs "Cannot reuse HTTP connection
#   for different host", and adds a full TCP+TLS handshake per segment.
#   Disabling persistent connections avoids that code path entirely.
#
# fflags;nobuffer  — return packets immediately without input-level buffering,
#   reducing the lag between the live edge and the first decoded frame.
#
# live_start_index;-3  — tell ffmpeg's HLS parser to start 3 segments from the
#   end of the live manifest (near the live edge) instead of the beginning of
#   YouTube's DVR window, which would add 30–60 s of initial latency.
#   Ignored by non-HLS sources (USB cameras, files, RTSP).
os.environ.setdefault(
    "OPENCV_FFMPEG_CAPTURE_OPTIONS",
    "multiple_requests;0|fflags;nobuffer|live_start_index;-3"
    "|probesize;500000|analyzeduration;500000"
    "|reconnect;1|reconnect_streamed;1|reconnect_delay_max;5",
)

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
        self._source_type = "auto"  # auto | usb | rtsp | file | youtube

        self.running = False
        self._thread = None
        self._lock = threading.Lock()
        self._frame = None
        self._metrics = self._default_metrics()
        self._history = deque(maxlen=100)
        self._last_db_write: float = 0.0
        self._heatmap = {}
        self._heatmap_last_ts = None
        self._fps: float = 0.0
        self._fps_frames: int = 0
        self._fps_ts: float = time.time()

        self._detector = self._load_detector()
        self._roi_cache: list = []
        self._roi_cache_ts: float = 0.0
        self._anomaly_enabled = False
        self._yolo_detector = None

    # ── Setup ──────────────────────────────────────────────────────────────

    def _load_detector(self):
        from src.inference.slot_detector import SlotDetector
        try:
            detector = SlotDetector(model_name=self.model_name, camera_id=self.camera_id)
            if detector.classifier.model_name is None:
                logger.info("VideoProcessor ready (no model selected — activate one to enable inference)")
            elif detector.classifier.is_loaded():
                logger.info(f"VideoProcessor ready: {self.model_name}")
            else:
                logger.warning(
                    f"Model weights not found for '{self.model_name}' — "
                    "train the model first"
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

    def set_anomaly_detection(self, enabled: bool) -> None:
        """Enable/disable wrong-parking anomaly detection. Raises if YOLO26 detect model missing."""
        if enabled and self._yolo_detector is None:
            self._load_yolo_detector()
        self._anomaly_enabled = enabled

    def _load_yolo_detector(self) -> None:
        from src.models.yolo_detector import ParkingYOLO26
        self._yolo_detector = ParkingYOLO26(str(config.YOLO26_DETECT_PATH))
        logger.info("Anomaly detection: YOLO26 detector loaded")

    def set_video_source(self, source, source_type="auto"):
        was_running = self.running
        if was_running:
            self.stop_processing()
        self._source = source
        self._source_type = source_type or "auto"
        if was_running:
            self.start_processing()
        logger.info(f"Video source: {source} (type={self._source_type})")

    # ── Background loop ────────────────────────────────────────────────────

    def _is_youtube(self):
        return self._source_type == "youtube"

    def _is_file(self):
        return self._source_type == "file" or (
            self._source_type == "auto" and isinstance(self._source, str)
        )

    def _open_capture(self, force_refresh=False):
        """
        Open a cv2.VideoCapture for the current source.

        For YouTube sources the watch URL is resolved to a live HLS stream URL
        first. Sets a minimal buffer size for YouTube to reduce lag.
        Returns an opened VideoCapture, or None on failure.
        """
        if self._is_youtube():
            from src.cameras.youtube_resolver import (
                resolve_stream_url, YouTubeResolveError,
            )
            try:
                stream_url = resolve_stream_url(self._source, force_refresh=force_refresh)
            except YouTubeResolveError as e:
                logger.error(f"YouTube resolve failed for '{self._source}': {e}")
                return None
            cap = cv2.VideoCapture(stream_url)
        else:
            cap = cv2.VideoCapture(self._source)

        if not cap.isOpened():
            cap.release()
            return None

        if self._is_youtube():
            # Keep only 1 frame in the internal queue so we always get the
            # freshest available frame rather than a buffered stale one.
            cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)

        return cap

    def _loop(self):
        if self._is_youtube():
            self._youtube_loop()
        else:
            self._regular_loop()

    # ── Regular (USB / RTSP / file) loop ──────────────────────────────────

    def _regular_loop(self):
        cap = self._open_capture()
        if cap is None:
            logger.error(f"Cannot open video source: {self._source}")
            self.running = False
            return

        try:
            while self.running:
                ret, raw_frame = cap.read()
                if not ret:
                    if self._is_file():
                        cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
                        continue
                    else:
                        logger.warning("Camera frame grab failed, retrying...")
                        time.sleep(0.1)
                        continue

                self._process_frame(raw_frame)
                time.sleep(1.0 / config.STREAM_FPS)
        finally:
            cap.release()

    # ── YouTube loop with background grab thread ───────────────────────────

    def _youtube_loop(self):
        """
        YouTube HLS streams have 2–8 s segment boundaries; a blocking cap.read()
        call stalls the inference loop for that entire duration. This loop
        separates concerns:

          - grab thread  : owns cap, calls cap.read() as fast as possible,
                           always keeps the single freshest frame in frame_q.
          - inference loop: pulls from frame_q (non-blocking with timeout),
                           runs detection, updates shared state.

        Because the grab thread drains the HLS buffer continuously, the
        inference loop sees new frames immediately after they are decoded
        rather than waiting for a full segment boundary.
        """
        frame_q: queue.Queue = queue.Queue(maxsize=2)
        stop_grab = threading.Event()
        cap_holder = [self._open_capture()]

        if cap_holder[0] is None:
            logger.warning(
                f"YouTube initial connect failed for '{self._source}', "
                "grab thread will retry..."
            )

        def _grab():
            fails = 0
            while not stop_grab.is_set():
                cap = cap_holder[0]
                if cap is None:
                    new = self._open_capture(force_refresh=True)
                    if new:
                        cap_holder[0] = new
                        fails = 0
                        logger.info(f"YouTube grab thread connected: {self._source}")
                    else:
                        stop_grab.wait(2.0)
                    continue

                ret, frame = cap.read()
                if ret:
                    fails = 0
                    # Discard any stale buffered frame; keep only the freshest.
                    while not frame_q.empty():
                        try:
                            frame_q.get_nowait()
                        except queue.Empty:
                            break
                    try:
                        frame_q.put_nowait(frame)
                    except queue.Full:
                        pass
                else:
                    fails += 1
                    if fails >= 3:
                        logger.warning(
                            f"YouTube grab failing — re-resolving stream for '{self._source}'"
                        )
                        try:
                            cap.release()
                        except Exception:
                            pass
                        cap_holder[0] = None
                        fails = 0
                    else:
                        time.sleep(0.05)

            cap = cap_holder[0]
            if cap:
                try:
                    cap.release()
                except Exception:
                    pass

        grab_t = threading.Thread(target=_grab, daemon=True, name="yt-grab")
        grab_t.start()

        try:
            while self.running:
                try:
                    raw_frame = frame_q.get(timeout=5.0)
                except queue.Empty:
                    # No frame yet (still connecting or stream hiccup); keep waiting.
                    continue

                self._process_frame(raw_frame)
                # No sleep here — frame_q.get() is the natural throttle.
                # New frames only arrive as fast as the HLS stream delivers them.
        finally:
            stop_grab.set()
            grab_t.join(timeout=5)

    # ── Shared frame processing ────────────────────────────────────────────

    def _process_frame(self, raw_frame):
        frame = cv2.resize(raw_frame, (config.FRAME_WIDTH, config.FRAME_HEIGHT))
        result = self._detector.detect(frame, camera_id=self.camera_id)

        now = time.time()
        self._fps_frames += 1
        _fps_elapsed = now - self._fps_ts
        if _fps_elapsed >= 1.0:
            self._fps = round(self._fps_frames / _fps_elapsed, 1)
            self._fps_frames = 0
            self._fps_ts = now
        if now - self._roi_cache_ts > 1.0:
            self._roi_cache = RoiStore.get_rois(self.camera_id)
            self._roi_cache_ts = now

        # BGR colors keyed by slot status
        _STATUS_COLOR = {
            "vacant":   (80, 200, 80),
            "occupied": (60,  60, 220),
            "unknown":  (180, 180, 180),
        }

        status_map = {s["id"]: s["status"] for s in result.get("slots", [])}

        display = frame.copy()
        if self._roi_cache:
            h, w = display.shape[:2]
            for roi in self._roi_cache:
                pts = np.array(
                    [[int(p[0] * w), int(p[1] * h)] for p in roi.get("polygon", [])],
                    np.int32,
                )
                if len(pts) >= 3:
                    status = status_map.get(roi.get("id"), "unknown")
                    color = _STATUS_COLOR.get(status, _STATUS_COLOR["unknown"])
                    cv2.polylines(display, [pts], True, color, 2)

        misparked_count = 0
        if self._anomaly_enabled and self._yolo_detector is not None and self._roi_cache:
            h, w = frame.shape[:2]
            try:
                from src.inference.parking_geometry import classify_vehicle_parking
                cars = self._yolo_detector.predict_frame(frame)
                for car in cars:
                    clf = classify_vehicle_parking(car["bbox"], self._roi_cache, w, h)
                    if clf["status"] == "misparked":
                        misparked_count += 1
                        x1, y1, x2, y2 = (int(v) for v in car["bbox"])
                        cv2.rectangle(display, (x1, y1), (x2, y2), (0, 165, 255), 2)
                        reason = "STRADDLE" if clf["reason"] == "straddling" else "OUTSIDE"
                        cv2.putText(display, reason, (x1 + 2, max(y1 - 4, 14)),
                                    cv2.FONT_HERSHEY_SIMPLEX, 0.45, (0, 165, 255), 1)
            except Exception as e:
                logger.warning(f"Anomaly detection error: {e}")

        metrics = self._result_to_metrics(result)
        metrics["misparked_count"] = misparked_count
        metrics["anomaly_enabled"] = self._anomaly_enabled
        ts = datetime.now(timezone.utc).isoformat()

        with self._lock:
            self._frame = display
            self._metrics = metrics
            self._history.append({
                "timestamp": ts,
                "available": metrics["available"],
                "occupied": metrics["occupied"],
                "occupancy_percent": metrics["occupancy_percent"],
            })
            self._update_heatmap(result["slots"])
            now_t = time.time()
            if now_t - self._last_db_write >= 60:
                self._last_db_write = now_t
                try:
                    db.record_occupancy(
                        self.camera_id,
                        metrics["available"],
                        metrics["occupied"],
                        metrics["occupancy_percent"],
                    )
                    db.maybe_record_alert(self.camera_id, metrics["occupancy_percent"])
                except Exception as _db_err:
                    logger.warning(f"DB write failed: {_db_err}")

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
            "fps": self._fps,
            "source_type": self._source_type,
            "mode": self.model_name,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }

    def _update_heatmap(self, slots):
        now = time.time()
        elapsed = (now - self._heatmap_last_ts) if self._heatmap_last_ts is not None else 0.0
        self._heatmap_last_ts = now
        for slot in slots:
            sid = str(slot["id"])
            if sid not in self._heatmap:
                self._heatmap[sid] = {"occupied_seconds": 0.0, "total_seconds": 0.0}
            self._heatmap[sid]["total_seconds"] += elapsed
            if slot["status"] == "occupied":
                self._heatmap[sid]["occupied_seconds"] += elapsed

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
                try:
                    slot_id = int(sid)
                except (ValueError, TypeError):
                    slot_id = sid
                result.append({
                    "slot_id": slot_id,
                    "occupied_seconds": round(data["occupied_seconds"], 1),
                    "total_seconds": round(data["total_seconds"], 1),
                })
            return result

    def _default_metrics(self):
        return {
            "total": 0, "available": 0, "occupied": 0,
            "occupancy_percent": 0.0, "avg_confidence": 0.0,
            "slots": [], "fps": 0.0, "source_type": "auto", "mode": "unknown",
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "misparked_count": 0,
            "anomaly_enabled": False,
        }
