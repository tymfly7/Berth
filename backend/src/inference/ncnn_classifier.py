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
        model_dir  = config.MODEL_DIR / f"edge_{self.model_name}_ncnn_model"
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
        return arr.transpose(2, 0, 1).astype(np.float32)  # CHW float32

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
