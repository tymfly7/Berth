"""
Video Processor — Real-Time Parking Detection from Camera or Video File
========================================================================
Reads frames from a webcam or video file, classifies each parking slot
using a trained CNN model, and streams annotated frames + metrics.

Display and inference run on independent threads so live video is never
blocked by model inference. The source thread feeds raw frames to both;
the display thread encodes JPEGs immediately using cached slot statuses;
the inference thread runs the model in the background and updates the cache.
"""

import os
import sys
import base64
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

# FFMPEG capture options applied to all VideoCapture instances.
# multiple_requests;0  — disable persistent HTTP connections so YouTube CDN
#   host changes between HLS segments don't cause reconnect warnings.
# fflags;nobuffer  — return packets immediately without input buffering.
# live_start_index;-3  — start near the live edge of the HLS manifest.
os.environ.setdefault(
    "OPENCV_FFMPEG_CAPTURE_OPTIONS",
    "multiple_requests;0|fflags;nobuffer|live_start_index;-3"
    "|probesize;500000|analyzeduration;500000"
    "|reconnect;1|reconnect_streamed;1|reconnect_delay_max;5",
)

logger = logging.getLogger("berth.video")
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))


class VideoProcessor:
    """
    Three-thread pipeline per camera:
      source thread  — reads frames from the capture device / stream.
      display thread — resizes + encodes JPEG immediately using cached results.
      inference thread — runs ML model, updates metrics and overlay cache.
    """

    _STATUS_COLOR = {
        "vacant":   (80, 200, 80),
        "occupied": (60,  60, 220),
        "unknown":  (180, 180, 180),
    }

    def __init__(self, model_name=None, camera_id: str = "default"):
        self.model_name = model_name or config.ACTIVE_MODEL
        self.camera_id = camera_id
        self._source = 0
        self._source_type = "auto"

        self.running = False
        self._thread = None          # source thread
        self._display_thread = None
        self._infer_thread = None
        self._lock = threading.Lock()

        # Latest raw frame for the inference thread (always the newest).
        self._latest_raw: np.ndarray | None = None
        self._latest_raw_lock = threading.Lock()
        self._infer_event = threading.Event()

        # Jitter buffer: source pushes every raw frame here; display pops at
        # STREAM_FPS. Absorbs bursty HLS segment delivery so the display
        # thread drains the buffer smoothly during the inter-segment gap
        # instead of freezing. maxlen caps memory and prevents unbounded
        # latency on sources faster than STREAM_FPS.
        _jitter_secs = 2
        self._jitter_buffer: deque = deque(maxlen=config.STREAM_FPS * _jitter_secs)
        self._jitter_lock = threading.Lock()
        self._last_display_raw: np.ndarray | None = None

        # Increments each time the display loop encodes a genuinely new JPEG.
        self._frame_seq: int = 0

        # Inference results shared with the display thread (overlays).
        self._cached_status_map: dict = {}
        self._cached_anomalies: list = []   # [{"bbox": (x1,y1,x2,y2), "label": str}]
        self._cached_status_lock = threading.Lock()

        self._frame = None
        self._frame_b64 = None
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
        self._anomaly_park_thresh = 0.60
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
        self._display_thread = threading.Thread(
            target=self._display_loop, daemon=True, name="sp-display"
        )
        self._display_thread.start()
        self._infer_thread = threading.Thread(
            target=self._inference_submit_loop, daemon=True, name="sp-infer"
        )
        self._infer_thread.start()
        self._thread = threading.Thread(
            target=self._loop, daemon=True, name="sp-source"
        )
        self._thread.start()
        logger.info(f"VideoProcessor started (source: {self._source})")

    def stop_processing(self):
        self.running = False
        self._infer_event.set()  # unblock inference thread so it can exit
        for t in (self._thread, self._display_thread, self._infer_thread):
            if t:
                t.join(timeout=3)

    def set_anomaly_detection(self, enabled: bool) -> None:
        """Enable/disable wrong-parking anomaly detection."""
        if enabled and self._yolo_detector is None:
            self._load_yolo_detector()
        self._anomaly_enabled = enabled

    def set_anomaly_sensitivity(self, park_thresh: float) -> None:
        """Set how strictly a car must sit inside one bay to count as parked.
        Higher → stricter → more vehicles flagged as poorly parked."""
        self._anomaly_park_thresh = max(0.0, min(1.0, float(park_thresh)))

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

    # ── Source routing ─────────────────────────────────────────────────────

    def _is_youtube(self):
        return self._source_type == "youtube"

    def _is_file(self):
        return self._source_type == "file" or (
            self._source_type == "auto" and isinstance(self._source, str)
        )

    def _open_capture(self, force_refresh=False):
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
            cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)

        return cap

    def _loop(self):
        if self._is_youtube():
            self._youtube_source_loop()
        else:
            self._regular_source_loop()

    # ── Frame ingestion (called by source thread) ──────────────────────────

    def _ingest_raw_frame(self, frame: np.ndarray):
        """Push frame into the jitter buffer (display) and update latest_raw (inference)."""
        with self._latest_raw_lock:
            self._latest_raw = frame
        with self._jitter_lock:
            self._jitter_buffer.append(frame)
        self._infer_event.set()

    # ── Regular (USB / RTSP / file) source loop ───────────────────────────

    def _regular_source_loop(self):
        cap = self._open_capture()
        if cap is None:
            logger.error(f"Cannot open video source: {self._source}")
            self.running = False
            return

        # For file sources, read at the video's own FPS so playback is real-speed.
        # Falling back to STREAM_FPS would make low-FPS videos play too fast
        # (e.g. a 13 fps file read at 20 fps plays at 1.5×).
        if self._is_file():
            native_fps = cap.get(cv2.CAP_PROP_FPS)
            file_frame_interval = 1.0 / (native_fps if 1 <= native_fps <= 120 else config.STREAM_FPS)
        else:
            file_frame_interval = 0.0

        consecutive_failures = 0
        _MAX_FAILURES = 50  # ~5 s at 0.1 s/retry before giving up
        try:
            while self.running:
                ret, raw_frame = cap.read()
                if not ret:
                    if self._is_file():
                        cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
                        continue
                    consecutive_failures += 1
                    if consecutive_failures >= _MAX_FAILURES:
                        logger.warning(f"Camera '{self._source}' unavailable, stopping.")
                        self.running = False
                        break
                    time.sleep(0.1)
                    continue
                consecutive_failures = 0
                self._ingest_raw_frame(raw_frame)
                # Live sources (USB/RTSP) block naturally inside cap.read().
                if file_frame_interval:
                    time.sleep(file_frame_interval)
        finally:
            cap.release()

    # ── YouTube source loop ────────────────────────────────────────────────

    def _youtube_source_loop(self):
        """
        Owns the VideoCapture for YouTube HLS streams. Reads frames as fast
        as the stream delivers them, feeds each to _ingest_raw_frame, and
        auto-reconnects when the stream stalls or the HLS URL expires.
        """
        cap_holder = [self._open_capture()]
        if cap_holder[0] is None:
            logger.warning(
                f"YouTube initial connect failed for '{self._source}', "
                "will retry..."
            )

        stop_grab = threading.Event()

        def _fps_interval(cap) -> float:
            fps = cap.get(cv2.CAP_PROP_FPS) if cap else 0
            return 1.0 / fps if 1 <= fps <= 120 else 0.0

        def _grab():
            fails = 0
            frame_interval = _fps_interval(cap_holder[0])
            while not stop_grab.is_set():
                cap = cap_holder[0]
                if cap is None:
                    new = self._open_capture(force_refresh=True)
                    if new:
                        cap_holder[0] = new
                        frame_interval = _fps_interval(new)
                        fails = 0
                        logger.info(f"YouTube stream connected: {self._source}")
                    else:
                        stop_grab.wait(2.0)
                    continue

                ret, frame = cap.read()
                if ret:
                    fails = 0
                    self._ingest_raw_frame(frame)
                    if frame_interval:
                        time.sleep(frame_interval)
                else:
                    fails += 1
                    if fails >= 3:
                        logger.warning(
                            f"YouTube stream stalling — re-resolving for '{self._source}'"
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
                time.sleep(0.5)
        finally:
            stop_grab.set()
            grab_t.join(timeout=5)

    # ── Display loop (fast path) ───────────────────────────────────────────

    def _display_loop(self):
        """
        Timer-driven at STREAM_FPS. For YouTube HLS sources the jitter buffer
        absorbs burst segment delivery. For all other sources the latest raw
        frame is used directly so live feeds have no buffering lag.
        """
        frame_interval = 1.0 / config.STREAM_FPS

        while self.running:
            t0 = time.time()

            if self._is_youtube():
                # YouTube HLS: drain jitter buffer to smooth inter-segment gaps.
                with self._jitter_lock:
                    has_new = bool(self._jitter_buffer)
                    if has_new:
                        raw = self._jitter_buffer.popleft()
                        self._last_display_raw = raw
                    else:
                        raw = self._last_display_raw
            else:
                # Live USB/RTSP/file: always show the newest available frame.
                with self._latest_raw_lock:
                    latest = self._latest_raw
                has_new = latest is not self._last_display_raw
                if has_new:
                    self._last_display_raw = latest
                raw = self._last_display_raw

            if raw is not None:
                frame = cv2.resize(raw, (config.FRAME_WIDTH, config.FRAME_HEIGHT))

                # Refresh ROI cache at most once per second.
                if t0 - self._roi_cache_ts > 1.0:
                    self._roi_cache = RoiStore.get_rois(self.camera_id)
                    self._roi_cache_ts = t0

                # Draw slot overlays using the last inference result.
                display = frame.copy()
                if self._roi_cache:
                    h, w = display.shape[:2]
                    with self._cached_status_lock:
                        status_map = dict(self._cached_status_map)
                    for roi in self._roi_cache:
                        pts = np.array(
                            [[int(p[0] * w), int(p[1] * h)] for p in roi.get("polygon", [])],
                            np.int32,
                        )
                        if len(pts) >= 3:
                            status = status_map.get(roi.get("id"), "unknown")
                            color = self._STATUS_COLOR.get(status, self._STATUS_COLOR["unknown"])
                            cv2.polylines(display, [pts], True, color, 2)

                # Draw cached anomaly overlays.
                with self._cached_status_lock:
                    anomalies = list(self._cached_anomalies)
                for a in anomalies:
                    color = (0, 165, 255)
                    if "polygons" in a:
                        for pts in a["polygons"]:
                            cv2.polylines(display, [pts], True, color, 2)
                            cv2.putText(display, a["label"], tuple(pts[0]),
                                        cv2.FONT_HERSHEY_SIMPLEX, 0.45, color, 1)
                    else:
                        x1, y1, x2, y2 = a["bbox"]
                        cv2.rectangle(display, (x1, y1), (x2, y2), color, 2)
                        cv2.putText(display, a["label"], (x1 + 2, max(y1 - 4, 14)),
                                    cv2.FONT_HERSHEY_SIMPLEX, 0.45, color, 1)

                # Track display-side FPS (only count new frames, not repeats).
                if has_new:
                    self._fps_frames += 1
                fps_elapsed = t0 - self._fps_ts
                if fps_elapsed >= 1.0:
                    self._fps = round(self._fps_frames / fps_elapsed, 1)
                    self._fps_frames = 0
                    self._fps_ts = t0

                _, buf = cv2.imencode(".jpg", display, [cv2.IMWRITE_JPEG_QUALITY, config.JPEG_QUALITY])
                frame_b64 = base64.b64encode(buf).decode("utf-8")

                with self._lock:
                    self._frame = display
                    self._frame_b64 = frame_b64
                    # Only advance seq for genuinely new frames so the WS
                    # knows not to resend a repeated still.
                    if has_new:
                        self._frame_seq += 1

            sleep_time = frame_interval - (time.time() - t0)
            if sleep_time > 0:
                time.sleep(sleep_time)

    # ── Inference loop (background) ────────────────────────────────────────

    def _inference_submit_loop(self):
        """
        Lightweight event loop: wakes on new frames and submits work to the
        shared InferencePool. Returns immediately after submit so this thread
        never blocks on the model — the pool worker calls detect() and invokes
        _on_inference_result when done.
        """
        from src.inference.inference_pool import InferencePool
        pool = InferencePool.get()
        while self.running:
            if not self._infer_event.wait(timeout=2.0):
                continue
            self._infer_event.clear()
            if not self.running:
                break
            with self._latest_raw_lock:
                raw = self._latest_raw
            if raw is None:
                continue
            frame = cv2.resize(raw, (config.FRAME_WIDTH, config.FRAME_HEIGHT))
            pool.submit(
                self._detector, frame, self.camera_id,
                lambda result, f=frame: self._on_inference_result(result, f),
            )

    def _on_inference_result(self, result: dict, frame: np.ndarray) -> None:
        """Called by a pool worker after detect() completes. Updates overlay cache, metrics, DB."""
        new_status_map = {s["id"]: s["status"] for s in result.get("slots", [])}

        # Anomaly detection (optional YOLO26 detect pass).
        new_anomalies = []
        if self._anomaly_enabled and self._yolo_detector is not None and self._roi_cache:
            h, w = frame.shape[:2]
            try:
                from src.inference.parking_geometry import classify_vehicle_parking
                cars = self._yolo_detector.predict_frame(frame)
                roi_by_id = {r["id"]: r for r in self._roi_cache}
                for car in cars:
                    clf = classify_vehicle_parking(
                        car["bbox"], self._roi_cache, w, h,
                        park_thresh=self._anomaly_park_thresh,
                    )
                    if clf["status"] == "misparked":
                        if clf["reason"] == "straddling":
                            polygons = []
                            for rid in clf["intruded_rois"]:
                                roi = roi_by_id.get(rid)
                                if roi and roi.get("polygon"):
                                    pts = np.array(
                                        [[int(p[0] * w), int(p[1] * h)] for p in roi["polygon"]],
                                        dtype=np.int32,
                                    )
                                    polygons.append(pts)
                            new_anomalies.append({"label": "STRADDLE", "polygons": polygons})
                        else:
                            x1, y1, x2, y2 = (int(v) for v in car["bbox"])
                            new_anomalies.append({"label": "OUTSIDE", "bbox": (x1, y1, x2, y2)})
            except Exception as e:
                logger.warning(f"Anomaly detection error: {e}")

        with self._cached_status_lock:
            self._cached_status_map = new_status_map
            self._cached_anomalies = new_anomalies

        metrics = self._result_to_metrics(result)
        metrics["misparked_count"] = len(new_anomalies)
        metrics["anomaly_enabled"] = self._anomaly_enabled
        ts = datetime.now(timezone.utc).isoformat()

        with self._lock:
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
            return self._frame_b64

    def get_frame_seq(self) -> int:
        """Increments each time a new JPEG is encoded. Use to detect new frames."""
        with self._lock:
            return self._frame_seq

    def get_frame_and_seq(self) -> tuple:
        """Atomically returns (frame_b64, frame_seq) under a single lock."""
        with self._lock:
            return self._frame_b64, self._frame_seq

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
