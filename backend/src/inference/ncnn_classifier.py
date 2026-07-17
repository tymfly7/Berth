"""
NCNN Edge Classifier
=====================
Drop-in replacement for ParkingClassifier on ARM64 edge nodes (e.g. Raspberry Pi 5).
Runs exported NCNN models via the ncnn Python package (XNNPACK-accelerated on Cortex-A76).

Output dict: {"status": "occupied"|"vacant"|"unknown", "confidence": float, "probability": float}

Preprocessing is identical to ParkingClassifier: resize to CNN_INPUT_SIZE, ImageNet normalisation.
"""

import logging
from pathlib import Path

import numpy as np
from PIL import Image
import ncnn

import config

logger = logging.getLogger("berth.edge_classifier")

_MEAN = np.array([0.485, 0.456, 0.406], dtype=np.float32)
_STD  = np.array([0.229, 0.224, 0.225], dtype=np.float32)


class EdgeClassifier:
    """
    Classifies parking space crops as occupied/vacant using an exported NCNN model.

    Interface mirrors ParkingClassifier: load(), predict(), predict_batch(),
    is_loaded(), model_name, threshold.
    """

    # pnnx default layer names for traced models — verify against model.ncnn.param
    _INPUT_LAYER  = "in0"
    _OUTPUT_LAYER = "out0"

    def __init__(self, model_name=None, confidence_threshold=None):
        self.model_name = model_name or config.ACTIVE_MODEL
        self.threshold  = confidence_threshold or config.CNN_CONFIDENCE_THRESHOLD
        self._net       = None

    # ── Loading ───────────────────────────────────────────────────────────────

    def load(self):
        model_dir  = config.EDGE_MODEL_DIR / f"edge_{self.model_name}_ncnn_model"
        param_path = model_dir / "model.ncnn.param"
        bin_path   = model_dir / "model.ncnn.bin"

        if not param_path.exists():
            logger.warning(
                f"Edge model not found at {model_dir}. "
                f"Run export_models.py on the hub to generate it."
            )
            return
        try:
            net = ncnn.Net()
            # Threads per inference (config.NCNN_THREADS). Keep workers × threads
            # within the core count: on a single-worker box the idle cores speed
            # each inference up; with several pool workers keep it at 1 so NCNN
            # doesn't oversubscribe the few edge cores and starve the API loop.
            net.opt.num_threads = config.NCNN_THREADS
            net.load_param(str(param_path))
            net.load_model(str(bin_path))
            self._net = net
            logger.info(f"NCNN model loaded: {model_dir}")
        except Exception as exc:
            logger.error(f"Edge classifier load failed: {exc}")
            self._net = None

    def is_loaded(self) -> bool:
        return self._net is not None

    # ── Preprocessing ─────────────────────────────────────────────────────────

    @staticmethod
    def _to_pil(image) -> Image.Image:
        if isinstance(image, (str, Path)):
            return Image.open(image).convert("RGB")
        if isinstance(image, np.ndarray):
            if image.shape[-1] == 3:
                return Image.fromarray(image[:, :, ::-1])  # BGR → RGB
            return Image.fromarray(image)
        return image

    def _preprocess(self, image) -> np.ndarray:
        pil = self._to_pil(image).resize(
            (config.CNN_INPUT_SIZE, config.CNN_INPUT_SIZE), Image.BILINEAR
        )
        arr = np.array(pil, dtype=np.float32) / 255.0
        arr = (arr - _MEAN) / _STD
        # ascontiguousarray is required: transpose returns a non-contiguous view,
        # and ncnn.Mat reads it with scrambled strides → corrupted input.
        return np.ascontiguousarray(arr.transpose(2, 0, 1), dtype=np.float32)  # CHW float32

    # ── Inference ─────────────────────────────────────────────────────────────

    def predict(self, image) -> dict:
        if not self.is_loaded():
            return {"status": "unknown", "confidence": 0.0, "probability": 0.5}
        return self._logit_to_dict(self._run(self._preprocess(image)))

    def predict_batch(self, images) -> list:
        if not self.is_loaded():
            return [{"status": "unknown", "confidence": 0.0, "probability": 0.5}
                    for _ in images]
        return [self._logit_to_dict(self._run(self._preprocess(img))) for img in images]

    def _run(self, arr: np.ndarray) -> float:
        ex = self._net.create_extractor()
        ex.input(self._INPUT_LAYER, ncnn.Mat(arr))
        _, out = ex.extract(self._OUTPUT_LAYER)
        return float(np.array(out).flat[0])

    def _logit_to_dict(self, logit: float) -> dict:
        prob = float(1.0 / (1.0 + np.exp(-logit)))
        if prob > 0.5:
            status, confidence = "occupied", prob
        else:
            status, confidence = "vacant", 1.0 - prob

        if confidence < self.threshold:
            return {"status": "unknown",
                    "confidence": round(confidence, 4),
                    "probability": round(prob, 4)}
        return {"status": status,
                "confidence": round(confidence, 4),
                "probability": round(prob, 4)}


class EdgeYoloClassifier:
    """
    Torch-free NCNN replacement for the YOLO26 classify head on edge nodes.

    Mirrors the Ultralytics classify path in ParkingClassifier (letterbox-to-square
    then resize to YOLO_CLASSIFY_IMG_SIZE) but runs the exported NCNN model directly,
    so the edge image needs neither torch nor ultralytics.

    Interface mirrors ParkingClassifier: load(), predict(), predict_batch(),
    is_loaded(), model_name, threshold.
    """

    _INPUT_LAYER  = "in0"
    _OUTPUT_LAYER = "out0"

    def __init__(self, model_name=None, confidence_threshold=None):
        self.model_name = model_name or config.ACTIVE_MODEL
        self.threshold  = confidence_threshold or config.CNN_CONFIDENCE_THRESHOLD
        self._net       = None

    # ── Loading ───────────────────────────────────────────────────────────────

    def load(self):
        # model_name is one of yolo26{n,s,m}_classify — the char after "yolo26"
        # is the scale that selects the per-scale NCNN export.
        scale = self.model_name[len("yolo26")] if self.model_name.startswith("yolo26") else "s"
        model_dir  = config.YOLO26_CLASSIFY_NCNN_PATHS.get(scale)
        if model_dir is None:
            logger.warning(f"Unknown YOLO classify model '{self.model_name}' — no NCNN export mapping.")
            return
        param_path = model_dir / "model.ncnn.param"
        bin_path   = model_dir / "model.ncnn.bin"

        if not param_path.exists():
            logger.warning(
                f"Edge YOLO classify model not found at {model_dir}. "
                f"Export it on the hub first."
            )
            return
        try:
            net = ncnn.Net()
            net.opt.num_threads = config.NCNN_THREADS
            net.load_param(str(param_path))
            net.load_model(str(bin_path))
            self._net = net
            logger.info(f"NCNN YOLO classify model loaded: {model_dir}")
        except Exception as exc:
            logger.error(f"Edge YOLO classifier load failed: {exc}")
            self._net = None

    def is_loaded(self) -> bool:
        return self._net is not None

    # ── Preprocessing ─────────────────────────────────────────────────────────

    @staticmethod
    def _letterbox_square(pil_img: Image.Image) -> Image.Image:
        """Pad to a square with neutral gray (114) so the resize doesn't squash
        non-square crops — matches ParkingClassifier._letterbox_square."""
        w, h = pil_img.size
        if w == h:
            return pil_img
        side = max(w, h)
        canvas = Image.new("RGB", (side, side), (114, 114, 114))
        canvas.paste(pil_img, ((side - w) // 2, (side - h) // 2))
        return canvas

    def _preprocess(self, image) -> np.ndarray:
        pil = self._letterbox_square(EdgeClassifier._to_pil(image)).resize(
            (config.YOLO_CLASSIFY_IMG_SIZE, config.YOLO_CLASSIFY_IMG_SIZE), Image.BILINEAR
        )
        # Ultralytics classify normalisation is /255 only (no ImageNet mean/std).
        arr = np.array(pil, dtype=np.float32) / 255.0
        return np.ascontiguousarray(arr.transpose(2, 0, 1), dtype=np.float32)  # CHW float32

    # ── Inference ─────────────────────────────────────────────────────────────

    def predict(self, image) -> dict:
        if not self.is_loaded():
            return {"status": "unknown", "confidence": 0.0, "probability": 0.5}
        return self._probs_to_dict(self._run(self._preprocess(image)))

    def predict_batch(self, images) -> list:
        if not self.is_loaded():
            return [{"status": "unknown", "confidence": 0.0, "probability": 0.5}
                    for _ in images]
        return [self._probs_to_dict(self._run(self._preprocess(img))) for img in images]

    def _run(self, arr: np.ndarray) -> np.ndarray:
        ex = self._net.create_extractor()
        ex.input(self._INPUT_LAYER, ncnn.Mat(arr))
        _, out = ex.extract(self._OUTPUT_LAYER)
        return np.array(out).flatten()  # softmaxed 2-vector [P(occupied), P(vacant)]

    def _probs_to_dict(self, probs: np.ndarray) -> dict:
        # Class 0 = occupied, Class 1 = vacant (alphabetical folder order).
        prob_occupied = float(probs[0]) if probs.size > 0 else 0.5
        # Bias toward "occupied" via the sub-0.5 OCCUPANCY_THRESHOLD, matching
        # ParkingClassifier._yolo_result_to_dict.
        if prob_occupied > config.OCCUPANCY_THRESHOLD:
            return {"status": "occupied",
                    "confidence": round(prob_occupied, 4),
                    "probability": round(prob_occupied, 4)}
        return {"status": "vacant",
                "confidence": round(1.0 - prob_occupied, 4),
                "probability": round(prob_occupied, 4)}
