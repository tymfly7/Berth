"""
Parking Dataset — PyTorch Dataset Class
=======================================
Loads individual parking space images (occupied/vacant) with augmentation.

The dataset contains cropped images of individual parking spaces (e.g. the
lot-t10lot crops from parking-lot-t10). Each image is labeled as either
"occupied" or "vacant" (empty).

Labels:
    0 = Vacant  (empty parking space)
    1 = Occupied (car present)
"""

import random
import sys
from pathlib import Path
from PIL import Image, ImageEnhance

import torch
from torch.utils.data import Dataset
from torchvision import transforms

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))
import config


class _RandomDetail:
    """Randomly soften or sharpen a crop.

    The t10lot crops carry a texture-energy cue that tracks the label: occupied
    crops hold ~6x the high-frequency energy of vacant ones (Laplacian variance at
    224 px, median 162 vs 28). A from-scratch CNN learns that edge density instead
    of shape, and the cue does not survive a change of camera, stream resolution or
    lighting — on the Krom feed a vacant bay holding painted chevrons or a hard
    shadow edge reads as occupied. Randomising detail per sample makes it unusable.
    """

    def __call__(self, img):
        r = random.random()
        if r < 0.4:                      # soften — simulate a lower-resolution source
            f = random.uniform(0.35, 1.0)
            small = (max(8, int(img.width * f)), max(8, int(img.height * f)))
            return img.resize(small, Image.BILINEAR).resize(img.size, Image.BILINEAR)
        if r < 0.8:                      # sharpen — simulate a sharper/contrastier camera
            return ImageEnhance.Sharpness(img).enhance(random.uniform(1.5, 8.0))
        return img


class ParkingDataset(Dataset):
    """
    PyTorch Dataset for parking space classification.

    Expects directory structure:
        data_root/
            occupied/
                img001.jpg
                img002.jpg
                ...
            vacant/
                img001.jpg
                img002.jpg
                ...

    Args:
        data_root (str): Path to root directory containing occupied/ and vacant/ folders
        split (str): One of 'train', 'val', 'test' — controls augmentation
        image_size (int): Target image size (square)
        file_list (list): Optional explicit list of (filepath, label) tuples
    """

    # ImageNet normalization stats (used for transfer learning compatibility)
    IMAGENET_MEAN = [0.485, 0.456, 0.406]
    IMAGENET_STD  = [0.229, 0.224, 0.225]

    def __init__(self, data_root=None, split="train", image_size=224, file_list=None,
                 cache_images=None):
        super().__init__()
        self.image_size = image_size
        self.split = split

        # Build file list from directory OR accept pre-built list
        if file_list is not None:
            self.samples = file_list
        elif data_root is not None:
            self.samples = self._scan_directory(data_root)
        else:
            raise ValueError("Either data_root or file_list must be provided")

        # Build transforms based on split
        self.transform = self._build_transforms()

        # Optional in-RAM cache of decoded+resized images (lazily filled).
        # Removes the per-epoch disk read + JPEG decode + resize cost, which
        # dominates on the Windows web-UI path (num_workers=0, single process).
        self.cache_images = config.CACHE_DATASET if cache_images is None else cache_images
        self._cache = {}

    def _scan_directory(self, data_root):
        """Scan occupied/ and vacant/ folders, return list of (path, label)."""
        samples = []
        data_root = Path(data_root)

        # Occupied = label 1
        occ_dir = data_root / "occupied"
        if occ_dir.exists():
            for img_path in sorted(occ_dir.iterdir()):
                if img_path.suffix.lower() in ('.jpg', '.jpeg', '.png', '.bmp'):
                    samples.append((str(img_path), 1))

        # Vacant = label 0
        vac_dir = data_root / "vacant"
        if vac_dir.exists():
            for img_path in sorted(vac_dir.iterdir()):
                if img_path.suffix.lower() in ('.jpg', '.jpeg', '.png', '.bmp'):
                    samples.append((str(img_path), 0))

        if len(samples) == 0:
            raise FileNotFoundError(
                f"No images found in {data_root}. "
                f"Expected 'occupied/' and 'vacant/' subdirectories."
            )

        return samples

    def _build_transforms(self):
        """
        Build transform pipeline.
        - Train: augmentation + normalization
        - Val/Test: only resize + normalization
        """
        if self.split == "train":
            return transforms.Compose([
                transforms.RandomHorizontalFlip(p=0.5),
                transforms.RandomVerticalFlip(p=0.1),
                transforms.RandomRotation(degrees=15),
                transforms.RandomAffine(
                    degrees=0,
                    translate=(0.05, 0.05),
                    scale=(0.95, 1.05)
                ),
                # Last before ToTensor so it has final say over detail level.
                _RandomDetail(),
                transforms.ToTensor(),
                transforms.Normalize(
                    mean=self.IMAGENET_MEAN,
                    std=self.IMAGENET_STD
                ),
            ])
        else:
            # Val / Test — no augmentation
            return transforms.Compose([
                transforms.ToTensor(),
                transforms.Normalize(
                    mean=self.IMAGENET_MEAN,
                    std=self.IMAGENET_STD
                ),
            ])

    def __len__(self):
        return len(self.samples)

    def _load_image(self, idx):
        """Return the decoded, resized RGB image for idx (cached if enabled).

        Only the deterministic part of the pipeline (decode + resize) is cached;
        random augmentation is applied fresh per epoch in __getitem__.
        """
        cached = self._cache.get(idx)
        if cached is not None:
            return cached

        img_path, _ = self.samples[idx]
        try:
            image = Image.open(img_path).convert("RGB").resize(
                (self.image_size, self.image_size), Image.BILINEAR
            )
        except Exception as e:
            # Return a black image if loading fails (robustness)
            print(f"⚠️  Failed to load {img_path}: {e}")
            image = Image.new("RGB", (self.image_size, self.image_size), (0, 0, 0))

        if self.cache_images:
            self._cache[idx] = image
        return image

    def __getitem__(self, idx):
        """
        Returns:
            image (Tensor): Transformed image tensor [C, H, W]
            label (Tensor): Binary label (0=vacant, 1=occupied)
        """
        _, label = self.samples[idx]

        # Apply augmentation + normalization on the (cached) resized image
        image = self.transform(self._load_image(idx))
        label = torch.tensor(label, dtype=torch.float32)

        return image, label

    @staticmethod
    def get_inverse_transform():
        """Get transform to convert normalized tensor back to displayable image."""
        return transforms.Compose([
            transforms.Normalize(
                mean=[-m/s for m, s in zip(
                    ParkingDataset.IMAGENET_MEAN,
                    ParkingDataset.IMAGENET_STD
                )],
                std=[1.0/s for s in ParkingDataset.IMAGENET_STD]
            ),
        ])
