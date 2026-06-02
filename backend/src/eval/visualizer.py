"""
Visualizer — Evaluation Plots & Visualizations
=================================================
Generates publication-quality plots for model evaluation:
    - Confusion matrix heatmap
    - Training curves (loss + accuracy)
    - Test prediction visualization grid
    - Model comparison bar chart
"""

import sys
import logging
import numpy as np
from pathlib import Path
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import seaborn as sns
import torch
from src.data_prep.dataset import ParkingDataset
import config


sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))
logger = logging.getLogger("berth.visualizer")


def plot_confusion_matrix(cm, model_name="model", save_dir=None):
    """
    Plot and save a confusion matrix heatmap.

    Args:
        cm (list/ndarray): 2×2 confusion matrix
        model_name (str): Model name for title
        save_dir (str): Output directory
    """
    save_dir = Path(save_dir or config.OUTPUT_DIR)
    cm = np.array(cm)

    fig, ax = plt.subplots(figsize=(8, 6))
    sns.heatmap(
        cm, annot=True, fmt="d", cmap="Blues",
        xticklabels=["Vacant", "Occupied"],
        yticklabels=["Vacant", "Occupied"],
        ax=ax,
        annot_kws={"size": 16},
    )
    ax.set_xlabel("Predicted", fontsize=12)
    ax.set_ylabel("Actual", fontsize=12)
    ax.set_title(f"Confusion Matrix — {model_name}", fontsize=14, fontweight="bold")

    plt.tight_layout()
    path = save_dir / f"confusion_matrix_{model_name}.png"
    plt.savefig(path, dpi=150, bbox_inches="tight")
    plt.close()
    logger.info(f"📊 Confusion matrix saved to {path}")
    return str(path)


def plot_training_curves(history, model_name="model", save_dir=None):
    """
    Plot training and validation loss/accuracy curves from history dict.

    Args:
        history (dict): Training history with train_loss, val_loss, train_acc, val_acc
        model_name (str): Model name for title
        save_dir (str): Output directory
    """
    save_dir = Path(save_dir or config.OUTPUT_DIR)
    epochs = range(1, len(history["train_loss"]) + 1)

    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(14, 5))
    fig.suptitle(f"Training History — {model_name}", fontsize=14, fontweight="bold")

    # Loss
    ax1.plot(epochs, history["train_loss"], "b-o", label="Train", markersize=3)
    ax1.plot(epochs, history["val_loss"], "r-o", label="Validation", markersize=3)
    ax1.set_xlabel("Epoch")
    ax1.set_ylabel("Loss")
    ax1.set_title("Binary Cross-Entropy Loss")
    ax1.legend()
    ax1.grid(True, alpha=0.3)

    # Accuracy
    ax2.plot(epochs, history["train_acc"], "b-o", label="Train", markersize=3)
    ax2.plot(epochs, history["val_acc"], "r-o", label="Validation", markersize=3)
    ax2.set_xlabel("Epoch")
    ax2.set_ylabel("Accuracy (%)")
    ax2.set_title("Classification Accuracy")
    ax2.legend()
    ax2.grid(True, alpha=0.3)

    plt.tight_layout()
    path = save_dir / f"training_curves_{model_name}.png"
    plt.savefig(path, dpi=150, bbox_inches="tight")
    plt.close()
    logger.info(f"📈 Training curves saved to {path}")
    return str(path)


def visualize_predictions(model, test_loader, device=None, num_images=16,
                          model_name="model", save_dir=None):
    """
    Visualize model predictions on test images in a grid.

    Shows each image with:
        - Predicted label (Occupied/Vacant)
        - Actual label
        - Confidence score
        - Color: green if correct, red if wrong

    Args:
        model: Trained model
        test_loader: Test DataLoader
        device: Computation device
        num_images (int): Number of images to show
        model_name (str): Model name for title
        save_dir (str): Output directory
    """
    if device is None:
        device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

    save_dir = Path(save_dir or config.OUTPUT_DIR)
    model.to(device)
    model.eval()

    # Get inverse transform for display
    inv_transform = ParkingDataset.get_inverse_transform()

    # Collect predictions
    images_list = []
    labels_list = []
    preds_list = []
    probs_list = []

    with torch.no_grad():
        for images, labels in test_loader:
            images = images.to(device)
            outputs = model(images)
            probs = outputs.squeeze().cpu()
            preds = (probs > 0.5).float()

            for i in range(images.size(0)):
                if len(images_list) >= num_images:
                    break
                images_list.append(images[i].cpu())
                labels_list.append(labels[i].item())
                preds_list.append(preds[i].item() if preds.dim() > 0 else preds.item())
                probs_list.append(probs[i].item() if probs.dim() > 0 else probs.item())
            if len(images_list) >= num_images:
                break

    # Plot grid
    cols = 4
    rows = (num_images + cols - 1) // cols
    fig, axes = plt.subplots(rows, cols, figsize=(16, 4 * rows))
    fig.suptitle(f"Test Predictions — {model_name}", fontsize=14, fontweight="bold")

    label_names = {0: "Vacant", 1: "Occupied"}

    for i in range(rows * cols):
        ax = axes[i // cols][i % cols] if rows > 1 else axes[i % cols]

        if i < len(images_list):
            img = inv_transform(images_list[i])
            img = img.permute(1, 2, 0).numpy()
            img = np.clip(img, 0, 1)

            pred_label = int(preds_list[i])
            true_label = int(labels_list[i])
            confidence = probs_list[i] if pred_label == 1 else 1 - probs_list[i]
            correct = pred_label == true_label

            ax.imshow(img)
            color = "green" if correct else "red"
            ax.set_title(
                f"Pred: {label_names[pred_label]} ({confidence:.0%})\n"
                f"True: {label_names[true_label]}",
                color=color, fontsize=10, fontweight="bold"
            )
        ax.axis("off")

    plt.tight_layout()
    path = save_dir / f"predictions_{model_name}.png"
    plt.savefig(path, dpi=150, bbox_inches="tight")
    plt.close()
    logger.info(f"🖼️  Prediction visualization saved to {path}")
    return str(path)


def plot_model_comparison(comparison_results, save_dir=None):
    """
    Plot side-by-side comparison of all trained models.

    Args:
        comparison_results (list[dict]): List of model result dicts
        save_dir (str): Output directory
    """
    save_dir = Path(save_dir or config.OUTPUT_DIR)

    models = [r["model"] for r in comparison_results]
    metrics = {
        "Accuracy": [r["test_accuracy"] for r in comparison_results],
        "Precision": [r["test_precision"] for r in comparison_results],
        "Recall": [r["test_recall"] for r in comparison_results],
        "F1 Score": [r["test_f1"] for r in comparison_results],
    }

    x = np.arange(len(models))
    width = 0.18
    colors = ["#2196F3", "#4CAF50", "#FF9800", "#E91E63"]

    fig, ax = plt.subplots(figsize=(12, 6))

    for i, (metric_name, values) in enumerate(metrics.items()):
        bars = ax.bar(x + i * width, values, width, label=metric_name, color=colors[i])
        # Add value labels on bars
        for bar, val in zip(bars, values):
            ax.text(
                bar.get_x() + bar.get_width() / 2, bar.get_height() + 0.5,
                f"{val:.1f}", ha="center", va="bottom", fontsize=8
            )

    ax.set_xlabel("Model Architecture", fontsize=12)
    ax.set_ylabel("Score (%)", fontsize=12)
    ax.set_title("Model Comparison — Test Set Performance", fontsize=14, fontweight="bold")
    ax.set_xticks(x + width * 1.5)
    ax.set_xticklabels(models, fontsize=11)
    ax.legend(fontsize=10)
    ax.grid(True, alpha=0.3, axis="y")
    ax.set_ylim(0, 105)

    plt.tight_layout()
    path = save_dir / "model_comparison.png"
    plt.savefig(path, dpi=150, bbox_inches="tight")
    plt.close()
    logger.info(f"📊 Model comparison plot saved to {path}")
    return str(path)
