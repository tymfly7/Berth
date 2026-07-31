"""Model management, training, evaluation, and dataset endpoints."""

import json
import logging
import threading
import time
from pathlib import Path

from fastapi import (
    APIRouter, Depends, HTTPException, Request, Response,
)

import config
from src.api.deps import limiter, verify_api_key
from src.api.operations import finish_op, register_op, update_op_progress
from src.api.routers.models import invalidate_model_info_cache
from dev.reports.model_report import build_comparison_excel

logger = logging.getLogger("berth.training")
router = APIRouter()

# ── NCNN export state (polled by the UI while a hub export runs) ─
_export_state: dict = {"status": "idle", "message": ""}


@router.post("/api/test-model/{model_name}", dependencies=[Depends(verify_api_key)])
def test_model(model_name: str):
    if model_name == "yolo26_detect":
        raise HTTPException(400, "YOLO26 detect uses a detection interface — per-patch accuracy testing is not supported.")
    if model_name not in config.TESTABLE_MODELS:
        raise HTTPException(400, f"Unknown model '{model_name}'. Testable: {list(config.TESTABLE_MODELS)}")
    try:
        # YOLO26 classify heads aren't torch nn.Modules — evaluate them via the
        # Ultralytics .val() path on the internal split instead of load_model().
        if model_name.startswith("yolo26") and model_name.endswith("_classify"):
            ckpt = config.YOLO26_CLASSIFY_PATHS[model_name[len("yolo26")]]
            if not ckpt.exists():
                raise FileNotFoundError(
                    f"No trained weights for '{model_name}' at {ckpt}. Train it first."
                )
            from dev.eval.evaluator import evaluate_yolo_classify
            metrics = evaluate_yolo_classify(ckpt)
            return {"model": model_name, **metrics}

        import torch
        from src.models.model_factory import load_model
        from dev.data_prep.preprocessor import prepare_dataset
        from dev.eval.evaluator import evaluate_model
        device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        model = load_model(model_name, device=device)
        data = prepare_dataset()
        test_loader = data["test_loader"]
        metrics = evaluate_model(model, test_loader, device=device)
        return {"model": model_name, **metrics}
    except FileNotFoundError as e:
        raise HTTPException(404, str(e))
    except Exception as e:
        raise HTTPException(500, f"Test failed: {e}")


@router.get("/api/eval/datasets", dependencies=[Depends(verify_api_key)])
def eval_datasets():
    """List datasets the operator can evaluate against: the internal split plus
    any external benchmark datasets dropped under backend/data/."""
    from dev.eval.external_datasets import list_external_datasets, STANDARD_ID
    return {
        "datasets": [
            {"id": STANDARD_ID, "label": "Standard split", "has_classifier": True, "has_detector": True},
            *list_external_datasets(),
        ]
    }


@router.post("/api/evaluate/all", dependencies=[Depends(verify_api_key)])
def evaluate_all(dataset: str = "standard"):
    if config.DEPLOYMENT_PROFILE == "edge":
        raise HTTPException(403, "Evaluation is not available on edge nodes. Use the hub server.")
    # Validate an external dataset choice up front so the operator gets a clear
    # 400 instead of a silent standard-split run.
    if dataset != "standard":
        from dev.eval.external_datasets import resolve
        if resolve(dataset) is None:
            raise HTTPException(400, f"Unknown or invalid benchmark dataset '{dataset}'.")
    from dev.train.train_manager import TrainManager
    result = TrainManager().start_evaluation(dataset=dataset)
    if result.get("status") == "error":
        raise HTTPException(400, result["message"])

    def _monitor():
        from dev.train.train_manager import TrainManager as TM
        deadline = time.time() + 6 * 3600  # safety cap so a stuck status can't leak the thread
        while time.time() < deadline:
            time.sleep(2)
            try:
                s = TM().get_status()
                if s.get("status") in ("done", "error", "idle"):
                    invalidate_model_info_cache()
                    break
            except Exception:
                break

    threading.Thread(target=_monitor, daemon=True).start()
    return result


@router.get("/api/eval/detector/datasets", dependencies=[Depends(verify_api_key)])
def eval_detector_datasets():
    """Datasets the vehicle detector can be scored against.

    Filtered to single-class vehicle datasets, so an operator cannot pick a bay
    detector dataset and get a plausible-looking number off the wrong labels.
    """
    from dev.eval.vehicle_detect_eval import list_datasets
    return {"datasets": list_datasets()}


@router.post("/api/evaluate/detector", dependencies=[Depends(verify_api_key)])
def evaluate_detector(dataset: str = "standard"):
    """Evaluate the single-class vehicle detector: baseline, conf sweep, bands.

    Separate from evaluate_all, which scores the classifiers per crop. This is
    mAP over boxes and does not feed the comparison table.
    """
    if config.DEPLOYMENT_PROFILE == "edge":
        raise HTTPException(403, "Evaluation is not available on edge nodes. Use the hub server.")
    from dev.eval.vehicle_detect_eval import resolve_dataset, run
    try:
        yaml_path, split = resolve_dataset(dataset)
        return run(yaml_path, split)
    except FileNotFoundError as e:
        raise HTTPException(404, str(e))
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        raise HTTPException(500, f"Detector evaluation failed: {e}")


@router.get("/api/evaluate/excel", dependencies=[Depends(verify_api_key)])
def download_evaluation_excel(dataset: str = "standard", file: str | None = None):
    from dev.eval import external_datasets
    if file:
        # Export a specific archived run chosen from the "Past runs" picker.
        # load_eval_snapshot validates the filename + blocks path traversal.
        from dev.eval.history_store import load_eval_snapshot
        snap = load_eval_snapshot(file)
        if snap is None:
            raise HTTPException(404, f"No evaluation snapshot '{file}'.")
        comparison = snap.get("results") or []
        stem = file[:-5] if file.endswith(".json") else file
        fname = f"model_comparison_{stem}.xlsx"
    else:
        if dataset == external_datasets.STANDARD_ID:
            comparison_path = config.OUTPUT_DIR / "model_comparison.json"
            fname = "model_comparison.xlsx"
        else:
            # Validate against the discovered datasets (same guard the POST uses)
            # so the id can't traverse out of the outputs dir via the filename.
            if external_datasets.resolve(dataset) is None:
                raise HTTPException(400, f"Unknown dataset '{dataset}'.")
            comparison_path = config.OUTPUT_DIR / f"model_comparison_{dataset}.json"
            fname = f"model_comparison_{dataset}.xlsx"
        if not comparison_path.exists():
            raise HTTPException(404, "No evaluation results found. Run 'Evaluate All' first.")
        with open(comparison_path) as f:
            comparison = json.load(f)
    xlsx_bytes = build_comparison_excel(comparison)
    return Response(
        content=xlsx_bytes,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename={fname}"},
    )


# ── Run history (timestamped snapshots of past eval / training runs) ──────────
@router.get("/api/eval/history", dependencies=[Depends(verify_api_key)])
def eval_history(dataset: str = "standard"):
    """List archived Evaluate-All runs for a dataset, newest first."""
    from dev.eval.history_store import list_eval_snapshots
    return {"snapshots": list_eval_snapshots(dataset)}


@router.get("/api/eval/history/item", dependencies=[Depends(verify_api_key)])
def eval_history_item(file: str):
    """Return one archived evaluation snapshot by filename."""
    from dev.eval.history_store import load_eval_snapshot
    snap = load_eval_snapshot(file)
    if snap is None:
        raise HTTPException(404, f"No evaluation snapshot '{file}'.")
    return snap


@router.get("/api/train/history", dependencies=[Depends(verify_api_key)])
def train_history(model: str):
    """List archived training runs for a model, newest first."""
    from dev.eval.history_store import list_train_snapshots
    return {"snapshots": list_train_snapshots(model)}


@router.get("/api/train/history/item", dependencies=[Depends(verify_api_key)])
def train_history_item(file: str):
    """Return one archived training snapshot by filename."""
    from dev.eval.history_store import load_train_snapshot
    snap = load_train_snapshot(file)
    if snap is None:
        raise HTTPException(404, f"No training snapshot '{file}'.")
    return snap


# ── NCNN export (hub only — produces the edge NCNN models) ───────────
@router.post("/api/export/ncnn", dependencies=[Depends(verify_api_key)])
def export_ncnn():
    if config.DEPLOYMENT_PROFILE == "edge":
        raise HTTPException(403, "Export is not available on edge nodes. Use the hub server.")
    if _export_state["status"] == "running":
        raise HTTPException(409, "Export already in progress")

    from dev.export.model_exporter import export_pytorch_model, export_yolo_model
    models = [
        ("cnn_scratch",      config.CNN_SCRATCH_PATH,       export_pytorch_model),
        ("resnet18",         config.RESNET18_PATH,          export_pytorch_model),
        ("resnet50",         config.RESNET50_PATH,          export_pytorch_model),
        ("mobilenetv4s",     config.MOBILENETV4S_PATH,      export_pytorch_model),
        ("mobilenetv4m",     config.MOBILENETV4M_PATH,      export_pytorch_model),
        ("yolo26n_classify", config.YOLO26N_CLASSIFY_PATH,  export_yolo_model),
        ("yolo26s_classify", config.YOLO26S_CLASSIFY_PATH,  export_yolo_model),
        ("yolo26m_classify", config.YOLO26M_CLASSIFY_PATH,  export_yolo_model),
        ("yolo26_detect",    config.YOLO26_DETECT_PATH,     export_yolo_model),
    ]

    _export_state.update(status="running", message="Starting export…")
    op_id = register_op("export", "Exporting NCNN models…")

    def _run():
        ok, skip, fail = [], [], []
        try:
            for i, (name, weights_path, fn) in enumerate(models):
                if not Path(weights_path).exists():
                    skip.append(name)
                    continue
                _export_state["message"] = f"Exporting {name}… ({i + 1}/{len(models)})"
                update_op_progress(op_id, i / len(models))
                if fn(name, weights_path):
                    ok.append(name)
                else:
                    fail.append(name)
            _export_state.update(
                status="error" if fail else "done",
                message=f"Exported {len(ok)}, skipped {len(skip)}, failed {len(fail)}"
                        + (f" ({', '.join(fail)})" if fail else ""),
            )
        except Exception as e:
            _export_state.update(status="error", message=f"Export failed: {e}")
        finally:
            invalidate_model_info_cache()  # refresh 'Deployed' badges
            finish_op(op_id)

    threading.Thread(target=_run, daemon=True).start()
    return {"message": "Export started"}


@router.get("/api/export/status", dependencies=[Depends(verify_api_key)])
def export_status():
    return _export_state


# ── Training ─────────────────────────────────────────────
@router.post("/api/train/start", dependencies=[Depends(verify_api_key)])
@limiter.limit("20/hour")
def start_training(request: Request, model_name: str = "cnn_scratch",
                   compare_all: bool = False):
    if config.DEPLOYMENT_PROFILE == "edge":
        raise HTTPException(403, "Training is not available on edge nodes. Use the hub server.")
    if model_name not in config.TRAINABLE_MODELS:
        raise HTTPException(400, f"Unknown model '{model_name}'. Choose from: {list(config.TRAINABLE_MODELS)}")
    from dev.train.train_manager import TrainManager
    mgr = TrainManager()
    if mgr.is_training():
        raise HTTPException(409, "Training already in progress")
    # Classifiers train from the classify split (built from data/labeled/<lot>/crops);
    # YOLO detect uses the exported detect dataset. Neither uses the old occupied/vacant folders.
    if model_name in config.CLASSIFY_MODELS:
        labeled = config.DATA_DIR / "labeled"
        split_ready = (config.CLASSIFY_SPLIT_DIR / "train" / "occupied").is_dir()
        if not split_ready and not (labeled.is_dir() and any(labeled.iterdir())):
            raise HTTPException(400, "No classifier dataset found. Label a lot's crops first.")
    elif model_name == "yolo26_detect" and not (config.YOLO_DATASET_DIR / "dataset.yaml").exists():
        raise HTTPException(400, "YOLO detect dataset not found. Export it first from the labeling panel.")
    invalidate_model_info_cache()  # invalidate so next poll reflects new state
    result = mgr.start_training(model_name, compare_all=compare_all)
    op_id = register_op("training", f"Training {model_name}…")

    def _monitor():
        from dev.train.train_manager import TrainManager as TM
        deadline = time.time() + 6 * 3600  # safety cap so a stuck status can't leak the thread/op
        while time.time() < deadline:
            time.sleep(2)
            try:
                s = TM().get_status()
                epoch = s.get("epoch") or 0
                total = s.get("total_epochs") or 0
                update_op_progress(op_id, epoch / total if total > 0 else 0)
                if s.get("status") in ("done", "error", "idle"):
                    invalidate_model_info_cache()
                    break
            except Exception:
                break
        finish_op(op_id)

    threading.Thread(target=_monitor, daemon=True).start()
    return result


@router.post("/api/train/cancel", dependencies=[Depends(verify_api_key)])
def cancel_training():
    from dev.train.train_manager import TrainManager
    result = TrainManager().request_cancel()
    if result.get("status") == "error":
        raise HTTPException(409, result["message"])
    return result


@router.get("/api/train/status", dependencies=[Depends(verify_api_key)])
def train_status():
    from dev.train.train_manager import TrainManager
    return TrainManager().get_status()


@router.get("/api/dataset/browse", dependencies=[Depends(verify_api_key)])
def browse_dataset():
    data_dir = config.DATA_DIR
    folders = []

    def _count(path):
        if not path.exists():
            return None
        exts = {".jpg", ".jpeg", ".png", ".bmp", ".gif", ".webp"}
        return sum(1 for f in path.iterdir() if f.is_file() and f.suffix.lower() in exts)

    for name in ("occupied", "vacant"):
        p = data_dir / name
        folders.append({"name": name, "count": _count(p), "exists": p.exists()})

    yolo_ds = config.YOLO_DATASET_DIR
    if yolo_ds.exists():
        splits = {}
        for split in ("train", "val", "test"):
            img_dir = yolo_ds / "images" / split
            splits[split] = _count(img_dir)
        folders.append({"name": "yolo_detect_dataset", "count": sum(v for v in splits.values() if v), "exists": True, "splits": splits})
    else:
        folders.append({"name": "yolo_detect_dataset", "count": None, "exists": False})

    return {"folders": folders}


@router.post("/api/dataset/prepare", dependencies=[Depends(verify_api_key)])
def prepare_dataset(source: str = None, max_per_class: int = 0,
                    generate_sample: bool = False, sample_count: int = 200):
    from dev.data_prep.downloader import organize_dataset, generate_sample_dataset
    if generate_sample:
        generate_sample_dataset(num_per_class=sample_count)
        return {"message": f"Generated {sample_count} synthetic images per class"}
    result = organize_dataset(source_root=source, max_per_class=max_per_class)
    return {"message": "Dataset prepared", **result}
