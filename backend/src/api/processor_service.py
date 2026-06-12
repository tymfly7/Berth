"""
ProcessorService — single owner of runtime inference state
==========================================================
Owns the lazily-loaded VideoProcessor, the active-model selection, the
per-model classifier cache, and the anomaly-detection settings.

These previously lived as module-level globals in main.py guarded by ad-hoc
locks. Centralising them here makes the lifecycle explicit and lets the API
routers share one source of truth instead of reaching into main's namespace.
A single module-level instance (``processor_service``) is used app-wide.
"""

import logging
import threading

import config
from src.inference.video_processor import VideoProcessor

logger = logging.getLogger("berth.processor")


class ProcessorService:
    def __init__(self) -> None:
        self._processor = None
        self._processor_lock = threading.Lock()
        self.active_mode = config.ACTIVE_MODEL
        self.anomaly_enabled = False
        # min fraction of a car inside its best bay to count as parked
        self.anomaly_park_thresh = 0.60
        self._clf_cache: dict = {}
        self._clf_lock = threading.Lock()

    # ── Classifier cache — one loaded instance per model name ─────────────
    def get_classifier(self, model_name: str):
        # 'yolo26' and 'yolo26_classify' load the same weights — share one
        # cached instance so the model isn't held in memory twice.
        cache_key = "yolo26_classify" if model_name in ("yolo26", "yolo26_classify") else model_name
        with self._clf_lock:
            if cache_key not in self._clf_cache:
                from src.inference.classifier import get_classifier
                clf = get_classifier(model_name=cache_key)
                clf.load()
                if not clf.is_loaded():
                    raise Exception(f"Model '{model_name}' failed to load")
                self._clf_cache[cache_key] = clf
            return self._clf_cache[cache_key]

    def clear_classifier_cache(self) -> None:
        with self._clf_lock:
            self._clf_cache.clear()

    # ── Processor lifecycle (lazy, thread-safe) ───────────────────────────
    def get_processor(self):
        with self._processor_lock:
            if self._processor is None:
                try:
                    self._processor = VideoProcessor(model_name=self.active_mode or None)
                    logger.info(f"VideoProcessor initialised (model={self.active_mode or 'none'})")
                except Exception as e:
                    logger.error(f"VideoProcessor failed to initialise: {e}")
                    raise
            return self._processor

    def reset_processor(self) -> None:
        with self._processor_lock:
            if self._processor is not None:
                try:
                    self._processor.stop_processing()
                except Exception:
                    pass
            self._processor = None
        self.clear_classifier_cache()

    # ── Model resolution ──────────────────────────────────────────────────
    def resolve_model_name(self):
        """Resolve active model name for single-image prediction."""
        if self.active_mode in config.SUPPORTED_MODELS:
            return self.active_mode
        for name, path in [
            ("yolo26_classify", config.YOLO26_CLASSIFY_PATH),
            ("cnn_scratch", config.CNN_SCRATCH_PATH),
            ("resnet50", config.RESNET50_PATH),
            ("mobilenetv4s", config.MOBILENETV4_PATH),
        ]:
            if path.exists():
                return name
        return None


# App-wide singleton.
processor_service = ProcessorService()
