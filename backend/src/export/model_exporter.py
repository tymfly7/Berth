"""
Edge Model Exporter
====================
Exports trained PyTorch weights to on-device formats for RPi5 / ARM64 edge nodes.

Primary target : ExecuTorch (.pte) — native PyTorch, XNNPACK-optimised for ARM64.
Automatic fallback : ONNX (.onnx) when the `executorch` package is not available
                     (e.g. during development on x86 before cross-compiling for RPi5).

Exported files land beside the original .pth weights in config.MODEL_DIR.

Usage (called automatically by train_manager after a successful run):
    from src.export.model_exporter import export_pytorch_model, export_yolo_model
    export_pytorch_model("mobilenetv4s", config.MOBILENETV4_PATH)
    export_yolo_model("yolo26_classify", config.YOLO26_CLASSIFY_PATH)
"""

import logging
from pathlib import Path

import torch
import numpy as np

import config

logger = logging.getLogger("berth.exporter")

# Input shape expected by all classification CNNs after preprocessing.
_EXAMPLE_INPUT = torch.zeros(1, 3, config.CNN_INPUT_SIZE, config.CNN_INPUT_SIZE)

_PYTORCH_MODELS = {"cnn_scratch", "resnet50", "mobilenetv4s"}


def export_pytorch_model(model_name: str, weights_path: Path) -> Path:
    """
    Export a trained PyTorch classification model to ExecuTorch (.pte) or ONNX (.onnx).

    Returns the path to the exported file, or None if export failed.
    The source .pth weights file is left untouched.
    """
    if model_name not in _PYTORCH_MODELS:
        logger.debug(f"export_pytorch_model: skipping non-CNN model '{model_name}'")
        return None

    if not Path(weights_path).exists():
        logger.warning(f"Exporter: weights not found at {weights_path} — skipping export")
        return None

    # Try ExecuTorch first; fall back to ONNX if unavailable.
    try:
        return _export_executorch(model_name, weights_path)
    except ImportError:
        logger.info("executorch not installed — falling back to ONNX export")
        return _export_onnx(model_name, weights_path)
    except Exception as exc:
        logger.warning(f"ExecuTorch export failed ({exc}) — falling back to ONNX")
        return _export_onnx(model_name, weights_path)


def export_yolo_model(model_name: str, weights_path: Path) -> Path:
    """
    Export a YOLO model to ExecuTorch (.pte) or ONNX (.onnx) via Ultralytics.

    Returns the path to the exported file, or None if export failed.
    """
    if not Path(weights_path).exists():
        logger.warning(f"Exporter: YOLO weights not found at {weights_path} — skipping")
        return None

    try:
        from ultralytics import YOLO
        model = YOLO(str(weights_path))

        # Try ExecuTorch format; fall back to ONNX.
        try:
            import executorch  # noqa: F401 — presence check only
            out = model.export(format="executorch", imgsz=config.YOLO_CLASSIFY_IMG_SIZE)
            out_path = Path(str(weights_path).replace(".pt", ".pte"))
            logger.info(f"YOLO ExecuTorch export: {out_path}")
            return out_path
        except (ImportError, Exception) as exc:
            logger.info(f"YOLO ExecuTorch export skipped ({exc}) — trying ONNX")

        out = model.export(format="onnx")
        out_path = Path(str(weights_path).replace(".pt", ".onnx"))
        logger.info(f"YOLO ONNX export: {out_path}")
        return out_path

    except Exception as exc:
        logger.warning(f"YOLO export failed for {weights_path}: {exc}")
        return None


# ── Internal helpers ──────────────────────────────────────────────────────────

def _load_model_for_export(model_name: str, weights_path: Path):
    """Load model in eval mode on CPU, ready for tracing."""
    from src.models.model_factory import load_model
    model = load_model(model_name, device=torch.device("cpu"))
    model.eval()
    return model


def _export_executorch(model_name: str, weights_path: Path) -> Path:
    """Export to ExecuTorch .pte using XNNPACK delegate (ARM64 optimised)."""
    from torch.export import export as torch_export
    from executorch.exir import to_edge, EdgeCompileConfig
    from executorch.backends.xnnpack.partition.xnnpack_partitioner import XnnpackPartitioner

    model = _load_model_for_export(model_name, weights_path)
    example = (_EXAMPLE_INPUT,)

    ep = torch_export(model, example)
    edge_prog = to_edge(
        ep,
        compile_config=EdgeCompileConfig(_check_ir_validity=False),
    )
    exec_prog = edge_prog.to_backend([XnnpackPartitioner()]).to_executorch()

    out_path = config.MODEL_DIR / f"edge_{model_name}.pte"
    with open(out_path, "wb") as fh:
        fh.write(exec_prog.buffer)

    logger.info(f"ExecuTorch export: {out_path} ({out_path.stat().st_size // 1024} KB)")
    return out_path


def _export_onnx(model_name: str, weights_path: Path) -> Path:
    """Export to ONNX — fallback when ExecuTorch is unavailable."""
    model = _load_model_for_export(model_name, weights_path)
    out_path = config.MODEL_DIR / f"edge_{model_name}.onnx"

    torch.onnx.export(
        model,
        _EXAMPLE_INPUT,
        str(out_path),
        opset_version=17,
        input_names=["input"],
        output_names=["logit"],
        dynamic_axes={"input": {0: "batch"}, "logit": {0: "batch"}},
    )

    logger.info(f"ONNX export: {out_path} ({out_path.stat().st_size // 1024} KB)")
    return out_path
