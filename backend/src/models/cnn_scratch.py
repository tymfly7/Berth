"""
Custom CNN — Built from Scratch
=================================
6-block convolutional neural network with Squeeze-and-Excitation attention
for binary parking space classification.

Architecture:
    Block 1: Conv(3→32)   → BN → ReLU → Conv(32→32)   → BN → ReLU → MaxPool
    Block 2: Conv(32→64)  → BN → ReLU → Conv(64→64)   → BN → ReLU → MaxPool
    Block 3: Conv(64→128) → BN → ReLU → Conv(128→128) → BN → ReLU → MaxPool
    Block 4: Conv(128→256)→ BN → ReLU → Conv(256→256) → BN → ReLU → MaxPool
    Block 5: Conv(256→512)→ BN → ReLU → Conv(512→512) → BN → ReLU → MaxPool → SEBlock(512)
    Block 6: Conv(512→512)→ BN → ReLU → Conv(512→512) → BN → ReLU → MaxPool
    → Global Average Pooling
    → FC(512→256) → BN → ReLU → Dropout(0.4)
    → FC(256→64)  → ReLU → Dropout(0.2)
    → FC(64→1)
"""

import torch
import torch.nn as nn


class ConvBlock(nn.Module):
    """Convolutional block: Conv2d → BN → ReLU → Conv2d → BN → ReLU → MaxPool."""

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

    class SEBlock(nn.Module):
        """Squeeze-and-Excitation channel attention (ratio=16)."""

        def __init__(self, channels, ratio=16):
            super().__init__()
            self.gap = nn.AdaptiveAvgPool2d(1)
            self.fc1 = nn.Linear(channels, channels // ratio)
            self.fc2 = nn.Linear(channels // ratio, channels)

        def forward(self, x):
            b, c, _, _ = x.shape
            scale = self.gap(x).view(b, c)
            scale = torch.relu(self.fc1(scale))
            scale = torch.sigmoid(self.fc2(scale))
            return x * scale.view(b, c, 1, 1)

    def __init__(self, num_classes=1):
        super().__init__()

        self.features = nn.Sequential(
            ConvBlock(3, 32),            # Block 1: 224 → 112
            ConvBlock(32, 64),           # Block 2: 112 →  56
            ConvBlock(64, 128),          # Block 3:  56 →  28
            ConvBlock(128, 256),         # Block 4:  28 →  14
            ConvBlock(256, 512),         # Block 5:  14 →   7
            ParkingCNN.SEBlock(512),     # SE attention after block 5
            ConvBlock(512, 512),         # Block 6:   7 →   3
        )

        self.gap = nn.AdaptiveAvgPool2d(1)

        self.classifier = nn.Sequential(
            nn.Flatten(),
            nn.Linear(512, 256),
            nn.BatchNorm1d(256),
            nn.ReLU(inplace=True),
            nn.Dropout(0.4),
            nn.Linear(256, 64),
            nn.ReLU(inplace=True),
            nn.Dropout(0.2),
            nn.Linear(64, num_classes),
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
