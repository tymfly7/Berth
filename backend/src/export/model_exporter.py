"""
Edge Model Exporter
====================
Exports trained models to NCNN for RPi5 / ARM64 edge nodes.
NCNN uses the XNNPACK/Vulkan backend on Cortex-A76 — faster than ONNX runtime.

CNN models:  torch.jit.trace → pnnx → edge_{model_name}_ncnn_model/
YOLO models: Ultralytics export → {weights_stem}_ncnn_model/

Usage (called automatically by train_manager after a successful run):
    from src.export.model_exporter import export_pytorch_model, export_yolo_model
    export_pytorch_model("mobilenetv4s", config.MOBILENETV4_PATH)
    export_yolo_model("yolo26_classify", config.YOLO26_CLASSIFY_PATH)
"""

import logging
import shutil
import subprocess
import sys
from pathlib import Path

import torch

import config

logger = logging.getLogger("berth.exporter")

_EXAMPLE_INPUT = torch.zeros(1, 3, config.CNN_INPUT_SIZE, config.CNN_INPUT_SIZE)

_PYTORCH_MODELS = {"cnn_scratch", "resnet50", "mobilenetv4s"}


def export_pytorch_model(model_name: str, weights_path: Path) -> Path:
    """
    Export a trained PyTorch classification model to NCNN via pnnx.

    Returns the path to the exported ncnn model directory, or None if export failed.
    The source .pth weights file is left untouched.
    """
    if model_name not in _PYTORCH_MODELS:
        logger.debug(f"export_pytorch_model: skipping non-CNN model '{model_name}'")
        return None

    if not Path(weights_path).exists():
        logger.warning(f"Exporter: weights not found at {weights_path} — skipping export")
        return None

    return _export_ncnn(model_name, weights_path)


def export_yolo_model(model_name: str, weights_path: Path) -> Path:
    """
    Export a YOLO model to NCNN via Ultralytics (fastest format on RPi5/ARM64).

    Returns the path to the exported ncnn model directory, or None if export failed.
    """
    if not Path(weights_path).exists():
        logger.warning(f"Exporter: YOLO weights not found at {weights_path} — skipping")
        return None

    try:
        from ultralytics import YOLO
        model = YOLO(str(weights_path))
        out = model.export(format="ncnn")
        out_path = Path(out) if out else Path(str(weights_path).replace(".pt", "_ncnn_model"))
        logger.info(f"YOLO NCNN export: {out_path}")
        return out_path

    except Exception as exc:
        logger.warning(f"YOLO NCNN export failed for {weights_path}: {exc}")
        return None


# ── Internal helpers ──────────────────────────────────────────────────────────

def _load_model_for_export(model_name: str, weights_path: Path):
    """Load model in eval mode on CPU, ready for tracing."""
    from src.models.model_factory import load_model
    model = load_model(model_name, device=torch.device("cpu"))
    model.eval()
    return model


def _export_ncnn(model_name: str, weights_path: Path) -> Path:
    """Export to NCNN via torch.jit.trace + pnnx (fastest format on RPi5/ARM64)."""
    pnnx_bin = Path(sys.executable).parent / "pnnx.exe"
    if not pnnx_bin.exists():
        pnnx_bin = shutil.which("pnnx")
    if not pnnx_bin:
        logger.warning("pnnx not found — install with: pip install pnnx")
        return None

    model = _load_model_for_export(model_name, weights_path)
    out_dir = config.MODEL_DIR / f"edge_{model_name}_ncnn_model"
    out_dir.mkdir(exist_ok=True)

    tmp_pt = out_dir / "model.pt"
    try:
        traced = torch.jit.trace(model, _EXAMPLE_INPUT)
        traced.save(str(tmp_pt))

        s = config.CNN_INPUT_SIZE
        subprocess.run(
            [str(pnnx_bin), str(tmp_pt), f"inputshape=[1,3,{s},{s}]f32"],
            check=True,
            cwd=str(out_dir),
        )

        logger.info(f"NCNN export: {out_dir}")
        return out_dir

    except Exception as exc:
        logger.warning(f"NCNN export failed for {model_name}: {exc}")
        return None

    finally:
        for name in ("model.pt", "model.pnnx.param", "model.pnnx.bin",
                     "model_pnnx.py", "model.pnnx.onnx", "model_ncnn.py"):
            (out_dir / name).unlink(missing_ok=True)
