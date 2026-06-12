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
