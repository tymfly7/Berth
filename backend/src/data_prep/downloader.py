"""
PKLot Dataset Downloader & Organizer
=====================================
Downloads the PKLot dataset and organizes it into the expected
occupied/vacant directory structure for training.

The PKLot dataset contains images from 3 parking lots:
    - PUC (Pontifical Catholic University)
    - UFPR04 (Federal University of Paraná - Lot 04)
    - UFPR05 (Federal University of Paraná - Lot 05)

Each image is a cropped parking space, pre-labeled as Occupied or Empty.
"""

import os
import sys
import shutil
import logging
from pathlib import Path
from tqdm import tqdm

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))
import config

logger = logging.getLogger("berth.downloader")


def organize_pklot(source_root=None, target_root=None, max_per_class=0,):
    """
    Organize PKLot dataset into a flat occupied/vacant structure.

    The PKLot segmented dataset has structure:
        PKLotSegmented/
            PUC/
                Cloudy/
                    2012-09-12/
                        Occupied/
                            *.jpg
                        Empty/
                            *.jpg
                Rainy/
                    ...
                Sunny/
                    ...
            UFPR04/
                ...
            UFPR05/
                ...

    This function flattens it into:
        target_root/
            occupied/
                PUC_Cloudy_2012-09-12_001.jpg
                ...
            vacant/
                PUC_Cloudy_2012-09-12_001.jpg
                ...

    Args:
        source_root (str): Path to PKLotSegmented directory
        target_root (str): Path to output directory (default: config.DATA_DIR)
        max_per_class (int): Max images per class (0 = unlimited)

    Returns:
        dict: {"occupied": count, "vacant": count}
    """
    source_root = Path(source_root or config.PKLOT_ROOT)
    target_root = Path(target_root or config.DATA_DIR)

    occ_dir = target_root / "occupied"
    vac_dir = target_root / "vacant"
    occ_dir.mkdir(parents=True, exist_ok=True)
    vac_dir.mkdir(parents=True, exist_ok=True)

    logger.info(f"📂 Scanning PKLot source: {source_root}")

    if not source_root.exists():
        logger.error(f"❌ Source directory not found: {source_root}")
        logger.info(
            "💡 Download the PKLot dataset from:\n"
            "   https://www.kaggle.com/datasets/blanderbuss/parking-lot-dataset\n"
            "   \n"
            "   Then set PKLOT_ROOT environment variable or edit config.py:\n"
            f"   PKLOT_ROOT = 'path/to/PKLotSegmented'\n"
        )
        return {"occupied": 0, "vacant": 0}

    # Collect all image paths with their labels
    occupied_images = []
    vacant_images = []

    # Walk through the PKLot directory structure
    for lot_dir in sorted(source_root.iterdir()):
        if not lot_dir.is_dir():
            continue
        lot_name = lot_dir.name  # PUC, UFPR04, UFPR05

        for weather_dir in sorted(lot_dir.iterdir()):
            if not weather_dir.is_dir():
                continue
            weather = weather_dir.name  # Cloudy, Rainy, Sunny

            for date_dir in sorted(weather_dir.iterdir()):
                if not date_dir.is_dir():
                    continue
                date = date_dir.name

                # Look for Occupied and Empty subdirectories
                occ_src = date_dir / "Occupied"
                emp_src = date_dir / "Empty"

                if occ_src.exists():
                    for img in occ_src.iterdir():
                        if img.suffix.lower() in ('.jpg', '.jpeg', '.png'):
                            occupied_images.append((img, f"{lot_name}_{weather}_{date}_{img.name}"))

                if emp_src.exists():
                    for img in emp_src.iterdir():
                        if img.suffix.lower() in ('.jpg', '.jpeg', '.png'):
                            vacant_images.append((img, f"{lot_name}_{weather}_{date}_{img.name}"))

    logger.info(f"   Found {len(occupied_images)} occupied, {len(vacant_images)} vacant images")

    # Apply max_per_class limit
    if max_per_class > 0:
        occupied_images = occupied_images[:max_per_class]
        vacant_images = vacant_images[:max_per_class]
        logger.info(f"   Limited to {max_per_class} per class")

    # Copy files
    occ_count = 0
    for src_path, dest_name in tqdm(occupied_images, desc="Copying occupied"):
        dest = occ_dir / dest_name
        if not dest.exists():
            shutil.copy2(src_path, dest)
        occ_count += 1

    vac_count = 0
    for src_path, dest_name in tqdm(vacant_images, desc="Copying vacant"):
        dest = vac_dir / dest_name
        if not dest.exists():
            shutil.copy2(src_path, dest)
        vac_count += 1

    logger.info(f"✅ Dataset organized: {occ_count} occupied, {vac_count} vacant")
    return {"occupied": occ_count, "vacant": vac_count}


def generate_sample_dataset(target_root=None, num_per_class=100):
    """
    Generate a tiny synthetic dataset for testing/demo purposes.
    Creates random colored squares to simulate occupied (dark) and vacant (light) spaces.

    Args:
        target_root (str): Output directory
        num_per_class (int): Number of images per class
    """
    from PIL import Image, ImageDraw
    import random

    target_root = Path(target_root or config.DATA_DIR)
    occ_dir = target_root / "occupied"
    vac_dir = target_root / "vacant"
    occ_dir.mkdir(parents=True, exist_ok=True)
    vac_dir.mkdir(parents=True, exist_ok=True)

    logger.info(f"🎨 Generating {num_per_class} synthetic images per class...")

    for i in range(num_per_class):
        # Occupied: darker images with rectangle shapes (simulating car)
        img = Image.new("RGB", (224, 224), (
            random.randint(40, 100),
            random.randint(40, 100),
            random.randint(40, 100),
        ))
        draw = ImageDraw.Draw(img)
        # Draw a "car" shape
        x1 = random.randint(20, 60)
        y1 = random.randint(20, 60)
        x2 = random.randint(140, 200)
        y2 = random.randint(140, 200)
        car_color = (
            random.randint(60, 180),
            random.randint(60, 180),
            random.randint(60, 180),
        )
        draw.rectangle([x1, y1, x2, y2], fill=car_color)
        img.save(occ_dir / f"synth_occ_{i:04d}.jpg")

        # Vacant: lighter images with simple ground texture
        img = Image.new("RGB", (224, 224), (
            random.randint(150, 220),
            random.randint(150, 220),
            random.randint(150, 220),
        ))
        draw = ImageDraw.Draw(img)
        # Draw parking lines
        line_color = (255, 255, 255)
        draw.line([(10, 0), (10, 224)], fill=line_color, width=3)
        draw.line([(214, 0), (214, 224)], fill=line_color, width=3)
        img.save(vac_dir / f"synth_vac_{i:04d}.jpg")

    logger.info(f"✅ Synthetic dataset generated: {num_per_class} per class")


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s  %(levelname)-8s  %(message)s")

    import argparse
    parser = argparse.ArgumentParser(description="PKLot Dataset Organizer")
    parser.add_argument("--source", type=str, default=None,
                        help="Path to PKLotSegmented directory")
    parser.add_argument("--target", type=str, default=None,
                        help="Output directory (default: backend/data/)")
    parser.add_argument("--max-per-class", type=int, default=0,
                        help="Max images per class (0 = all)")
    parser.add_argument("--generate-sample", action="store_true",
                        help="Generate synthetic sample dataset instead")
    parser.add_argument("--sample-count", type=int, default=200,
                        help="Number of synthetic images per class")
    args = parser.parse_args()

    if args.generate_sample:
        generate_sample_dataset(
            target_root=args.target,
            num_per_class=args.sample_count
        )
    else:
        organize_pklot(
            source_root=args.source,
            target_root=args.target,
            max_per_class=args.max_per_class,
        )
