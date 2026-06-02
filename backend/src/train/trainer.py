"""
Trainer — Training Loop with Early Stopping & LR Scheduling
=============================================================
Handles the complete training pipeline:
    1. Training loop with BCE loss + Adam optimizer
    2. Early stopping (monitors val_loss)
    3. ReduceLROnPlateau learning rate scheduler
    4. Best model checkpointing
    5. Training history logging + plot generation
"""

import sys
import json
import time
import logging
from pathlib import Path

import torch
import torch.nn as nn
import torch.optim as optim
import matplotlib
matplotlib.use("Agg")  # Non-interactive backend for server use
import matplotlib.pyplot as plt

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))
import config

logger = logging.getLogger("berth.trainer")


class EarlyStopping:
    """
    Stop training when validation loss stops improving.

    Args:
        patience (int): Number of epochs to wait after last improvement
        min_delta (float): Minimum change to qualify as improvement
    """

    def __init__(self, patience=7, min_delta=0.001):
        self.patience = patience
        self.min_delta = min_delta
        self.counter = 0
        self.best_loss = None
        self.should_stop = False

    def __call__(self, val_loss):
        if self.best_loss is None:
            self.best_loss = val_loss
        elif val_loss < self.best_loss - self.min_delta:
            self.best_loss = val_loss
            self.counter = 0
        else:
            self.counter += 1
            if self.counter >= self.patience:
                self.should_stop = True
                logger.info(
                    f"⏹️  Early stopping triggered after {self.patience} epochs "
                    f"without improvement (best val_loss: {self.best_loss:.4f})"
                )
        return self.should_stop


class Trainer:
    """
    Complete training pipeline for parking space classifier.

    Args:
        model (nn.Module): Model to train
        model_name (str): Name for saving (e.g., 'cnn_scratch')
        device: Training device (auto-detected if None)
        learning_rate (float): Initial learning rate
        weight_decay (float): L2 regularization
        epochs (int): Maximum training epochs
        early_stop_patience (int): Early stopping patience
        lr_patience (int): LR scheduler patience
        lr_factor (float): LR reduction factor
    """

    def __init__(
        self,
        model,
        model_name="model",
        device=None,
        learning_rate=None,
        weight_decay=None,
        epochs=None,
        early_stop_patience=None,
        lr_patience=None,
        lr_factor=None,
    ):
        self.model = model
        self.model_name = model_name
        self.device = device or torch.device("cuda" if torch.cuda.is_available() else "cpu")
        self.model.to(self.device)

        # Hyperparameters (defaults from config)
        self.learning_rate = learning_rate or config.LEARNING_RATE
        self.weight_decay  = weight_decay  or config.WEIGHT_DECAY
        self.epochs        = epochs        or config.EPOCHS
        self.early_stop_patience = early_stop_patience or config.EARLY_STOP_PATIENCE
        self.lr_patience   = lr_patience   or config.LR_SCHEDULER_PATIENCE
        self.lr_factor     = lr_factor     or config.LR_SCHEDULER_FACTOR

        # Loss function: BCEWithLogitsLoss — fuses sigmoid + BCE for numerical stability
        self.criterion = nn.BCEWithLogitsLoss()

        # Optimizer: Adam with weight decay (L2 regularization)
        self.optimizer = optim.Adam(
            filter(lambda p: p.requires_grad, self.model.parameters()),
            lr=self.learning_rate,
            weight_decay=self.weight_decay,
        )

        # Learning rate scheduler
        self.scheduler = optim.lr_scheduler.ReduceLROnPlateau(
            self.optimizer,
            mode="min",
            patience=self.lr_patience,
            factor=self.lr_factor,
        )

        # Early stopping
        self.early_stopping = EarlyStopping(patience=self.early_stop_patience)

        # Training history
        self.history = {
            "train_loss": [],
            "val_loss": [],
            "train_acc": [],
            "val_acc": [],
            "learning_rates": [],
            "epoch_times": [],
        }

        # Best model tracking
        self.best_val_loss = float("inf")
        self.best_val_acc = 0.0
        self.best_epoch = 0

        logger.info(f"🔧 Trainer initialized:")
        logger.info(f"   Model: {model_name}")
        logger.info(f"   Device: {self.device}")
        logger.info(f"   LR: {self.learning_rate}, Weight Decay: {self.weight_decay}")
        logger.info(f"   Max Epochs: {self.epochs}")
        logger.info(f"   Early Stop Patience: {self.early_stop_patience}")
        params = model.count_parameters()
        logger.info(f"   Parameters: {params['total']:,} total, {params['trainable']:,} trainable")

    def train(self, train_loader, val_loader, progress_callback=None):
        """
        Run the full training loop.

        Args:
            train_loader: Training DataLoader
            val_loader: Validation DataLoader
            progress_callback: Optional callable(epoch, metrics_dict) for progress updates

        Returns:
            dict: Training results including best metrics and history
        """
        logger.info(f"\n{'='*60}")
        logger.info(f"🚀 Starting training: {self.model_name}")
        logger.info(f"{'='*60}")

        total_start = time.time()

        for epoch in range(1, self.epochs + 1):
            epoch_start = time.time()

            # --- Train one epoch ---
            train_loss, train_acc = self._train_epoch(train_loader)

            # --- Validate ---
            val_loss, val_acc = self._validate(val_loader)

            # --- LR Scheduler step ---
            current_lr = self.optimizer.param_groups[0]["lr"]
            self.scheduler.step(val_loss)

            # --- Record history ---
            epoch_time = time.time() - epoch_start
            self.history["train_loss"].append(train_loss)
            self.history["val_loss"].append(val_loss)
            self.history["train_acc"].append(train_acc)
            self.history["val_acc"].append(val_acc)
            self.history["learning_rates"].append(current_lr)
            self.history["epoch_times"].append(epoch_time)

            # --- Log ---
            logger.info(
                f"Epoch [{epoch:02d}/{self.epochs}]  "
                f"Train Loss: {train_loss:.4f}  Acc: {train_acc:.2f}%  |  "
                f"Val Loss: {val_loss:.4f}  Acc: {val_acc:.2f}%  |  "
                f"LR: {current_lr:.2e}  |  Time: {epoch_time:.1f}s"
            )

            # --- Save best model ---
            if val_loss < self.best_val_loss:
                self.best_val_loss = val_loss
                self.best_val_acc = val_acc
                self.best_epoch = epoch
                self._save_best_model()
                logger.info(f"   💾 New best model saved! (val_loss: {val_loss:.4f})")

            # --- Progress callback ---
            if progress_callback:
                progress_callback(epoch, {
                    "train_loss": train_loss,
                    "val_loss": val_loss,
                    "train_acc": train_acc,
                    "val_acc": val_acc,
                    "lr": current_lr,
                    "epoch_time": epoch_time,
                    "best_val_loss": self.best_val_loss,
                    "best_val_acc": self.best_val_acc,
                })

            # --- Early stopping check ---
            if self.early_stopping(val_loss):
                break

        total_time = time.time() - total_start

        # Save training history and plots
        self._save_history()
        self._plot_curves()

        results = {
            "model_name": self.model_name,
            "best_epoch": self.best_epoch,
            "best_val_loss": self.best_val_loss,
            "best_val_acc": self.best_val_acc,
            "total_epochs": len(self.history["train_loss"]),
            "total_time_seconds": total_time,
            "device": str(self.device),
        }

        logger.info(f"\n{'='*60}")
        logger.info(f"✅ Training complete!")
        logger.info(f"   Best epoch: {self.best_epoch}")
        logger.info(f"   Best val_loss: {self.best_val_loss:.4f}")
        logger.info(f"   Best val_acc: {self.best_val_acc:.2f}%")
        logger.info(f"   Total time: {total_time:.1f}s")
        logger.info(f"{'='*60}\n")

        return results

    def _train_epoch(self, loader):
        """Train for one epoch. Returns (loss, accuracy)."""
        self.model.train()
        running_loss = 0.0
        correct = 0
        total = 0

        for images, labels in loader:
            images = images.to(self.device)
            labels = labels.to(self.device).float().unsqueeze(1)

            # Forward pass
            outputs = self.model(images)
            loss = self.criterion(outputs, labels)

            # Backward pass
            self.optimizer.zero_grad()
            loss.backward()
            self.optimizer.step()

            # Track metrics
            running_loss += loss.item() * images.size(0)
            predicted = (outputs > 0.5).float()
            correct += (predicted == labels).sum().item()
            total += labels.size(0)

        avg_loss = running_loss / total
        accuracy = 100.0 * correct / total
        return avg_loss, accuracy

    @torch.no_grad()
    def _validate(self, loader):
        """Validate the model. Returns (loss, accuracy)."""
        self.model.eval()
        running_loss = 0.0
        correct = 0
        total = 0

        for images, labels in loader:
            images = images.to(self.device)
            labels = labels.to(self.device).float().unsqueeze(1)

            outputs = self.model(images)
            loss = self.criterion(outputs, labels)

            running_loss += loss.item() * images.size(0)
            predicted = (outputs > 0.5).float()
            correct += (predicted == labels).sum().item()
            total += labels.size(0)

        avg_loss = running_loss / total
        accuracy = 100.0 * correct / total
        return avg_loss, accuracy

    def _save_best_model(self):
        """Save the current model weights as the best checkpoint."""
        from src.models.model_factory import get_model_path
        save_path = get_model_path(self.model_name) or (
            config.MODEL_DIR / f"best_{self.model_name}.pth"
        )
        torch.save(self.model.state_dict(), save_path)

    def _save_history(self):
        """Save training history to JSON."""
        history_path = config.OUTPUT_DIR / f"history_{self.model_name}.json"
        with open(history_path, "w") as f:
            json.dump(self.history, f, indent=2)
        logger.info(f"📊 Training history saved to {history_path}")

    def _plot_curves(self):
        """Generate and save training/validation loss and accuracy curves."""
        epochs = range(1, len(self.history["train_loss"]) + 1)

        fig, axes = plt.subplots(1, 3, figsize=(18, 5))
        fig.suptitle(f"Training Curves — {self.model_name}", fontsize=14, fontweight="bold")

        # --- Loss ---
        axes[0].plot(epochs, self.history["train_loss"], "b-o", label="Train Loss", markersize=3)
        axes[0].plot(epochs, self.history["val_loss"], "r-o", label="Val Loss", markersize=3)
        axes[0].axvline(x=self.best_epoch, color="green", linestyle="--", alpha=0.5, label=f"Best (epoch {self.best_epoch})")
        axes[0].set_xlabel("Epoch")
        axes[0].set_ylabel("Loss")
        axes[0].set_title("Loss")
        axes[0].legend()
        axes[0].grid(True, alpha=0.3)

        # --- Accuracy ---
        axes[1].plot(epochs, self.history["train_acc"], "b-o", label="Train Acc", markersize=3)
        axes[1].plot(epochs, self.history["val_acc"], "r-o", label="Val Acc", markersize=3)
        axes[1].axvline(x=self.best_epoch, color="green", linestyle="--", alpha=0.5, label=f"Best (epoch {self.best_epoch})")
        axes[1].set_xlabel("Epoch")
        axes[1].set_ylabel("Accuracy (%)")
        axes[1].set_title("Accuracy")
        axes[1].legend()
        axes[1].grid(True, alpha=0.3)

        # --- Learning Rate ---
        axes[2].plot(epochs, self.history["learning_rates"], "g-o", markersize=3)
        axes[2].set_xlabel("Epoch")
        axes[2].set_ylabel("Learning Rate")
        axes[2].set_title("Learning Rate Schedule")
        axes[2].set_yscale("log")
        axes[2].grid(True, alpha=0.3)

        plt.tight_layout()
        plot_path = config.OUTPUT_DIR / f"curves_{self.model_name}.png"
        plt.savefig(plot_path, dpi=150, bbox_inches="tight")
        plt.close()
        logger.info(f"📈 Training curves saved to {plot_path}")
