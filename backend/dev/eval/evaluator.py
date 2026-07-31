"""
Evaluator — Model Evaluation Metrics
=======================================
Computes comprehensive classification metrics on the test set:
    - Accuracy
    - Precision
    - Recall
    - F1 Score
    - Confusion Matrix
    - Per-class metrics
"""

import logging
import numpy as np
import torch


from sklearn.metrics import (
    accuracy_score,
    precision_score,
    recall_score,
    f1_score,
    confusion_matrix,
    classification_report,
)

logger = logging.getLogger("berth.evaluator")


@torch.no_grad()
def evaluate_model(model, test_loader, device=None):
    """
    Evaluate a trained model on the test set.

    Args:
        model (nn.Module): Trained model
        test_loader: Test DataLoader
        device: Computation device

    Returns:
        dict: {
            accuracy, precision, recall, f1_score,
            confusion_matrix, classification_report,
            all_predictions, all_labels, all_probabilities
        }
    """
    if device is None:
        device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

    model.to(device)
    model.eval()

    all_labels = []
    all_preds = []
    all_probs = []

    for images, labels in test_loader:
        images = images.to(device)
        outputs = model(images)

        probs_t = torch.sigmoid(outputs).squeeze()
        probs = probs_t.cpu().numpy()
        preds = (probs_t > 0.5).float().cpu().numpy()
        labels_np = labels.cpu().numpy()

        # Handle single-element batches
        if probs.ndim == 0:
            probs = np.array([probs.item()])
            preds = np.array([preds.item()])
            labels_np = np.array([labels_np.item()])

        all_probs.extend(probs.tolist())
        all_preds.extend(preds.tolist())
        all_labels.extend(labels_np.tolist())

    # Convert to numpy
    all_labels = np.array(all_labels)
    all_preds  = np.array(all_preds)
    all_probs  = np.array(all_probs)

    # Compute metrics
    acc  = accuracy_score(all_labels, all_preds) * 100
    prec = precision_score(all_labels, all_preds, zero_division=0) * 100
    rec  = recall_score(all_labels, all_preds, zero_division=0) * 100
    f1   = f1_score(all_labels, all_preds, zero_division=0) * 100
    cm   = confusion_matrix(all_labels, all_preds)
    report = classification_report(
        all_labels, all_preds,
        target_names=["Vacant", "Occupied"],
        zero_division=0,
    )

    # Log results
    logger.info(f"\n{'='*50}")
    logger.info("📊 Evaluation Results")
    logger.info(f"{'='*50}")
    logger.info(f"  Accuracy:  {acc:.2f}%")
    logger.info(f"  Precision: {prec:.2f}%")
    logger.info(f"  Recall:    {rec:.2f}%")
    logger.info(f"  F1 Score:  {f1:.2f}%")
    logger.info("\nConfusion Matrix:")
    logger.info(f"  {cm}")
    logger.info(f"\nClassification Report:\n{report}")

    return {
        "accuracy":     round(acc, 2),
        "precision":    round(prec, 2),
        "recall":       round(rec, 2),
        "f1_score":     round(f1, 2),
        "confusion_matrix": cm.tolist(),
        "classification_report": report,
        "all_predictions":  all_preds.tolist(),
        "all_labels":       all_labels.tolist(),
        "all_probabilities": all_probs.tolist(),
        "total_samples":    len(all_labels),
    }


def evaluate_yolo_classify(weights_path, split="test", imgsz=None):
    """Evaluate a YOLO26 classify checkpoint on the internal classify split.

    Ultralytics classify models can't go through evaluate_model() (they aren't
    torch nn.Modules with a sigmoid head), so this runs the native .val() and
    returns the same metric shape. occupied = class 0 (alphabetical) = positive.

    Scored on the capped, class-balanced subset's test split — the same crops
    prepare_dataset() gives the PyTorch classifiers — so the two families are
    comparable. The full split is imbalanced ~1.7:1 occupied and would inflate
    accuracy relative to the CNN numbers.
    """
    import config
    from ultralytics import YOLO
    from dev.data_prep.preprocessor import build_classify_split, build_classify_subset

    imgsz = imgsz or config.YOLO_CLASSIFY_IMG_SIZE
    build_classify_split()               # idempotent; ensures the split folders exist
    data_dir = build_classify_subset()   # idempotent; falls back to the full split when no cap applies
    model = YOLO(str(weights_path))
    res = model.val(
        data=str(data_dir),
        split=split,
        imgsz=imgsz,
        verbose=False,
    )

    metrics = {"accuracy": round(float(res.top1) * 100, 2)}
    # Derive P/R/F1 from the confusion matrix. Ultralytics stores it as
    # cm[predicted][actual], not cm[actual][predicted]; reading it the other way round
    # swaps fp with fn and therefore precision with recall. Class 0 = occupied.
    try:
        raw_cm = res.confusion_matrix
        cm = getattr(raw_cm, "matrix", None)
        if cm is None:
            cm = getattr(raw_cm, "data", None)
        if cm is None:
            raise AttributeError(f"Cannot read confusion matrix from {type(raw_cm)}")
        tp = float(cm[0][0])
        fp = float(cm[0][1])
        fn = float(cm[1][0])
        prec = tp / (tp + fp) if (tp + fp) > 0 else 0.0
        rec  = tp / (tp + fn) if (tp + fn) > 0 else 0.0
        f1   = 2 * prec * rec / (prec + rec) if (prec + rec) > 0 else 0.0
        metrics.update({
            "precision": round(prec * 100, 2),
            "recall":    round(rec * 100, 2),
            "f1_score":  round(f1 * 100, 2),
        })
    except Exception as cm_err:
        logger.warning(f"YOLO classify eval: could not compute P/R/F1 — {cm_err}")

    return metrics
