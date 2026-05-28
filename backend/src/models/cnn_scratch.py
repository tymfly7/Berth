"""
Custom CNN — Built from Scratch
=================================
4-block convolutional neural network for binary parking space classification.

Architecture:
    Block 1: Conv(3→32)  → BatchNorm → ReLU → MaxPool
    Block 2: Conv(32→64) → BatchNorm → ReLU → MaxPool
    Block 3: Conv(64→128)→ BatchNorm → ReLU → MaxPool
    Block 4: Conv(128→256)→ BatchNorm → ReLU → MaxPool
    → Global Average Pooling
    → FC(256→128) → ReLU → Dropout(0.5)
    → FC(128→1)  → Sigmoid
"""

import torch
import torch.nn as nn


class ConvBlock(nn.Module):
    """Convolutional block: Conv2d → BatchNorm → ReLU → MaxPool."""

    def __init__(self, in_channels, out_channels, kernel_size=3, padding=1):
        super().__init__()
        self.block = nn.Sequential(
            nn.Conv2d(in_channels, out_channels, kernel_size, padding=padding),
            nn.BatchNorm2d(out_channels),
            nn.ReLU(inplace=True),
            nn.Conv2d(out_channels, out_channels, kernel_size, padding=padding),
            nn.BatchNorm2d(out_channels),
            nn.ReLU(inplace=True),
            nn.MaxPool2d(2, 2),
        )

    def forward(self, x):
        return self.block(x)


class ParkingCNN(nn.Module):
    """
    Custom CNN for parking space classification (occupied vs vacant).

    Input:  [B, 3, 224, 224]
    Output: [B, 1] — probability of being occupied
    """

    def __init__(self, num_classes=1):
        super().__init__()

        # Feature extractor: 4 convolutional blocks
        self.features = nn.Sequential(
            ConvBlock(3, 32),     # 224 → 112
            ConvBlock(32, 64),    # 112 → 56
            ConvBlock(64, 128),   # 56  → 28
            ConvBlock(128, 256),  # 28  → 14
        )

        # Global Average Pooling — reduces spatial dimensions to 1×1
        self.gap = nn.AdaptiveAvgPool2d(1)

        # Classifier head
        self.classifier = nn.Sequential(
            nn.Flatten(),
            nn.Linear(256, 128),
            nn.ReLU(inplace=True),
            nn.Dropout(0.5),
            nn.Linear(128, num_classes),
            nn.Sigmoid(),
        )

    def forward(self, x):
        x = self.features(x)
        x = self.gap(x)
        x = self.classifier(x)
        return x

    def count_parameters(self):
        """Return total and trainable parameter counts."""
        total = sum(p.numel() for p in self.parameters())
        trainable = sum(p.numel() for p in self.parameters() if p.requires_grad)
        return {"total": total, "trainable": trainable}


# # Quick test
# if __name__ == "__main__":
#     model = ParkingCNN()
#     params = model.count_parameters()
#     print(f"ParkingCNN — Total params: {params['total']:,}, Trainable: {params['trainable']:,}")

#     # Test forward pass
#     dummy = torch.randn(4, 3, 224, 224)
#     output = model(dummy)
#     print(f"Input shape:  {dummy.shape}")
#     print(f"Output shape: {output.shape}")
#     print(f"Output values: {output.squeeze().tolist()}")
