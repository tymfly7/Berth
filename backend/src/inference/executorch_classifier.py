"""
ExecuTorch / ONNX Edge Classifier
===================================
Drop-in replacement for ParkingClassifier on ARM64 edge nodes (e.g. Raspberry Pi 5).

Runtime selection (automatic, no config needed):
  1. ExecuTorch (.pte)  — preferred; native PyTorch, XNNPACK-optimised for Cortex-A76
  2. ONNX Runtime (.onnx) — fallback when `executorch` wheel is unavailable

Both runtimes produce identical output dicts:
  {"status": "occupied"|"vacant"|"unknown", "confidence": float, "probability": float}

The preprocessing pipeline is identical to ParkingClassifier so inference parity
is guaranteed: resize to CNN_INPUT_SIZE px, ImageNet normalisation.
"""

import logging
from pathlib import Path

import numpy as np
from PIL import Image

import config

logger = logging.getLogger("berth.edge_classifier")

# Detect which runtime is available once at import time.
try:
    from executorch.runtime import Runtime as _ETRuntime
    _BACKEND = "executorch"
except ImportError:
    try:
        import onnxruntime as _ort
        _BACKEND = "onnx"
    except ImportError:
        _BACKEND = "none"

logger.info(f"Edge classifier backend: {_BACKEND}")

# ImageNet normalisation constants (same as ParkingClassifier).
_MEAN = np.array([0.485, 0.456, 0.406], dtype=np.float32)
_STD  = np.array([0.229, 0.224, 0.225], dtype=np.float32)

_EDGE_MODEL_NAMES = {"cnn_scratch", "resnet50", "mobilenetv4s"}


class ExecuTorchClassifier:
    """
    Classifies parking space crops as occupied/vacant using a serialised
    ExecuTorch (.pte) or ONNX (.onnx) model.

    Interface mirrors ParkingClassifier: load(), predict(), predict_batch(),
    is_loaded(), model_name, threshold.
    """

    def __init__(self, model_name=None, confidence_threshold=None):
        self.model_name = model_name or config.ACTIVE_MODEL
        self.threshold  = confidence_threshold or config.CNN_CONFIDENCE_THRESHOLD
        self._session   = None   # onnxruntime.InferenceSession  or  executorch Method
        self._backend   = _BACKEND
        self._input_name = "input"  # ONNX input tensor name

    # ── Loading ───────────────────────────────────────────────────────────────

    def load(self):
        """Locate and load the exported model file (.pte or .onnx)."""
        model_path = self._resolve_model_path()
        if model_path is None:
            logger.warning(
                f"Edge model not found for '{self.model_name}'. "
                "Run training on the hub to generate edge_{model_name}.pte/.onnx"
            )
            return

        suffix = model_path.suffix.lower()
        try:
            if suffix == ".pte":
                self._load_executorch(model_path)
            elif suffix == ".onnx":
                self._load_onnx(model_path)
            else:
                logger.warning(f"Unsupported edge model format: {suffix}")
        except Exception as exc:
            logger.error(f"Edge classifier load failed: {exc}")
            self._session = None

    def _resolve_model_path(self) -> Path | None:
        """Return the first existing .pte or .onnx file for this model_name."""
        for ext in (".pte", ".onnx"):
            candidate = config.MODEL_DIR / f"edge_{self.model_name}{ext}"
            if candidate.exists():
                return candidate
        return None

    def _load_executorch(self, path: Path):
        if _BACKEND != "executorch":
            raise RuntimeError("executorch package not installed")
        from executorch.runtime import Runtime
        runtime = Runtime.get()
        self._session = runtime.load_program(
            path.read_bytes(),
            verification=Runtime.Verification.Minimal,
        )
        self._backend = "executorch"
        logger.info(f"ExecuTorch model loaded: {path}")

    def _load_onnx(self, path: Path):
        import onnxruntime as ort
        opts = ort.SessionOptions()
        opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        # XNNPACK accelerates Cortex-A76 (RPi5) automatically.
        providers = ["CPUExecutionProvider"]
        self._session = ort.InferenceSession(str(path), sess_options=opts, providers=providers)
        self._input_name = self._session.get_inputs()[0].name
        self._backend = "onnx"
        logger.info(f"ONNX Runtime model loaded: {path}")

    def is_loaded(self) -> bool:
        return self._session is not None

    # ── Preprocessing ─────────────────────────────────────────────────────────

    @staticmethod
    def _to_pil(image) -> Image.Image:
        if isinstance(image, (str, Path)):
            return Image.open(image).convert("RGB")
        if isinstance(image, np.ndarray):
            if image.shape[-1] == 3:
                return Image.fromarray(image[:, :, ::-1])  # BGR → RGB
            return Image.fromarray(image)
        return image  # already PIL

    def _preprocess(self, image) -> np.ndarray:
        """Return a (1, 3, H, W) float32 array ready for inference."""
        pil = self._to_pil(image).resize(
            (config.CNN_INPUT_SIZE, config.CNN_INPUT_SIZE), Image.BILINEAR
        )
        arr = np.array(pil, dtype=np.float32) / 255.0          # (H, W, 3)
        arr = (arr - _MEAN) / _STD
        return arr.transpose(2, 0, 1)[np.newaxis]               # (1, 3, H, W)

    def _preprocess_batch(self, images) -> np.ndarray:
        return np.concatenate([self._preprocess(img) for img in images], axis=0)

    # ── Inference ─────────────────────────────────────────────────────────────

    def predict(self, image) -> dict:
        """Classify a single parking space crop."""
        if not self.is_loaded():
            return {"status": "unknown", "confidence": 0.0, "probability": 0.5}
        tensor = self._preprocess(image)
        logit  = self._run(tensor)[0]
        return self._logit_to_dict(float(logit))

    def predict_batch(self, images) -> list:
        """Classify a batch of parking space crops."""
        if not self.is_loaded():
            return [{"status": "unknown", "confidence": 0.0, "probability": 0.5}
                    for _ in images]
        batch  = self._preprocess_batch(images)
        logits = self._run(batch)
        return [self._logit_to_dict(float(l)) for l in logits]

    def _run(self, tensor: np.ndarray) -> np.ndarray:
        """Run forward pass; return 1-D array of raw logits (one per sample)."""
        if self._backend == "onnx":
            out = self._session.run(None, {self._input_name: tensor})
            logits = out[0].squeeze(-1)  # (batch,) after squeezing output dim
        else:
            # ExecuTorch: run the "forward" method
            method = self._session.load_method("forward")
            from executorch.runtime import Tensor as ETTensor
            et_input = ETTensor(tensor)
            out = method.execute([et_input])
            logits = np.array(out[0].tolist()).squeeze(-1)
        return np.atleast_1d(logits)

    def _logit_to_dict(self, logit: float) -> dict:
        prob = float(1.0 / (1.0 + np.exp(-logit)))  # sigmoid
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
