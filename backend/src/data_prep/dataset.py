"""
PKLot Dataset — PyTorch Dataset Class
======================================
Loads individual parking space images (occupied/vacant) with augmentation.

The PKLot dataset contains cropped images of individual parking spaces.
Each image is labeled as either "occupied" or "vacant" (empty).

Labels:
    0 = Vacant  (empty parking space)
    1 = Occupied (car present)
"""

import os
from pathlib import Path
from PIL import Image

import torch
from torch.utils.data import Dataset
from torchvision import transforms


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

    def __init__(self, data_root=None, split="train", image_size=224, file_list=None):
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
                transforms.Resize((self.image_size, self.image_size)),
                transforms.RandomHorizontalFlip(p=0.5),
                transforms.RandomVerticalFlip(p=0.1),
                transforms.RandomRotation(degrees=15),
                transforms.ColorJitter(
                    brightness=0.3,
                    contrast=0.2,
                    saturation=0.2,
                    hue=0.05
                ),
                transforms.RandomAffine(
                    degrees=0,
                    translate=(0.05, 0.05),
                    scale=(0.95, 1.05)
                ),
                transforms.ToTensor(),
                transforms.Normalize(
                    mean=self.IMAGENET_MEAN,
                    std=self.IMAGENET_STD
                ),
            ])
        else:
            # Val / Test — no augmentation
            return transforms.Compose([
                transforms.Resize((self.image_size, self.image_size)),
                transforms.ToTensor(),
                transforms.Normalize(
                    mean=self.IMAGENET_MEAN,
                    std=self.IMAGENET_STD
                ),
            ])

    def __len__(self):
        return len(self.samples)

    def __getitem__(self, idx):
        """
        Returns:
            image (Tensor): Transformed image tensor [C, H, W]
            label (Tensor): Binary label (0=vacant, 1=occupied)
        """
        img_path, label = self.samples[idx]

        # Load image as RGB
        try:
            image = Image.open(img_path).convert("RGB")
        except Exception as e:
            # Return a black image if loading fails (robustness)
            print(f"⚠️  Failed to load {img_path}: {e}")
            image = Image.new("RGB", (self.image_size, self.image_size), (0, 0, 0))

        # Apply transforms
        image = self.transform(image)
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
