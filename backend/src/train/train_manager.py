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
import matplotlib
import matplotlib.pyplot as plt
import numpy as np
import torch
import config
from src.models.model_factory import create_model, list_available_models
from src.train.trainer import Trainer
from src.data_prep.preprocessor import prepare_dataset
from src.eval.evaluator import evaluate_model

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))
logger = logging.getLogger("smartpark.train_manager")

# Singleton state — shared across API requests
_state = {
    "status": "idle",       # idle | training | done | error
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
            _state["message"] = f"Starting {'comparison' if compare_all else model_name}..."
            _state["model_name"] = model_name
            _state["epoch"] = 0
            _state["results"] = None
            _state["comparison"] = None

        if compare_all:
            thread = threading.Thread(target=self._compare_all, daemon=True)
        elif model_name == "yolo26_classify":
            thread = threading.Thread(target=self._train_yolo26_classify, daemon=True)
        elif model_name == "yolo26_detect":
            thread = threading.Thread(target=self._train_yolo26_detect, daemon=True)
        else:
            thread = threading.Thread(target=self._train_model, args=(model_name,), daemon=True)
        thread.start()

        return {"status": "training", "message": _state["message"]}

    def _train_model(self, model_name):
        """Train a single model (runs in background thread)."""
        try:
            start_time = time.time()

            # Prepare data
            with _lock:
                _state["message"] = "Preparing dataset..."
            data = prepare_dataset()

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

            # Train
            results = trainer.train(
                data["train_loader"],
                data["val_loader"],
                progress_callback=on_progress,
            )

            with _lock:
                _state["status"] = "done"
                _state["message"] = (
                    f"Training complete! Best val accuracy: {results['best_val_acc']:.2f}%"
                )
                _state["results"] = results

            logger.info(f"✅ Training complete: {model_name}")

        except Exception as e:
            logger.exception(f"❌ Training failed: {e}")
            with _lock:
                _state["status"] = "error"
                _state["message"] = f"Training failed: {str(e)}"

    def _train_yolo26_classify(self):
        """
        Train YOLO26 in classification mode using the existing occupied/vacant dataset.
        Uses Ultralytics Python API — no CLI required.
        Output: config.YOLO26_CLASSIFY_PATH
        """
        try:
            from ultralytics import YOLO
            from src.data_prep.yolo_converter import build_yolo_classify_dataset

            _classify_start = time.time()
            _batch_count = [0]

            with _lock:
                _state["message"] = "Cropping ROI spots from gopro annotations..."
                _state["total_epochs"] = config.EPOCHS

            classify_data_dir = build_yolo_classify_dataset()

            with _lock:
                _state["message"] = "Starting YOLO26 classification training..."

            model = YOLO("yolo26n-cls.yaml")  # build from scratch, no pretrained weights

            def on_batch_end(trainer):
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
                        f"Epoch {trainer.epoch + 1}/{config.EPOCHS} — "
                        f"batch {_batch_count[0]} — loss: {loss_val:.4f}"
                    )

            def on_epoch_end(trainer):
                epoch   = trainer.epoch + 1
                metrics = trainer.metrics or {}
                with _lock:
                    _state["epoch"]   = epoch
                    _state["val_acc"] = round(float(metrics.get("metrics/accuracy_top1", 0)) * 100, 2)
                    _state["elapsed"] = round(time.time() - _classify_start, 1)
                    _state["message"] = (
                        f"Epoch {epoch}/{config.EPOCHS} — "
                        f"Top-1 Acc: {_state['val_acc']:.2f}%"
                    )

            model.add_callback("on_train_batch_end", on_batch_end)
            model.add_callback("on_train_epoch_end", on_epoch_end)

            results = model.train(
                data=str(classify_data_dir),           # pre-built subset: only occupied/ + vacant/
                task="classify",
                epochs=config.EPOCHS,
                batch=config.BATCH_SIZE,
                imgsz=config.YOLO_CLASSIFY_IMG_SIZE,   # 64 px — spots are pre-cropped
                cache="ram",
                workers=min(8, config.NUM_WORKERS * 4),
                amp=True,
                project=str(config.OUTPUT_DIR / "yolo26_classify"),
                name="run",
                exist_ok=True,
                verbose=False,
            )

            # Copy best weights to model dir
            best_src = config.OUTPUT_DIR / "yolo26_classify" / "run" / "weights" / "best.pt"
            if best_src.exists():
                import shutil
                shutil.copy2(best_src, config.YOLO26_CLASSIFY_PATH)

            with _lock:
                _state["status"]  = "done"
                _state["message"] = "YOLO26 classification training complete!"
                _state["results"] = {"best_val_acc": _state["val_acc"]}

            logger.info("✅ YOLO26 classify training complete")

        except Exception as e:
            logger.exception(f"❌ YOLO26 classify training failed: {e}")
            with _lock:
                _state["status"]  = "error"
                _state["message"] = f"YOLO26 classify training failed: {e}"

    def _train_yolo26_detect(self):
        """
        Train YOLO26 in detection mode using the parking_rois_gopro annotated dataset.
        Converts annotations.json → YOLO format on first run, then calls Ultralytics train.
        Output: config.YOLO26_DETECT_PATH
        """
        try:
            from ultralytics import YOLO
            from src.data_prep.yolo_converter import build_yolo_detect_dataset

            _detect_start = time.time()
            _batch_count = [0]

            with _lock:
                _state["message"] = "Converting gopro annotations to YOLO format..."
                _state["total_epochs"] = config.EPOCHS

            yaml_path = build_yolo_detect_dataset()

            with _lock:
                _state["message"] = "Starting YOLO26 detection training..."

            model = YOLO("yolo26n.yaml")  # build from scratch, no pretrained weights

            def on_batch_end(trainer):
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
                        f"Epoch {trainer.epoch + 1}/{config.EPOCHS} — "
                        f"batch {_batch_count[0]} — loss: {loss_val:.4f}"
                    )

            def on_epoch_end(trainer):
                epoch   = trainer.epoch + 1
                metrics = trainer.metrics or {}
                map50   = float(metrics.get("metrics/mAP50(B)", 0))
                with _lock:
                    _state["epoch"]   = epoch
                    _state["val_acc"] = round(map50 * 100, 2)
                    _state["elapsed"] = round(time.time() - _detect_start, 1)
                    _state["message"] = (
                        f"Epoch {epoch}/{config.EPOCHS} — "
                        f"mAP50: {_state['val_acc']:.2f}%"
                    )

            model.add_callback("on_train_batch_end", on_batch_end)
            model.add_callback("on_train_epoch_end", on_epoch_end)

            results = model.train(
                data=str(yaml_path),
                task="detect",
                epochs=config.EPOCHS,
                batch=config.BATCH_SIZE,
                imgsz=640,
                cache="ram",                           # cache decoded images in RAM
                workers=min(8, config.NUM_WORKERS * 4),
                amp=True,                              # mixed-precision (fp16 on GPU)
                project=str(config.OUTPUT_DIR / "yolo26_detect"),
                name="run",
                exist_ok=True,
                verbose=False,
            )

            # Copy best weights to model dir
            best_src = config.OUTPUT_DIR / "yolo26_detect" / "run" / "weights" / "best.pt"
            if best_src.exists():
                import shutil
                shutil.copy2(best_src, config.YOLO26_DETECT_PATH)

            with _lock:
                _state["status"]  = "done"
                _state["message"] = "YOLO26 detection training complete!"
                _state["results"] = {"best_val_acc": _state["val_acc"]}

            logger.info("✅ YOLO26 detect training complete")

        except Exception as e:
            logger.exception(f"❌ YOLO26 detect training failed: {e}")
            with _lock:
                _state["status"]  = "error"
                _state["message"] = f"YOLO26 detect training failed: {e}"

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
