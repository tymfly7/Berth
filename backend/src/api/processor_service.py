"""
ProcessorService — single owner of runtime inference state
==========================================================
Owns the active-model selection, the per-model classifier cache (used by the
single-image /predict and /analyze-* endpoints), and the anomaly-detection
settings that newly activated cameras inherit.

Live video is owned exclusively by ``camera_registry`` — each camera runs its
own VideoProcessor there. This service holds no processor of its own.
A single module-level instance (``processor_service``) is used app-wide.
"""

import logging
import threading

import config

logger = logging.getLogger("berth.processor")


class ProcessorService:
    def __init__(self) -> None:
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
