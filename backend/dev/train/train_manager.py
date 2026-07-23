"""
Training Manager — Background Training & Model Comparison
============================================================
Manages training as a background process so the API remains responsive.
Supports training individual models or running a full comparison
across all architectures (CNN scratch, ResNet50, MobileNetV4).
"""

import sys
import json
import logging
import threading
import time
from pathlib import Path
from src.db import database as db
import matplotlib
import matplotlib.pyplot as plt
import numpy as np
import config
from src.models.model_factory import create_model, list_available_models
from dev.train.trainer import Trainer, TrainingCancelled
from dev.data_prep.preprocessor import prepare_dataset
from dev.eval.evaluator import evaluate_model

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))
logger = logging.getLogger("berth.train_manager")

# Singleton state — shared across API requests
_state = {
    "status": "idle",       # idle | training | done | error | cancelled
    "cancel_requested": False,
    "message": "",
    "model_name": "",
    "epoch": 0,
    "total_epochs": 0,
    "train_loss": 0.0,
    "val_loss": 0.0,
    "train_acc": 0.0,
    "val_acc": 0.0,
    "best_val_acc": 0.0,
    "lr": 0.0,
    "elapsed": 0.0,
    "results": None,
    "comparison": None,
}
_lock = threading.Lock()


class TrainManager:
    """
    Manages background training and exposes status for the API.

    Usage:
        manager = TrainManager()
        manager.start_training("cnn_scratch")
        status = manager.get_status()
    """

    def is_training(self):
        return _state["status"] == "training"

    def get_status(self):
        with _lock:
            return dict(_state)

    def _should_cancel(self):
        with _lock:
            return _state["cancel_requested"]

    def request_cancel(self):
        """Request that the in-progress training stop at the next checkpoint."""
        with _lock:
            if _state["status"] != "training":
                return {"status": "error", "message": "No training in progress"}
            _state["cancel_requested"] = True
            _state["message"] = "Cancelling…"
        return {"status": "cancelling", "message": "Cancellation requested"}

    def start_training(self, model_name="cnn_scratch", compare_all=False):
        """
        Start training in a background thread.

        Args:
            model_name (str): Model to train — one of cnn_scratch, resnet50,
                              mobilenetv4, yolo26_classify, yolo26_detect
            compare_all (bool): If True, train all CNN/transfer models and compare

        Returns:
            dict: Initial status
        """
        if self.is_training():
            return {"status": "error", "message": "Training already in progress"}

        with _lock:
            _state["status"] = "training"
            _state["cancel_requested"] = False
            _state["message"] = f"Starting {'comparison' if compare_all else model_name}..."
            _state["model_name"] = model_name
            _state["epoch"] = 0
            _state["results"] = None
            _state["comparison"] = None

        if compare_all:
            thread = threading.Thread(target=self._compare_all, daemon=True)
        elif model_name in ("yolo26n_classify", "yolo26s_classify", "yolo26m_classify"):
            scale = model_name[len("yolo26")]  # 'n' | 's' | 'm'
            thread = threading.Thread(target=self._train_yolo26_classify, args=(scale,), daemon=True)
        elif model_name == "yolo26_detect":
            thread = threading.Thread(target=self._train_yolo26_detect, daemon=True)
        else:
            thread = threading.Thread(target=self._train_model, args=(model_name,), daemon=True)
        thread.start()

        return {"status": "training", "message": _state["message"]}

    def _train_model(self, model_name):
        """Train a single model (runs in background thread)."""
        run_id = None
        try:
            start_time = time.time()

            # Prepare data
            with _lock:
                _state["message"] = "Preparing dataset..."
            data = prepare_dataset()
            dataset_size = len(data.get("train_loader", {}).dataset) if hasattr(data.get("train_loader"), "dataset") else 0
            try:
                run_id = db.start_training_run(model_name, dataset_size)
            except Exception:
                pass

            # Create model
            with _lock:
                _state["message"] = f"Creating {model_name} model..."
                _state["total_epochs"] = config.EPOCHS

            model = create_model(model_name)

            # Create trainer
            trainer = Trainer(model=model, model_name=model_name)

            # Progress callback
            def on_progress(epoch, metrics):
                with _lock:
                    _state["epoch"] = epoch
                    _state["train_loss"] = round(metrics["train_loss"], 4)
                    _state["val_loss"] = round(metrics["val_loss"], 4)
                    _state["train_acc"] = round(metrics["train_acc"], 2)
                    _state["val_acc"] = round(metrics["val_acc"], 2)
                    _state["best_val_acc"] = round(metrics["best_val_acc"], 2)
                    _state["lr"] = metrics["lr"]
                    _state["elapsed"] = round(time.time() - start_time, 1)
                    _state["message"] = (
                        f"Epoch {epoch}/{config.EPOCHS} — "
                        f"Val Acc: {metrics['val_acc']:.2f}%"
                    )

            def on_batch(epoch, batch_idx, total_batches):
                with _lock:
                    _state["elapsed"] = round(time.time() - start_time, 1)
                    _state["message"] = (
                        f"Epoch {epoch}/{config.EPOCHS} — "
                        f"batch {batch_idx}/{total_batches}"
                    )

            # Train
            results = trainer.train(
                data["train_loader"],
                data["val_loader"],
                progress_callback=on_progress,
                batch_callback=on_batch,
                should_cancel=self._should_cancel,
            )

            with _lock:
                _state["status"] = "done"
                _state["message"] = (
                    f"Training complete! Best val accuracy: {results['best_val_acc']:.2f}%"
                )
                _state["results"] = results

            if run_id:
                try:
                    db.finish_training_run(run_id, "success",
                                           final_accuracy=results.get("best_val_acc"),
                                           epochs=results.get("epochs"))
                except Exception:
                    pass

            # Export to ONNX for edge inference — non-fatal
            try:
                from dev.export.model_exporter import export_pytorch_model
                weights_map = {
                    "cnn_scratch":  config.CNN_SCRATCH_PATH,
                    "resnet18":     config.RESNET18_PATH,
                    "resnet50":     config.RESNET50_PATH,
                    "mobilenetv4s": config.MOBILENETV4S_PATH,
                    "mobilenetv4m": config.MOBILENETV4M_PATH,
                }
                if model_name in weights_map:
                    export_pytorch_model(model_name, weights_map[model_name])
            except Exception as _exp_err:
                logger.warning(f"Edge export skipped: {_exp_err}")

            logger.info(f"✅ Training complete: {model_name}")

        except TrainingCancelled:
            logger.info(f"⏹️ Training cancelled: {model_name}")
            with _lock:
                _state["status"] = "cancelled"
                _state["message"] = "Training cancelled by user."
            if run_id:
                try:
                    db.finish_training_run(run_id, "cancelled")
                except Exception:
                    pass
        except Exception as e:
            logger.exception(f"❌ Training failed: {e}")
            with _lock:
                _state["status"] = "error"
                _state["message"] = f"Training failed: {str(e)}"
            if run_id:
                try:
                    db.finish_training_run(run_id, "failed")
                except Exception:
                    pass

    def _train_yolo26_classify(self, scale="s"):
        """
        Train a YOLO26 classify model at the given scale ('n'|'s'|'m') on the
        occupied/vacant crops. Uses Ultralytics Python API — no CLI required.
        Fine-tunes the ImageNet-pretrained yolo26{scale}-cls.pt checkpoint (first
        run downloads it). Output: config.YOLO26_CLASSIFY_PATHS[scale].
        """
        model_name = f"yolo26{scale}_classify"
        run_dir    = config.OUTPUT_DIR / model_name
        run_id = None
        try:
            from ultralytics import YOLO
            from dev.data_prep.preprocessor import build_classify_split, build_classify_subset

            _classify_start = time.time()
            _batch_count = [0]

            with _lock:
                _state["message"] = "Building classifier train/val/test split..."
                _state["total_epochs"] = config.YOLO_CLASSIFY_EPOCHS

            build_classify_split()                       # idempotent; full split for the PyTorch classifiers
            classify_data_dir = build_classify_subset()  # capped & class-balanced — matches the CNN classifiers' ~500-batch volume

            with _lock:
                _state["message"] = f"Starting {model_name} training..."

            try:
                run_id = db.start_training_run(model_name)
            except Exception:
                pass
            model = YOLO(f"yolo26{scale}-cls.pt")  # ImageNet-pretrained; downloaded on first use

            def on_batch_end(trainer):
                if self._should_cancel():
                    trainer.stop = True
                    return
                _batch_count[0] += 1
                if _batch_count[0] % 50 != 0:
                    return
                try:
                    loss_val = float(trainer.loss.item())
                except Exception:
                    loss_val = 0.0
                with _lock:
                    _state["elapsed"] = round(time.time() - _classify_start, 1)
                    _state["message"] = (
                        f"Epoch {trainer.epoch + 1}/{config.YOLO_CLASSIFY_EPOCHS} — "
                        f"batch {_batch_count[0]} — loss: {loss_val:.4f}"
                    )

            def on_epoch_end(trainer):
                if self._should_cancel():
                    trainer.stop = True
                    return
                _batch_count[0] = 0   # reset so the UI batch count is per-epoch, matching Ultralytics' bar
                epoch   = trainer.epoch + 1
                metrics = trainer.metrics or {}
                with _lock:
                    _state["epoch"]   = epoch
                    _state["val_acc"] = round(float(metrics.get("metrics/accuracy_top1", 0)) * 100, 2)
                    _state["elapsed"] = round(time.time() - _classify_start, 1)
                    _state["message"] = (
                        f"Epoch {epoch}/{config.YOLO_CLASSIFY_EPOCHS} — "
                        f"Top-1 Acc: {_state['val_acc']:.2f}%"
                    )

            model.add_callback("on_train_batch_end", on_batch_end)
            model.add_callback("on_train_epoch_end", on_epoch_end)

            model.train(
                data=str(classify_data_dir),           # pre-built subset: only occupied/ + vacant/
                task="classify",
                epochs=config.YOLO_CLASSIFY_EPOCHS,
                batch=config.BATCH_SIZE,
                imgsz=config.YOLO_CLASSIFY_IMG_SIZE,   # 64 px — spots are pre-cropped
                cache="ram",
                workers=min(8, config.NUM_WORKERS * 4),
                amp=True,
                project=str(run_dir),
                name="run",
                exist_ok=True,
                verbose=False,
            )

            if self._should_cancel():
                logger.info(f"⏹️ {model_name} training cancelled")
                with _lock:
                    _state["status"]  = "cancelled"
                    _state["message"] = f"{model_name} training cancelled by user."
                if run_id:
                    try:
                        db.finish_training_run(run_id, "cancelled")
                    except Exception:
                        pass
                return

            # Copy best weights to model dir
            best_src = run_dir / "run" / "weights" / "best.pt"
            if not best_src.exists():
                raise FileNotFoundError(f"Training finished but best.pt not found at {best_src}")
            import shutil
            shutil.copy2(best_src, config.YOLO26_CLASSIFY_PATHS[scale])

            with _lock:
                _state["status"]  = "done"
                _state["message"] = f"{model_name} training complete!"
                _state["results"] = {"best_val_acc": _state["val_acc"]}

            if run_id:
                try:
                    db.finish_training_run(run_id, "success",
                                           final_accuracy=_state["val_acc"],
                                           epochs=_state["epoch"])
                except Exception:
                    pass

            # Export to NCNN for edge inference — non-fatal
            try:
                from dev.export.model_exporter import export_yolo_model
                export_yolo_model(model_name, config.YOLO26_CLASSIFY_PATHS[scale])
            except Exception as _exp_err:
                logger.warning(f"Edge export skipped: {_exp_err}")

            logger.info(f"✅ {model_name} training complete")

        except Exception as e:
            logger.exception(f"❌ {model_name} training failed: {e}")
            with _lock:
                _state["status"]  = "error"
                _state["message"] = f"{model_name} training failed: {e}"
            if run_id:
                try:
                    db.finish_training_run(run_id, "failed")
                except Exception:
                    pass

    def _train_yolo26_detect(self):
        """
        Train YOLO26 in detection mode using the exported YOLO detect dataset.
        Reads the dataset.yaml produced by the labeling export, then calls Ultralytics train.
        Output: config.YOLO26_DETECT_PATH
        """
        run_id = None
        try:
            from ultralytics import YOLO

            _detect_start = time.time()
            _batch_count = [0]

            with _lock:
                _state["message"] = "Loading exported YOLO detect dataset..."
                _state["total_epochs"] = config.YOLO_DETECT_EPOCHS

            yaml_path = config.YOLO_DATASET_DIR / "dataset.yaml"
            if not yaml_path.exists():
                raise FileNotFoundError(
                    f"YOLO detect dataset not found at {yaml_path}. "
                    "Export it from the labeling panel first."
                )

            with _lock:
                _state["message"] = "Starting YOLO26 detection training..."

            try:
                run_id = db.start_training_run("yolo26_detect")
            except Exception:
                pass
            model = YOLO(config.YOLO_DETECT_MODEL)

            def on_batch_end(trainer):
                if self._should_cancel():
                    trainer.stop = True
                    return
                _batch_count[0] += 1
                if _batch_count[0] % 50 != 0:
                    return
                try:
                    loss_val = float(trainer.loss.item())
                except Exception:
                    loss_val = 0.0
                with _lock:
                    _state["elapsed"] = round(time.time() - _detect_start, 1)
                    _state["message"] = (
                        f"Epoch {trainer.epoch + 1}/{config.YOLO_DETECT_EPOCHS} — "
                        f"batch {_batch_count[0]} — loss: {loss_val:.4f}"
                    )

            def on_epoch_end(trainer):
                if self._should_cancel():
                    trainer.stop = True
                    return
                _batch_count[0] = 0   # reset so the UI batch count is per-epoch, matching Ultralytics' bar
                epoch   = trainer.epoch + 1
                metrics = trainer.metrics or {}
                map50   = float(metrics.get("metrics/mAP50(B)", 0))
                with _lock:
                    _state["epoch"]   = epoch
                    _state["val_acc"] = round(map50 * 100, 2)
                    _state["elapsed"] = round(time.time() - _detect_start, 1)
                    _state["message"] = (
                        f"Epoch {epoch}/{config.YOLO_DETECT_EPOCHS} — "
                        f"mAP50: {_state['val_acc']:.2f}%"
                    )

            model.add_callback("on_train_batch_end", on_batch_end)
            model.add_callback("on_train_epoch_end", on_epoch_end)

            model.train(
                data=str(yaml_path),
                task="detect",
                epochs=config.YOLO_DETECT_EPOCHS,
                batch=-1,                              # AutoBatch: adapt to the larger model/imgsz, avoid OOM
                imgsz=config.YOLO_DETECT_IMG_SIZE,     # 960 — recover small parking-spot recall
                cache="ram",                           # cache decoded images in RAM
                workers=min(8, config.NUM_WORKERS * 4),
                amp=True,                              # mixed-precision (fp16 on GPU)
                patience=20,                           # small-dataset recipe (epochs=50, patience=20); below max epochs so early-stop can actually fire
                project=str(config.OUTPUT_DIR / "yolo26_detect"),
                name="run",
                exist_ok=True,
                verbose=False,
            )

            if self._should_cancel():
                logger.info("⏹️ YOLO26 detect training cancelled")
                with _lock:
                    _state["status"]  = "cancelled"
                    _state["message"] = "YOLO26 detection training cancelled by user."
                if run_id:
                    try:
                        db.finish_training_run(run_id, "cancelled")
                    except Exception:
                        pass
                return

            # Copy best weights to model dir
            best_src = config.OUTPUT_DIR / "yolo26_detect" / "run" / "weights" / "best.pt"
            if not best_src.exists():
                raise FileNotFoundError(f"Training finished but best.pt not found at {best_src}")
            import shutil
            shutil.copy2(best_src, config.YOLO26_DETECT_PATH)

            with _lock:
                _state["status"]  = "done"
                _state["message"] = "YOLO26 detection training complete!"
                _state["results"] = {"best_val_acc": _state["val_acc"]}

            if run_id:
                try:
                    db.finish_training_run(run_id, "success",
                                           final_accuracy=_state["val_acc"],
                                           epochs=_state["epoch"])
                except Exception:
                    pass

            # Export to ONNX for edge inference — non-fatal
            try:
                from dev.export.model_exporter import export_yolo_model
                export_yolo_model("yolo26_detect", config.YOLO26_DETECT_PATH)
            except Exception as _exp_err:
                logger.warning(f"Edge export skipped: {_exp_err}")

            logger.info("✅ YOLO26 detect training complete")

        except Exception as e:
            logger.exception(f"❌ YOLO26 detect training failed: {e}")
            with _lock:
                _state["status"]  = "error"
                _state["message"] = f"YOLO26 detect training failed: {e}"
            if run_id:
                try:
                    db.finish_training_run(run_id, "failed")
                except Exception:
                    pass

    def _compare_all(self):
        """Train all models and compare results."""
        try:
            # Prepare data once
            with _lock:
                _state["message"] = "Preparing dataset for comparison..."
            data = prepare_dataset()

            comparison_results = []
            model_names = list_available_models()

            for i, name in enumerate(model_names, 1):
                with _lock:
                    _state["message"] = f"Training model {i}/{len(model_names)}: {name}..."
                    _state["model_name"] = name
                    _state["epoch"] = 0

                start_time = time.time()

                # Create and train model
                model = create_model(name)
                trainer = Trainer(model=model, model_name=name)

                def on_progress(epoch, metrics, _start=start_time):
                    with _lock:
                        _state["epoch"] = epoch
                        _state["val_acc"] = round(metrics["val_acc"], 2)
                        _state["elapsed"] = round(time.time() - _start, 1)

                results = trainer.train(
                    data["train_loader"],
                    data["val_loader"],
                    progress_callback=on_progress,
                    should_cancel=self._should_cancel,
                )

                # Evaluate on test set
                eval_results = evaluate_model(model, data["test_loader"], trainer.device)

                comparison_results.append({
                    "model": name,
                    "best_val_acc": results["best_val_acc"],
                    "best_val_loss": results["best_val_loss"],
                    "test_accuracy": eval_results["accuracy"],
                    "test_precision": eval_results["precision"],
                    "test_recall": eval_results["recall"],
                    "test_f1": eval_results["f1_score"],
                    "train_time": results["total_time_seconds"],
                    "total_params": model.count_parameters()["total"],
                    "trainable_params": model.count_parameters()["trainable"],
                })

            # Save comparison results
            comparison_path = config.OUTPUT_DIR / "model_comparison.json"
            with open(comparison_path, "w") as f:
                json.dump(comparison_results, f, indent=2)

            # Generate comparison plot
            self._plot_comparison(comparison_results)

            with _lock:
                _state["status"] = "done"
                _state["message"] = "Model comparison complete!"
                _state["comparison"] = comparison_results

            logger.info("✅ Model comparison complete")

        except TrainingCancelled:
            logger.info("⏹️ Model comparison cancelled")
            with _lock:
                _state["status"] = "cancelled"
                _state["message"] = "Model comparison cancelled by user."
        except Exception as e:
            logger.exception(f"❌ Comparison failed: {e}")
            with _lock:
                _state["status"] = "error"
                _state["message"] = f"Comparison failed: {str(e)}"

    def _plot_comparison(self, results):
        """Generate comparison bar chart."""
        matplotlib.use("Agg")


        models = [r["model"] for r in results]
        metrics = {
            "Accuracy": [r["test_accuracy"] for r in results],
            "Precision": [r["test_precision"] for r in results],
            "Recall": [r["test_recall"] for r in results],
            "F1 Score": [r["test_f1"] for r in results],
        }

        x = np.arange(len(models))
        width = 0.2
        fig, ax = plt.subplots(figsize=(12, 6))

        for i, (metric_name, values) in enumerate(metrics.items()):
            ax.bar(x + i * width, values, width, label=metric_name)

        ax.set_xlabel("Model")
        ax.set_ylabel("Score (%)")
        ax.set_title("Model Comparison — Test Set Metrics")
        ax.set_xticks(x + width * 1.5)
        ax.set_xticklabels(models)
        ax.legend()
        ax.grid(True, alpha=0.3, axis="y")
        ax.set_ylim(0, 105)

        plt.tight_layout()
        plot_path = config.OUTPUT_DIR / "model_comparison.png"
        plt.savefig(plot_path, dpi=150, bbox_inches="tight")
        plt.close()
        logger.info(f"📊 Comparison plot saved to {plot_path}")

    # ── Evaluate-only (no retraining) ─────────────────────────────────────────

    def start_evaluation(self, dataset="standard"):
        """Evaluate all trained models without retraining. Returns initial status dict.

        Args:
            dataset (str): "standard" for the internal 70/15/15 split, or an
                           external benchmark dataset id (see
                           dev.eval.external_datasets).
        """
        with _lock:
            if _state.get("status") == "training":
                return {"status": "error", "message": "A training/evaluation job is already running."}
            _state["status"]     = "training"
            _state["message"]    = "Starting evaluation…"
            _state["model_name"] = "all"
            _state["epoch"]      = 0
            _state["results"]    = None
            _state["comparison"] = None
            _state["dataset"]    = dataset
        thread = threading.Thread(target=self._evaluate_all, args=(dataset,), daemon=True)
        thread.start()
        return {"status": "training", "message": "Evaluation started"}

    def _evaluate_all(self, dataset="standard"):
        """Load saved weights for every trained model and evaluate — no retraining.

        With dataset="standard" the internal 70/15/15 split is used. With an
        external benchmark id every model is scored against that dataset instead;
        models the dataset can't cover (no classifier crops / no detect labels)
        are skipped.
        """
        import csv as csv_mod
        from dev.eval import external_datasets
        try:
            ext = external_datasets.resolve(dataset)      # None → standard split
            ds_label = ext["label"] if ext else "Standard split"

            cnn_candidates = [
                ("cnn_scratch",  config.CNN_SCRATCH_PATH),
                ("resnet18",     config.RESNET18_PATH),
                ("resnet50",     config.RESNET50_PATH),
                ("mobilenetv4s", config.MOBILENETV4S_PATH),
                ("mobilenetv4m", config.MOBILENETV4M_PATH),
            ]
            cnn_present = [(n, p) for n, p in cnn_candidates if p.exists()]
            # One entry per trained YOLO26 classify scale (n/s/m).
            yolo_cl_candidates = [(f"yolo26{s}_classify", config.YOLO26_CLASSIFY_PATHS[s]) for s in ("n", "s", "m")]
            yolo_cl_present = [(n, p) for n, p in yolo_cl_candidates if p.exists()]
            yolo_dt_present = config.YOLO26_DETECT_PATH.exists()

            # An external dataset gates which models can run: classifier crops
            # drive the classify models, detect labels drive the detector.
            allow_classify = ext is None or ext["has_classifier"]
            allow_detect   = ext is None or ext["has_detector"]
            eval_cnn     = bool(cnn_present) and allow_classify
            eval_yolo_cl = bool(yolo_cl_present) and allow_classify
            eval_yolo_dt = yolo_dt_present  and allow_detect
            total = ((len(cnn_present) if eval_cnn else 0)
                     + (len(yolo_cl_present) if eval_yolo_cl else 0)
                     + eval_yolo_dt)

            if total == 0:
                with _lock:
                    _state["status"]  = "error"
                    _state["message"] = (
                        "No trained models found. Train at least one model first."
                        if ext is None else
                        f"No trained models match the '{ds_label}' dataset."
                    )
                return

            # Load the CNN test set only if CNN models will run.
            device = test_loader = None
            if eval_cnn:
                with _lock:
                    _state["message"] = "Loading dataset for evaluation…"
                import torch
                from src.models.model_factory import load_model
                from dev.eval.evaluator import evaluate_model
                device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
                if ext is None:
                    from dev.data_prep.preprocessor import prepare_dataset
                    test_loader = prepare_dataset()["test_loader"]
                else:
                    test_loader = external_datasets.build_external_test_loader(ext["classifier_dir"])

            results = []
            done = 0

            # ── CNN / transfer models ─────────────────────────────────────────
            for name, _ in (cnn_present if eval_cnn else []):
                done += 1
                with _lock:
                    _state["message"]    = f"Evaluating {name} ({done}/{total})…"
                    _state["model_name"] = name

                model    = load_model(name, device=device)
                eval_res = evaluate_model(model, test_loader, device=device)

                # Read supplementary info from history JSON
                history_path = config.OUTPUT_DIR / f"history_{name}.json"
                train_time = best_val_acc = None
                epochs = 0
                if history_path.exists():
                    with open(history_path) as fh:
                        h = json.load(fh)
                    val_acc_list = h.get("val_acc", [])
                    train_time   = round(sum(h.get("epoch_times", [])), 1)
                    best_val_acc = round(max(val_acc_list), 2) if val_acc_list else None
                    epochs       = len(val_acc_list)

                params = model.count_parameters()
                results.append({
                    "model":            name,
                    "type":             "classification",
                    "epochs":           epochs,
                    "train_time":       train_time,
                    "best_val_acc":     best_val_acc,
                    "test_accuracy":    eval_res["accuracy"],
                    "test_precision":   eval_res["precision"],
                    "test_recall":      eval_res["recall"],
                    "test_f1":          eval_res["f1_score"],
                    "total_samples":    eval_res["total_samples"],
                    "total_params":     params["total"],
                    "trainable_params": params["trainable"],
                })

            # ── YOLO Classify (one pass per trained scale) ────────────────────
            for cl_name, cl_ckpt in (yolo_cl_present if eval_yolo_cl else []):
                done += 1
                with _lock:
                    _state["message"]    = f"Evaluating {cl_name} ({done}/{total})…"
                    _state["model_name"] = cl_name

                entry = {"model": cl_name, "type": "classification"}

                # Supplementary training info from CSV (epochs, train_time only)
                csv_path = config.OUTPUT_DIR / cl_name / "run" / "results.csv"
                if csv_path.exists():
                    with open(csv_path) as fh:
                        rows = list(csv_mod.DictReader(fh))
                    if rows:
                        last = {k.strip(): v.strip() for k, v in rows[-1].items()}
                        entry.update({
                            "epochs":     int(float(last.get("epoch", len(rows)))),
                            "train_time": round(float(last.get("time", 0)), 1),
                        })

                if ext is None:
                    from ultralytics import YOLO
                    from dev.data_prep.preprocessor import build_classify_split

                    # Actual evaluation — run inference on the val split
                    build_classify_split()                  # idempotent; ensures the folders exist
                    classify_data_dir = config.CLASSIFY_SPLIT_DIR
                    yolo_cl = YOLO(str(cl_ckpt))
                    val_res = yolo_cl.val(
                        data=str(classify_data_dir),
                        split="val",
                        imgsz=config.YOLO_CLASSIFY_IMG_SIZE,
                        verbose=False,
                    )
                    entry["test_accuracy"] = round(float(val_res.top1) * 100, 2)

                    # Derive precision/recall/F1 from the confusion matrix.
                    # Ultralytics classify: cm.matrix shape (nc, nc), cm[actual][predicted].
                    # Class 0 = occupied (alphabetical), treated as positive.
                    try:
                        # Ultralytics classify ConfusionMatrix: try .matrix, fall back to .data
                        raw_cm = val_res.confusion_matrix
                        cm = getattr(raw_cm, "matrix", None) or getattr(raw_cm, "data", None)
                        if cm is None:
                            raise AttributeError(f"Cannot read confusion matrix from {type(raw_cm)}")
                        tp = float(cm[0][0])
                        fp = float(cm[1][0])
                        fn = float(cm[0][1])
                        prec = tp / (tp + fp) if (tp + fp) > 0 else 0.0
                        rec  = tp / (tp + fn) if (tp + fn) > 0 else 0.0
                        f1   = 2 * prec * rec / (prec + rec) if (prec + rec) > 0 else 0.0
                        entry.update({
                            "test_precision": round(prec * 100, 2),
                            "test_recall":    round(rec * 100, 2),
                            "test_f1":        round(f1 * 100, 2),
                        })
                    except Exception as _cm_err:
                        logger.warning(f"{cl_name}: could not compute P/R/F1 from confusion matrix — {_cm_err}")
                else:
                    # External dataset: per-crop predict + sklearn metrics.
                    m = external_datasets.evaluate_yolo_classify_external(
                        cl_ckpt, ext["classifier_dir"]
                    )
                    if m:
                        entry.update({
                            "test_accuracy":  m["accuracy"],
                            "test_precision": m["precision"],
                            "test_recall":    m["recall"],
                            "test_f1":        m["f1_score"],
                            "total_samples":  m["total_samples"],
                        })

                results.append(entry)

            # ── YOLO Detect ───────────────────────────────────────────────────
            if eval_yolo_dt:
                done += 1
                with _lock:
                    _state["message"]    = f"Evaluating yolo26_detect ({done}/{total})…"
                    _state["model_name"] = "yolo26_detect"

                from ultralytics import YOLO

                entry = {"model": "yolo26_detect", "type": "detection"}

                # Supplementary training info from CSV (epochs, train_time only)
                csv_path = config.OUTPUT_DIR / "yolo26_detect" / "run" / "results.csv"
                if csv_path.exists():
                    with open(csv_path) as fh:
                        rows = list(csv_mod.DictReader(fh))
                    if rows:
                        last = {k.strip(): v.strip() for k, v in rows[-1].items()}
                        entry.update({
                            "epochs":     int(float(last.get("epoch", len(rows)))),
                            "train_time": round(float(last.get("time", 0)), 1),
                        })

                # Actual evaluation. Standard uses the internal detect test split;
                # an external dataset supplies its own data.yaml (val = its images).
                if ext is None:
                    yaml_path = config.YOLO_DATASET_DIR / "dataset.yaml"
                    split = "test"
                else:
                    yaml_path = ext["detector_yaml"]
                    split = "val"
                yolo_dt = YOLO(str(config.YOLO26_DETECT_PATH))
                val_res = yolo_dt.val(
                    data=str(yaml_path),
                    split=split,
                    verbose=False,
                )
                entry.update({
                    "test_accuracy":  round(float(val_res.box.map50) * 100, 2),
                    "test_precision": round(float(val_res.box.mp) * 100, 2),
                    "test_recall":    round(float(val_res.box.mr) * 100, 2),
                })
                results.append(entry)

            # ── Persist ───────────────────────────────────────────────────────
            # Standard results are the canonical model_comparison.json (read by
            # /api/model/info); external results go to a per-dataset file so they
            # never clobber the standard comparison.
            comparison_path = config.OUTPUT_DIR / (
                "model_comparison.json" if ext is None
                else f"model_comparison_{dataset}.json"
            )
            with open(comparison_path, "w") as fh:
                json.dump(results, fh, indent=2)

            # Archive a timestamped snapshot so this run stays browsable after
            # the next Evaluate-All overwrites the canonical comparison file.
            from dev.eval.history_store import save_eval_snapshot
            save_eval_snapshot(dataset, results)

            with _lock:
                _state["status"]     = "done"
                _state["message"]    = f"Evaluation complete — {len(results)} model(s) on {ds_label}."
                _state["comparison"] = results
                _state["dataset"]    = dataset

            logger.info(f"✅ Evaluate-all complete on {ds_label}: {[r['model'] for r in results]}")

        except Exception as e:
            logger.exception(f"❌ Evaluate-all failed: {e}")
            with _lock:
                _state["status"]  = "error"
                _state["message"] = f"Evaluation failed: {str(e)}"
