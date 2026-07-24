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
import re
import sys
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
# live_start_index;-1  — ride the live edge of the HLS manifest (last segment).
os.environ.setdefault(
    "OPENCV_FFMPEG_CAPTURE_OPTIONS",
    "multiple_requests;0|fflags;nobuffer|live_start_index;-1"
    "|probesize;500000|analyzeduration;500000"
    "|reconnect;1|reconnect_streamed;1|reconnect_delay_max;5",
)

logger = logging.getLogger("berth.video")
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))


def default_metrics() -> dict:
    """Canonical empty-metrics shape. Returned by analytics endpoints when no
    camera is active so the dashboard renders zeros instead of erroring."""
    return {
        "total": 0, "available": 0, "occupied": 0,
        "occupancy_percent": 0.0, "avg_confidence": 0.0,
        "slots": [], "fps": 0.0, "infer_fps": 0.0, "infer_ms": 0.0,
        "infer_cap": float(config.INFER_FPS),
        "source_type": "auto", "mode": "unknown",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "misparked_count": 0,
        "anomaly_enabled": False,
    }


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

    def __init__(self, model_name=None, camera_id: str = "default",
                 name: str = None, data_gathering: bool = False):
        self.model_name = model_name or config.ACTIVE_MODEL
        self.camera_id = camera_id
        # Display name drives the per-camera capture folder; sanitized for fs safety.
        self._capture_name = re.sub(r"[^A-Za-z0-9._-]", "_", name or camera_id)
        self._data_gathering = data_gathering
        self._source = 0
        self._source_type = "auto"

        self.running = False
        # Bumped on every (re)start. Inference jobs capture the generation at
        # submit time; a result that arrives after a source switch / restart is
        # discarded so a stale frame's overlay can't clobber the live one.
        self._generation = 0
        self._thread = None          # source thread
        self._display_thread = None
        self._infer_thread = None
        self._lock = threading.Lock()

        # Latest raw frame for the inference thread (always the newest).
        self._latest_raw: np.ndarray | None = None
        self._last_capture = 0.0
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
        # Snapshot mode: set when an inference result lands so the display loop
        # re-encodes (and re-sends) the still with the fresh overlay.
        self._overlay_dirty = False
        self._vacant_since: dict = {}       # slot_id → time.time() when first seen vacant
        self._straddle_last_seen: dict = {} # slot_id → time.time() last seen straddled

        self._frame = None
        self._frame_jpeg: bytes | None = None   # latest encoded JPEG (sent over WS as binary)
        self._metrics = self._default_metrics()
        self._history = deque(maxlen=100)
        self._last_db_write: float = 0.0
        self._heatmap = {}
        self._heatmap_last_ts = None
        self._fps: float = 0.0
        self._fps_frames: int = 0
        self._fps_ts: float = time.time()
        self._infer_fps = 0.0
        self._infer_frames = 0
        self._infer_ts = time.time()
        self._infer_ms = 0.0          # rolling mean submit->result latency (ms)

        self._detector = self._load_detector()
        self._roi_cache: list = []
        self._roi_cache_ts: float = 0.0
        self._anomaly_enabled = False
        self._anomaly_park_thresh = 0.60
        self._yolo_detector = None
        # Anomaly/detect pass runs on its own slow cadence (config.ANOMALY_FPS),
        # decoupled from INFER_FPS; the last result is reused between passes.
        self._last_anomaly_ts = 0.0
        self._last_anomalies: list = []
        self._last_straddled_ids: set = set()

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
        self._generation += 1
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

    def set_data_gathering(self, enabled: bool) -> None:
        """Enable/disable periodic full-frame capture for training data collection."""
        self._data_gathering = enabled

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
        # On edge use the NCNN-exported detect model (torch-free, ARM-fast); fall
        # back to the torch .pt elsewhere. The .pt is not shipped in the edge
        # image, so anomaly detection must run on the NCNN export there.
        if config.DEPLOYMENT_PROFILE == "edge" and config.YOLO26_DETECT_NCNN_PATH.exists():
            from src.models.yolo_detector_ncnn import EdgeYoloDetector
            self._yolo_detector = EdgeYoloDetector(str(config.YOLO26_DETECT_NCNN_PATH))
            logger.info(f"Anomaly detection: NCNN detector loaded ({config.YOLO26_DETECT_NCNN_PATH.name})")
        else:
            from src.models.yolo_detector import ParkingYOLO26
            self._yolo_detector = ParkingYOLO26(str(config.YOLO26_DETECT_PATH))
            logger.info(f"Anomaly detection: YOLO26 detector loaded ({config.YOLO26_DETECT_PATH.name})")

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

    def _snapshot_mode(self) -> bool:
        # Snapshot mode applies to live sources only: re-opening a file per
        # snapshot would replay frame 0 forever.
        return config.SNAPSHOT_INTERVAL > 0 and not self._is_file()

    def _is_file(self):
        return self._source_type == "file" or (
            self._source_type == "auto" and isinstance(self._source, str)
        )

    def _open_capture(self, force_refresh=False):
        is_rtsp = self._source_type == "rtsp" or (
            isinstance(self._source, str) and self._source.lower().startswith("rtsp")
        )
        if self._is_youtube():
            from src.cameras.youtube_resolver import (
                resolve_stream_url, YouTubeResolveError,
            )
            try:
                stream_url = resolve_stream_url(self._source, force_refresh=force_refresh)
            except YouTubeResolveError as e:
                logger.error(f"YouTube resolve failed for '{self._source}': {e}")
                return None
            # Set YouTube options explicitly here so a prior RTSP open (which sets
            # rtsp_transport;tcp below) can't leave the process env clobbered for a
            # later YouTube reconnect. Force the FFmpeg backend so the options apply.
            os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = (
                "multiple_requests;0|fflags;nobuffer|live_start_index;-1"
                "|probesize;500000|analyzeduration;500000"
                "|reconnect;1|reconnect_streamed;1|reconnect_delay_max;5"
            )
            cap = cv2.VideoCapture(stream_url, cv2.CAP_FFMPEG)
        elif is_rtsp:
            # Force RTSP over TCP. UDP packet loss (common over Wi-Fi / a busy
            # LAN) corrupts H264 macroblocks — the pixelation and "error while
            # decoding MB" spam. TCP trades a little latency for a clean stream.
            os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = "rtsp_transport;tcp"
            cap = cv2.VideoCapture(self._source, cv2.CAP_FFMPEG)
        else:
            cap = cv2.VideoCapture(self._source)

        if not cap.isOpened():
            cap.release()
            return None

        if self._is_youtube() or is_rtsp:
            cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)

        return cap

    def _loop(self):
        if self._snapshot_mode():
            self._snapshot_source_loop()
        elif self._is_youtube():
            self._youtube_source_loop()
        else:
            self._regular_source_loop()

    # ── Frame ingestion (called by source thread) ──────────────────────────

    def _ingest_raw_frame(self, frame: np.ndarray):
        """Push frame into the jitter buffer (display) and update latest_raw (inference)."""
        if config.MAX_FRAME_HEIGHT and frame.shape[0] > config.MAX_FRAME_HEIGHT:
            scale = config.MAX_FRAME_HEIGHT / frame.shape[0]
            frame = cv2.resize(
                frame,
                (int(frame.shape[1] * scale), config.MAX_FRAME_HEIGHT),
                interpolation=cv2.INTER_AREA,
            )
        with self._latest_raw_lock:
            self._latest_raw = frame
        # Snapshot mode: skip the jitter buffer — one frame per interval has
        # nothing to smooth, and the undrained buffer would just pin memory.
        if not self._snapshot_mode():
            with self._jitter_lock:
                self._jitter_buffer.append(frame)
        self._infer_event.set()

    # ── Snapshot source loop (edge low-power mode) ─────────────────────────

    def _snapshot_source_loop(self):
        """
        Grab a single frame every SNAPSHOT_INTERVAL seconds instead of decoding
        the stream continuously. The capture is opened and released per grab so
        the worker is fully idle between snapshots — decode cost becomes
        proportional to the snapshot cadence, not the source frame rate.
        """
        _WARMUP_READS = 3       # flush the stale first keyframe (RTSP/HLS)
        _MAX_FAILED_INTERVALS = 10
        failed_intervals = 0

        while self.running:
            t0 = time.time()
            frame = None
            # After a failed interval force a fresh YouTube resolve — the
            # cached HLS URL may have expired between snapshots.
            cap = self._open_capture(force_refresh=failed_intervals > 0)
            if cap is not None:
                try:
                    for _ in range(_WARMUP_READS):
                        ret, f = cap.read()
                        if ret:
                            frame = f
                finally:
                    cap.release()

            if frame is not None:
                failed_intervals = 0
                self._ingest_raw_frame(frame)
            else:
                failed_intervals += 1
                logger.warning(
                    f"Snapshot grab failed for '{self._source}' "
                    f"({failed_intervals}/{_MAX_FAILED_INTERVALS})"
                )
                if failed_intervals >= _MAX_FAILED_INTERVALS:
                    logger.warning(f"Camera '{self._source}' unavailable, stopping.")
                    self.running = False
                    break

            # Sleep out the interval in short slices so stop_processing never
            # blocks for a full interval.
            while self.running and time.time() - t0 < config.SNAPSHOT_INTERVAL:
                time.sleep(0.5)

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
        # Snapshot mode: frames arrive every SNAPSHOT_INTERVAL seconds, so a
        # 1 Hz tick is plenty and re-encoding the same still at STREAM_FPS
        # would waste CPU.
        snapshot_mode = self._snapshot_mode()
        frame_interval = 1.0 if snapshot_mode else 1.0 / config.STREAM_FPS

        while self.running:
            t0 = time.time()

            # Snapshot mode: pop the overlay-dirty flag so the still is
            # re-encoded (and re-sent) once the inference result lands.
            overlay_dirty = False
            if snapshot_mode:
                with self._cached_status_lock:
                    overlay_dirty = self._overlay_dirty
                    self._overlay_dirty = False

            if self._is_youtube() and not snapshot_mode:
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

            if raw is not None and (not snapshot_mode or has_new or overlay_dirty):
                frame = cv2.resize(raw, (config.FRAME_WIDTH, config.FRAME_HEIGHT))

                # Refresh ROI cache at most once per second.
                if t0 - self._roi_cache_ts > 1.0:
                    self._roi_cache = RoiStore.get_rois(self.camera_id)
                    self._roi_cache_ts = t0

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
                jpeg_bytes = buf.tobytes()

                with self._lock:
                    self._frame = display
                    self._frame_jpeg = jpeg_bytes
                    # Only advance seq for genuinely new frames so the WS
                    # knows not to resend a repeated still. A fresh overlay
                    # counts as new: in snapshot mode the inference result
                    # lands after the raw frame was already sent, so without
                    # a seq bump the corrected overlay would never be pushed.
                    if has_new or overlay_dirty:
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
        infer_interval = 1.0 / config.INFER_FPS if config.INFER_FPS > 0 else 0.0
        last_submit = 0.0
        while self.running:
            if not self._infer_event.wait(timeout=2.0):
                continue
            self._infer_event.clear()
            if not self.running:
                break
            # Throttle inference: parking occupancy changes slowly, so running the
            # model on every decoded frame (up to the source's full FPS) just burns
            # CPU. Cap submissions to INFER_FPS. The display loop still streams at
            # STREAM_FPS using the last result, so video stays smooth.
            now = time.time()
            if infer_interval and now - last_submit < infer_interval:
                continue
            last_submit = now
            with self._latest_raw_lock:
                raw = self._latest_raw
            if raw is None:
                continue
            if self._data_gathering and now - self._last_capture >= config.CAPTURE_INTERVAL_SECS:
                self._last_capture = now
                day = datetime.now().strftime("%d-%m-%y")          # e.g. 12-06-26
                out = config.CAPTURE_DIR / self._capture_name / day
                out.mkdir(parents=True, exist_ok=True)
                idx = len(list(out.glob("*.jpg"))) + 1
                ts = datetime.now().strftime("%H%M%S")
                cv2.imwrite(str(out / f"img_{idx:03d}_{ts}.jpg"), raw)
            frame = cv2.resize(raw, (config.FRAME_WIDTH, config.FRAME_HEIGHT))
            gen = self._generation
            t_sub = time.time()
            pool.submit(
                self._detector, frame, self.camera_id,
                lambda result, f=frame, g=gen, t=t_sub: self._on_inference_result(result, f, g, t),
            )

    def _on_inference_result(self, result: dict, frame: np.ndarray, generation: int | None = None,
                             submit_ts: float | None = None) -> None:
        """Called by a pool worker after detect() completes. Updates overlay cache, metrics, DB."""
        # Drop results from a previous source/run that finished after a restart.
        if generation is not None and generation != self._generation:
            return

        # Track real inference rate + latency (where inferences actually complete),
        # mirroring the display-fps logic in the read loop.
        _t = time.time()
        with self._lock:
            self._infer_frames += 1
            infer_elapsed = _t - self._infer_ts
            if infer_elapsed >= 1.0:
                self._infer_fps = round(self._infer_frames / infer_elapsed, 1)
                self._infer_frames = 0
                self._infer_ts = _t
            if submit_ts is not None:
                sample_ms = (_t - submit_ts) * 1000.0
                self._infer_ms = sample_ms if self._infer_ms == 0.0 \
                    else 0.7 * self._infer_ms + 0.3 * sample_ms
        new_status_map = {s["id"]: s["status"] for s in result.get("slots", [])}

        # Anomaly detection (optional YOLO26 detect pass). Throttled to
        # config.ANOMALY_FPS and decoupled from INFER_FPS: the detect pass is far
        # heavier than the per-slot classify, so it runs on its own slow cadence
        # and the last result is reused between passes (mis-parking changes slowly).
        new_anomalies = []
        straddled_ids = set()
        if self._anomaly_enabled and self._yolo_detector is not None and self._roi_cache:
            _a_now = time.time()
            _a_interval = 1.0 / config.ANOMALY_FPS if config.ANOMALY_FPS > 0 else 0.0
            if not _a_interval or _a_now - self._last_anomaly_ts >= _a_interval:
                self._last_anomaly_ts = _a_now
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
                                straddled_ids.update(clf["intruded_rois"])
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
                self._last_anomalies = new_anomalies
                self._last_straddled_ids = straddled_ids
            else:
                # Between detect passes: reuse the last detection result so the
                # overlays and blocked-bay hysteresis stay stable.
                new_anomalies = self._last_anomalies
                straddled_ids = self._last_straddled_ids

        _now = time.time()
        with self._cached_status_lock:
            # Hysteresis: a slot only becomes vacant after it has shown vacant
            # continuously for VACANT_CONFIRM_SECS. Occupied transitions are
            # immediate. This prevents pedestrians or passing objects from
            # triggering false vacancy events.
            confirmed: dict = {}
            for slot_id, status in new_status_map.items():
                if status == "vacant":
                    if slot_id not in self._vacant_since:
                        self._vacant_since[slot_id] = _now
                    if _now - self._vacant_since[slot_id] >= config.VACANT_CONFIRM_SECS:
                        confirmed[slot_id] = "vacant"
                    else:
                        confirmed[slot_id] = self._cached_status_map.get(slot_id, "occupied")
                else:
                    self._vacant_since.pop(slot_id, None)
                    confirmed[slot_id] = status
            self._cached_status_map = confirmed
            self._cached_anomalies = new_anomalies
            self._overlay_dirty = True

        # Rebuild result aggregates from hysteresis-confirmed statuses so that
        # metrics, history, and heatmap all reflect the debounced state.
        patched_slots = [
            {**s, "status": confirmed.get(s["id"], s["status"])}
            for s in result.get("slots", [])
        ]
        # Bays straddled by a double-parked car are blocked → mark them
        # unavailable so they are not offered as free spots. Like the vacant
        # transition, the unavailable state is held for VACANT_CONFIRM_SECS after
        # the straddle clears, so a brief detection gap doesn't flip the bay back.
        for sid in straddled_ids:
            self._straddle_last_seen[sid] = _now
        held_unavail = {
            sid for sid, t in self._straddle_last_seen.items()
            if _now - t < config.VACANT_CONFIRM_SECS
        }
        # Drop expired entries so the dict doesn't grow unbounded.
        self._straddle_last_seen = {
            sid: t for sid, t in self._straddle_last_seen.items() if sid in held_unavail
        }
        for s in patched_slots:
            if s["id"] in held_unavail:
                s["status"] = "unavailable"
        _occ = sum(1 for s in patched_slots if s["status"] == "occupied")
        _unavail = sum(1 for s in patched_slots if s["status"] == "unavailable")
        _tot = len(patched_slots)
        patched_result = {
            **result,
            "slots":             patched_slots,
            "occupied":          _occ,
            "available":         _tot - _occ - _unavail,
            "total":             _tot,
            "occupancy_percent": round(100.0 * _occ / _tot, 1) if _tot > 0 else 0.0,
        }

        metrics = self._result_to_metrics(patched_result)
        metrics["misparked_count"] = len(new_anomalies)
        metrics["anomaly_enabled"] = self._anomaly_enabled
        ts = datetime.now(timezone.utc).isoformat()

        do_db_write = False
        with self._lock:
            self._metrics = metrics
            self._history.append({
                "timestamp": ts,
                "available": metrics["available"],
                "occupied": metrics["occupied"],
                "occupancy_percent": metrics["occupancy_percent"],
            })
            self._update_heatmap(patched_result["slots"])
            now_t = time.time()
            if now_t - self._last_db_write >= 60:
                self._last_db_write = now_t
                do_db_write = True
        if do_db_write:
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
            "infer_fps": self._infer_fps,
            "infer_ms": round(self._infer_ms, 1),
            "infer_cap": float(config.INFER_FPS),
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

    def get_frame_jpeg_and_seq(self) -> tuple:
        """Atomically returns (jpeg_bytes, frame_seq) under a single lock.
        jpeg_bytes is the raw encoded JPEG — sent directly as a binary WS frame
        (no base64), which is ~33% smaller on the wire than base64 in JSON."""
        with self._lock:
            return self._frame_jpeg, self._frame_seq

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
        return default_metrics()
