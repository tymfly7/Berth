"""
Data Preprocessor — Dataset Splitting & DataLoader Creation
============================================================
Scans the data directory, performs stratified train/val/test split,
and returns PyTorch DataLoaders ready for training.
"""

import sys
import random
import logging
from pathlib import Path
from collections import Counter

from torch.utils.data import DataLoader

# Add parent to path for config import
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))
import config
from src.data_prep.dataset import ParkingDataset

logger = logging.getLogger("berth.preprocessor")


def prepare_dataset(
    data_root=None,
    train_ratio=None,
    val_ratio=None,
    batch_size=None,
    num_workers=None,
    image_size=None,
    subset_size=None,
    seed=42,
):
    """
    Prepare train/val/test DataLoaders from the parking dataset.

    Args:
        data_root (str): Path to directory with occupied/ and vacant/ folders.
                         Defaults to config.DATA_DIR.
        train_ratio (float): Fraction for training. Default from config.
        val_ratio (float): Fraction for validation. Default from config.
        batch_size (int): Batch size. Default from config.
        num_workers (int): DataLoader workers. Default from config.
        image_size (int): Image resize target. Default from config.
        subset_size (int): If > 0, randomly sample this many images total.
        seed (int): Random seed for reproducibility.

    Returns:
        dict: {
            "train_loader": DataLoader,
            "val_loader": DataLoader,
            "test_loader": DataLoader,
            "train_size": int,
            "val_size": int,
            "test_size": int,
            "class_distribution": dict,
        }
    """
    # Defaults from config
    data_root   = data_root   or str(config.DATA_DIR)
    train_ratio = train_ratio or config.TRAIN_SPLIT
    val_ratio   = val_ratio   or config.VAL_SPLIT
    batch_size  = batch_size  or config.BATCH_SIZE
    num_workers = num_workers if num_workers is not None else config.NUM_WORKERS
    image_size  = image_size  or config.CNN_INPUT_SIZE
    subset_size = subset_size if subset_size is not None else config.SUBSET_SIZE

    logger.info(f"📂 Scanning dataset at: {data_root}")

    # -------------------------------------------------------------------
    # 1. Collect all samples
    # -------------------------------------------------------------------
    temp_dataset = ParkingDataset(data_root=data_root, split="test", image_size=image_size)
    all_samples = temp_dataset.samples  # list of (path, label)

    logger.info(f"📊 Total images found: {len(all_samples)}")

    # Class distribution
    labels = [label for _, label in all_samples]
    class_counts = Counter(labels)
    logger.info(f"   Occupied (1): {class_counts.get(1, 0)}")
    logger.info(f"   Vacant   (0): {class_counts.get(0, 0)}")

    # -------------------------------------------------------------------
    # 2. Optional subset
    # -------------------------------------------------------------------
    if subset_size and subset_size > 0 and subset_size < len(all_samples):
        random.seed(seed)
        all_samples = random.sample(all_samples, subset_size)
        logger.info(f"🔽 Using subset of {subset_size} images")

    # -------------------------------------------------------------------
    # 3. Stratified split
    # -------------------------------------------------------------------
    occupied = [(p, l) for p, l in all_samples if l == 1]
    vacant   = [(p, l) for p, l in all_samples if l == 0]

    random.seed(seed)
    random.shuffle(occupied)
    random.shuffle(vacant)

    def split_list(data, train_r, val_r):
        """Split a list into train/val/test by ratios."""
        n = len(data)
        n_train = int(n * train_r)
        n_val   = int(n * val_r)
        return data[:n_train], data[n_train:n_train+n_val], data[n_train+n_val:]

    occ_train, occ_val, occ_test = split_list(occupied, train_ratio, val_ratio)
    vac_train, vac_val, vac_test = split_list(vacant, train_ratio, val_ratio)

    train_files = occ_train + vac_train
    val_files   = occ_val   + vac_val
    test_files  = occ_test  + vac_test

    # Shuffle within splits
    random.shuffle(train_files)
    random.shuffle(val_files)
    random.shuffle(test_files)

    logger.info(f"✂️  Split sizes — Train: {len(train_files)}, "
                f"Val: {len(val_files)}, Test: {len(test_files)}")

    # -------------------------------------------------------------------
    # 4. Create Datasets
    # -------------------------------------------------------------------
    train_dataset = ParkingDataset(
        file_list=train_files, split="train", image_size=image_size
    )
    val_dataset = ParkingDataset(
        file_list=val_files, split="val", image_size=image_size
    )
    test_dataset = ParkingDataset(
        file_list=test_files, split="test", image_size=image_size
    )

    # -------------------------------------------------------------------
    # 5. Create DataLoaders
    # -------------------------------------------------------------------
    train_loader = DataLoader(
        train_dataset,
        batch_size=batch_size,
        shuffle=True,
        num_workers=num_workers,
        pin_memory=True,
        drop_last=True,
    )
    val_loader = DataLoader(
        val_dataset,
        batch_size=batch_size,
        shuffle=False,
        num_workers=num_workers,
        pin_memory=True,
    )
    test_loader = DataLoader(
        test_dataset,
        batch_size=batch_size,
        shuffle=False,
        num_workers=num_workers,
        pin_memory=True,
    )

    logger.info(f"✅ DataLoaders ready — "
                f"Train batches: {len(train_loader)}, "
                f"Val batches: {len(val_loader)}, "
                f"Test batches: {len(test_loader)}")

    return {
        "train_loader": train_loader,
        "val_loader":   val_loader,
        "test_loader":  test_loader,
        "train_size":   len(train_files),
        "val_size":     len(val_files),
        "test_size":    len(test_files),
        "class_distribution": {
            "occupied": class_counts.get(1, 0),
            "vacant":   class_counts.get(0, 0),
        },
    }
