"""
Data Preprocessor — Dataset Splitting & DataLoader Creation
============================================================
Scans the data directory, performs stratified train/val/test split,
and returns PyTorch DataLoaders ready for training.
"""

import os
import sys
import random
import shutil
import logging
from pathlib import Path
from collections import Counter

import torch
from torch.utils.data import DataLoader

# Add parent to path for config import
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))
import config
from dev.data_prep.dataset import ParkingDataset

logger = logging.getLogger("berth.preprocessor")


def build_classify_split(
    source_labeled_dir=None,
    out_dir=None,
    train_ratio=None,
    val_ratio=None,
    seed=42,
    force=False,
):
    """
    Build a persistent train/val/test classifier dataset on disk, split BY SOURCE
    FRAME so that all crops from one source photo land in the same split (prevents
    near-duplicate leakage across splits).

    Source layout (read-only):
        source_labeled_dir/<lot>/crops/{occupied,vacant}/*.jpg
    Output layout:
        out_dir/{train,val,test}/{occupied,vacant}/<lot>__<cropname>.jpg

    Crops are COPIED (shutil.copy2), never moved — the source crops/ folders stay
    intact. Returns out_dir.
    """
    source_labeled_dir = Path(source_labeled_dir) if source_labeled_dir else (config.DATA_DIR / "labeled")
    out_dir     = Path(out_dir) if out_dir else config.CLASSIFY_SPLIT_DIR
    train_ratio = train_ratio if train_ratio is not None else config.TRAIN_SPLIT
    val_ratio   = val_ratio   if val_ratio   is not None else config.VAL_SPLIT

    # -------------------------------------------------------------------
    # Idempotency
    # -------------------------------------------------------------------
    sentinel = out_dir / "train" / "occupied"
    if out_dir.exists() and sentinel.is_dir() and any(sentinel.iterdir()) and not force:
        logger.info(f"📁 Classify split already exists at {out_dir} — skipping build.")
        return out_dir
    if force and out_dir.exists():
        logger.info(f"🗑️  force=True — removing existing {out_dir}")
        shutil.rmtree(out_dir)

    # -------------------------------------------------------------------
    # 1. Scan every lot for crops
    # -------------------------------------------------------------------
    samples = []  # (frame_key, bucket, src_path)
    for lot_dir in sorted(source_labeled_dir.iterdir()):
        crops_dir = lot_dir / "crops"
        if not crops_dir.is_dir():
            continue
        lot = lot_dir.name
        for bucket in ("occupied", "vacant"):
            bucket_dir = crops_dir / bucket
            if not bucket_dir.is_dir():
                continue
            for img_path in sorted(bucket_dir.iterdir()):
                if img_path.suffix.lower() not in ('.jpg', '.jpeg', '.png', '.bmp'):
                    continue
                frame_key = (lot, img_path.stem.rsplit("__roi", 1)[0])
                samples.append((frame_key, bucket, img_path))

    if not samples:
        raise FileNotFoundError(
            f"No crops found under {source_labeled_dir}. "
            f"Expected <lot>/crops/{{occupied,vacant}}/*.jpg."
        )

    # -------------------------------------------------------------------
    # 2. Frame-level split (deterministic)
    # -------------------------------------------------------------------
    frames = sorted({fk for fk, _, _ in samples})
    random.Random(seed).shuffle(frames)
    n = len(frames)
    n_train = int(n * train_ratio)
    n_val   = int(n * val_ratio)
    train_frames = set(frames[:n_train])
    val_frames   = set(frames[n_train:n_train + n_val])
    test_frames  = set(frames[n_train + n_val:])

    # Sanity: the three frame-sets must be pairwise disjoint
    assert train_frames.isdisjoint(val_frames),  "train/val frames overlap"
    assert train_frames.isdisjoint(test_frames), "train/test frames overlap"
    assert val_frames.isdisjoint(test_frames),   "val/test frames overlap"

    split_of = {}
    for fk in train_frames:
        split_of[fk] = "train"
    for fk in val_frames:
        split_of[fk] = "val"
    for fk in test_frames:
        split_of[fk] = "test"

    # -------------------------------------------------------------------
    # 3. Copy crops into split layout
    # -------------------------------------------------------------------
    counts = {s: {"occupied": 0, "vacant": 0} for s in ("train", "val", "test")}
    for frame_key, bucket, src_path in samples:
        split = split_of[frame_key]
        lot = frame_key[0]
        dst_dir = out_dir / split / bucket
        dst_dir.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src_path, dst_dir / f"{lot}__{src_path.name}")
        counts[split][bucket] += 1

    # -------------------------------------------------------------------
    # 4. Report
    # -------------------------------------------------------------------
    total = 0
    for split in ("train", "val", "test"):
        occ, vac = counts[split]["occupied"], counts[split]["vacant"]
        total += occ + vac
        logger.info(f"   {split:5s} — occupied: {occ}, vacant: {vac}, total: {occ + vac}")
    logger.info(f"✅ Classify split built at {out_dir} — {len(frames)} frames, {total} crops")

    return out_dir


def build_classify_subset(subset_size=None, seed=42, force=False):
    """
    Materialize a class-balanced, size-capped copy of the classify split for
    Ultralytics classification training.

    The PyTorch classifiers cap the dataset at config.SUBSET_SIZE in memory (see
    prepare_dataset), training on ~500 batches. Ultralytics reads an ImageFolder
    directory wholesale — its `fraction` arg truncates the class-ordered sample
    list and would drop an entire class — so we bake the same cap onto disk and
    point YOLO at this directory instead.

    Mirrors prepare_dataset's cap: each split is trimmed proportionally toward
    subset_size and balanced 50/50 between occupied/vacant. Returns the subset
    dir, or the full split dir when no cap applies.
    """
    subset_size = subset_size if subset_size is not None else config.SUBSET_SIZE
    src_dir = config.CLASSIFY_SPLIT_DIR
    out_dir = config.CLASSIFY_SUBSET_DIR

    if not subset_size or subset_size <= 0:
        return src_dir

    # -------------------------------------------------------------------
    # 1. Gather per-split file lists and the full total
    # -------------------------------------------------------------------
    split_files = {}  # split -> {"occupied": [...], "vacant": [...]}
    total = 0
    for split in ("train", "val", "test"):
        buckets = {}
        for bucket in ("occupied", "vacant"):
            d = src_dir / split / bucket
            files = [f for f in d.iterdir() if f.is_file()] if d.is_dir() else []
            buckets[bucket] = files
            total += len(files)
        split_files[split] = buckets

    if total == 0:
        raise FileNotFoundError(
            f"No crops found under {src_dir}; run build_classify_split first."
        )
    if subset_size >= total:
        logger.info(f"Subset cap {subset_size} ≥ {total} crops — using full split {src_dir}.")
        return src_dir

    # -------------------------------------------------------------------
    # 2. Idempotency
    # -------------------------------------------------------------------
    sentinel = out_dir / "train" / "occupied"
    if out_dir.exists() and sentinel.is_dir() and any(sentinel.iterdir()) and not force:
        logger.info(f"📁 Classify subset already exists at {out_dir} — skipping build.")
        return out_dir
    if out_dir.exists():
        logger.info(f"🗑️  Rebuilding classify subset — removing existing {out_dir}")
        shutil.rmtree(out_dir)

    # -------------------------------------------------------------------
    # 3. Copy a proportional, class-balanced slice of each split
    # -------------------------------------------------------------------
    frac = subset_size / total
    rng = random.Random(seed)
    for split in ("train", "val", "test"):
        occ = split_files[split]["occupied"]
        vac = split_files[split]["vacant"]
        target = max(2, int((len(occ) + len(vac)) * frac))
        per = min(target // 2, len(occ), len(vac))
        chosen = {"occupied": rng.sample(occ, per), "vacant": rng.sample(vac, per)}
        for bucket, files in chosen.items():
            dst = out_dir / split / bucket
            dst.mkdir(parents=True, exist_ok=True)
            for f in files:
                shutil.copy2(f, dst / f.name)
        logger.info(f"   {split:5s} — {per} occupied + {per} vacant")
    logger.info(f"✅ Classify subset built at {out_dir} — cap {subset_size} of {total}, class-balanced 50/50")

    return out_dir


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
    data_root   = data_root   or str(config.CLASSIFY_SPLIT_DIR)
    train_ratio = train_ratio or config.TRAIN_SPLIT
    val_ratio   = val_ratio   or config.VAL_SPLIT
    batch_size  = batch_size  or config.BATCH_SIZE
    # Windows + DataLoader multiprocessing deadlocks inside daemon threads (spawn context
    # tries to re-import the main module which restarts uvicorn). Force single-process loading.
    if num_workers is None:
        num_workers = 0 if os.name == "nt" else config.NUM_WORKERS
    pin_memory = torch.cuda.is_available()
    image_size  = image_size  or config.CNN_INPUT_SIZE
    subset_size = subset_size if subset_size is not None else config.SUBSET_SIZE

    logger.info(f"📂 Scanning dataset at: {data_root}")

    # -------------------------------------------------------------------
    # Pre-split layout: data_root/{train,val,test}/{occupied,vacant}.
    # The persistent frame-level classify split (default path). Each split is
    # already a fixed set on disk, so we load them directly instead of
    # re-splitting in memory.
    # -------------------------------------------------------------------
    data_root_path = Path(data_root)
    has_presplit = (data_root_path / "train").is_dir() and (data_root_path / "val").is_dir()
    if has_presplit or data_root_path == config.CLASSIFY_SPLIT_DIR:
        if not has_presplit:
            logger.info(f"🏗️  Pre-split dataset not found at {data_root_path} — building it…")
            build_classify_split()

        train_dataset = ParkingDataset(data_root=data_root_path / "train", split="train", image_size=image_size)
        val_dataset   = ParkingDataset(data_root=data_root_path / "val",   split="val",   image_size=image_size)
        test_dir = data_root_path / "test"
        test_dataset  = ParkingDataset(data_root=test_dir, split="test", image_size=image_size) if test_dir.is_dir() else val_dataset

        # Subset cap — the on-the-fly split path applies SUBSET_SIZE to the full
        # pool before splitting; mirror that here so the cap also works on the
        # default pre-split path (otherwise it trains on the entire dataset).
        # Each split is trimmed toward subset_size by its proportional share, and
        # within each split the two classes are balanced 50/50 — this also
        # corrects the ~1.7:1 occupied:vacant imbalance in the full set. Safe to
        # mutate .samples now: it's before any DataLoader iteration, so the
        # lazily-filled index cache is still empty.
        if subset_size and subset_size > 0:
            total = len(train_dataset) + len(val_dataset) + len(test_dataset)
            if subset_size < total:
                random.seed(seed)
                frac = subset_size / total
                for ds in (train_dataset, val_dataset, test_dataset):
                    target = max(2, int(len(ds.samples) * frac))
                    occ = [s for s in ds.samples if s[1] == 1]
                    vac = [s for s in ds.samples if s[1] == 0]
                    per = min(target // 2, len(occ), len(vac))
                    ds.samples = random.sample(occ, per) + random.sample(vac, per)
                    random.shuffle(ds.samples)
                logger.info(f"🔽 Subset cap {subset_size} (of {total}), class-balanced 50/50 → "
                            f"train {len(train_dataset)}, val {len(val_dataset)}, test {len(test_dataset)}")

        train_loader = DataLoader(
            train_dataset,
            batch_size=batch_size,
            shuffle=True,
            num_workers=num_workers,
            pin_memory=pin_memory,
            drop_last=True,
        )
        val_loader = DataLoader(
            val_dataset,
            batch_size=batch_size,
            shuffle=False,
            num_workers=num_workers,
            pin_memory=pin_memory,
        )
        test_loader = DataLoader(
            test_dataset,
            batch_size=batch_size,
            shuffle=False,
            num_workers=num_workers,
            pin_memory=pin_memory,
        )

        all_labels = (
            [lbl for _, lbl in train_dataset.samples]
            + [lbl for _, lbl in val_dataset.samples]
            + [lbl for _, lbl in test_dataset.samples]
        )
        class_counts = Counter(all_labels)

        logger.info(f"✂️  Pre-split sizes — Train: {len(train_dataset)}, "
                    f"Val: {len(val_dataset)}, Test: {len(test_dataset)}")
        logger.info(f"✅ DataLoaders ready — "
                    f"Train batches: {len(train_loader)}, "
                    f"Val batches: {len(val_loader)}, "
                    f"Test batches: {len(test_loader)}")

        return {
            "train_loader": train_loader,
            "val_loader":   val_loader,
            "test_loader":  test_loader,
            "train_size":   len(train_dataset),
            "val_size":     len(val_dataset),
            "test_size":    len(test_dataset),
            "class_distribution": {
                "occupied": class_counts.get(1, 0),
                "vacant":   class_counts.get(0, 0),
            },
        }

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
    occupied = [(p, lbl) for p, lbl in all_samples if lbl == 1]
    vacant   = [(p, lbl) for p, lbl in all_samples if lbl == 0]

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
        pin_memory=pin_memory,
        drop_last=True,
    )
    val_loader = DataLoader(
        val_dataset,
        batch_size=batch_size,
        shuffle=False,
        num_workers=num_workers,
        pin_memory=pin_memory,
    )
    test_loader = DataLoader(
        test_dataset,
        batch_size=batch_size,
        shuffle=False,
        num_workers=num_workers,
        pin_memory=pin_memory,
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
