"""
Train All Models - CPU Quick Training (Windows Safe)
=====================================================
1000 images/class, 5 epochs, num_workers=0
Expected: ~10-15 min total on CPU
"""

if __name__ == "__main__":
    import sys
    import os
    import json
    import time
    import logging

    os.environ["PYTHONIOENCODING"] = "utf-8"
    sys.stdout.reconfigure(encoding="utf-8")
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

    # Force unbuffered prints
    _print = print
    def print(*args, **kwargs):
        kwargs.setdefault("flush", True)
        _print(*args, **kwargs)

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s  %(levelname)-8s  %(message)s",
        handlers=[logging.StreamHandler(sys.stdout)],
    )
    logger = logging.getLogger("smartpark")

    import warnings
    warnings.filterwarnings("ignore", category=UserWarning)

    import config

    print("=" * 65)
    print("  SMART PARKING AI - Train All Models (CPU)")
    print("=" * 65)
    print(f"  Dataset:    {config.PKLOT_ROOT}")
    print(f"  Images:     1000/class = 2000 total (per model)")
    print(f"  Epochs:     {config.EPOCHS}")
    print(f"  Batch Size: {config.BATCH_SIZE}")
    print(f"  Device:     CPU")
    print("=" * 65)

    # ── Step 1: Organize Dataset ────────────────────────────
    print("\n[STEP 1/5] Organizing PKLot dataset...")
    step_start = time.time()

    from src.data_prep.downloader import organize_pklot
    counts = organize_pklot(
        source_root=config.PKLOT_ROOT,
        target_root=str(config.DATA_DIR),
        max_per_class=1000,
    )
    print(f"  Occupied: {counts['occupied']}, Vacant: {counts['vacant']}")
    print(f"  Done in {time.time() - step_start:.1f}s")

    # ── Step 2: Prepare DataLoaders ─────────────────────────
    print("\n[STEP 2/5] Preparing DataLoaders (num_workers=0)...")
    step_start = time.time()

    from src.data_prep.preprocessor import prepare_dataset
    data = prepare_dataset(num_workers=0)

    print(f"  Train: {data['train_size']}, Val: {data['val_size']}, Test: {data['test_size']}")
    print(f"  Done in {time.time() - step_start:.1f}s")

    # ── Step 3: Train All Models ────────────────────────────
    print("\n[STEP 3/5] Training all 3 models...")

    import torch
    from src.models.model_factory import create_model
    from src.train.trainer import Trainer
    from src.eval.evaluator import evaluate_model
    from src.eval.visualizer import (
        plot_confusion_matrix,
        visualize_predictions,
        plot_model_comparison,
    )

    device = torch.device("cpu")
    model_names = ["cnn_scratch", "resnet50", "mobilenetv4"]
    all_results = []
    total_train_start = time.time()

    for i, name in enumerate(model_names, 1):
        print(f"\n{'='*65}")
        print(f"  MODEL {i}/{len(model_names)}: {name.upper()}")
        print(f"{'='*65}")
        model_start = time.time()

        model = create_model(name)
        params = model.count_parameters()
        print(f"  Params: {params['total']:,} total, {params['trainable']:,} trainable")

        trainer = Trainer(model=model, model_name=name, device=device)

        train_results = trainer.train(data["train_loader"], data["val_loader"])
        model_time = time.time() - model_start

        print(f"\n  Evaluating on test set...")
        eval_results = evaluate_model(model, data["test_loader"], device)

        plot_confusion_matrix(eval_results["confusion_matrix"], model_name=name)
        visualize_predictions(model, data["test_loader"], device=device,
                              num_images=16, model_name=name)

        result = {
            "model": name,
            "total_params": params["total"],
            "trainable_params": params["trainable"],
            "best_val_acc": train_results["best_val_acc"],
            "best_val_loss": train_results["best_val_loss"],
            "best_epoch": train_results["best_epoch"],
            "total_epochs": train_results["total_epochs"],
            "test_accuracy": eval_results["accuracy"],
            "test_precision": eval_results["precision"],
            "test_recall": eval_results["recall"],
            "test_f1": eval_results["f1_score"],
            "train_time": round(model_time, 1),
        }
        all_results.append(result)

        print(f"\n  >> {name} DONE in {model_time:.1f}s ({model_time/60:.1f} min)")
        print(f"  >> Test Accuracy: {eval_results['accuracy']:.2f}%")
        print(f"  >> Test F1:       {eval_results['f1_score']:.2f}%")

    # ── Step 4: Comparison ──────────────────────────────────
    print(f"\n{'='*65}")
    print("  [STEP 4/5] Model Comparison")
    print(f"{'='*65}")

    comparison_path = config.OUTPUT_DIR / "model_comparison.json"
    with open(comparison_path, "w") as f:
        json.dump(all_results, f, indent=2)

    plot_model_comparison(all_results)

    print(f"\n  {'Model':<15} {'Acc':>7} {'Prec':>7} {'Recall':>7} {'F1':>7} {'Time':>8}")
    print(f"  {'-'*13:<15} {'-----':>7} {'-----':>7} {'------':>7} {'----':>7} {'------':>8}")
    for r in all_results:
        print(f"  {r['model']:<15} {r['test_accuracy']:>6.2f}% {r['test_precision']:>6.2f}% "
              f"{r['test_recall']:>6.2f}% {r['test_f1']:>6.2f}% {r['train_time']:>6.1f}s")

    # ── Step 5: Summary ─────────────────────────────────────
    total_time = time.time() - total_train_start
    best = max(all_results, key=lambda r: r["test_accuracy"])

    print(f"\n{'='*65}")
    print(f"  TRAINING COMPLETE!")
    print(f"{'='*65}")
    print(f"  Total time: {total_time:.1f}s ({total_time/60:.1f} min)")
    print(f"  Best model: {best['model']} ({best['test_accuracy']:.2f}% accuracy)")
    print(f"\n  Outputs:  {config.OUTPUT_DIR}")
    print(f"  Weights:  {config.MODEL_DIR}")
    print(f"{'='*65}")
