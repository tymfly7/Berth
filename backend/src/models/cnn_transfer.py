"""
Transfer Learning Models — ResNet18 & MobileNetV2
====================================================
Pre-trained models with custom classification heads for
binary parking space classification (occupied vs vacant).

Both models:
    - Use ImageNet pre-trained weights
    - Freeze backbone layers initially
    - Replace final classifier with custom head
    - Support fine-tuning by unfreezing layers
"""

import torch
import torch.nn as nn
from torchvision import models


class ParkingResNet(nn.Module):
    """
    ResNet18 with frozen backbone and custom binary classification head.

    Architecture:
        ResNet18 backbone (pre-trained, frozen)
        → AdaptiveAvgPool(1)
        → FC(512→256) → ReLU → Dropout(0.3)
        → FC(256→1)   → Sigmoid
    """

    def __init__(self, pretrained=True, freeze_backbone=True):
        super().__init__()

        # Load pre-trained ResNet18
        weights = models.ResNet18_Weights.DEFAULT if pretrained else None
        self.backbone = models.resnet18(weights=weights)

        # Remove original fully-connected layer
        num_features = self.backbone.fc.in_features  # 512
        self.backbone.fc = nn.Identity()

        # Freeze backbone if requested
        if freeze_backbone:
            for param in self.backbone.parameters():
                param.requires_grad = False

        # Custom classifier head
        self.classifier = nn.Sequential(
            nn.Linear(num_features, 256),
            nn.ReLU(inplace=True),
            nn.Dropout(0.3),
            nn.Linear(256, 1),
            nn.Sigmoid(),
        )

    def forward(self, x):
        features = self.backbone(x)
        return self.classifier(features)

    def unfreeze_layers(self, num_layers=2):
        """
        Unfreeze the last N layers of the backbone for fine-tuning.
        Call this after initial training with frozen backbone.
        """
        layers = list(self.backbone.children())
        for layer in layers[-num_layers:]:
            for param in layer.parameters():
                param.requires_grad = True

    def count_parameters(self):
        total = sum(p.numel() for p in self.parameters())
        trainable = sum(p.numel() for p in self.parameters() if p.requires_grad)
        return {"total": total, "trainable": trainable}


class ParkingMobileNet(nn.Module):
    """
    MobileNetV2 with frozen backbone and custom binary classification head.

    Architecture:
        MobileNetV2 backbone (pre-trained, frozen)
        → AdaptiveAvgPool(1)
        → FC(1280→256) → ReLU → Dropout(0.3)
        → FC(256→1)    → Sigmoid

    MobileNetV2 is lighter and faster than ResNet18, ideal for
    edge deployment and real-time inference.
    """

    def __init__(self, pretrained=True, freeze_backbone=True):
        super().__init__()

        # Load pre-trained MobileNetV2
        weights = models.MobileNet_V2_Weights.DEFAULT if pretrained else None
        self.backbone = models.mobilenet_v2(weights=weights)

        # Get feature count from original classifier
        num_features = self.backbone.classifier[1].in_features  # 1280

        # Remove original classifier
        self.backbone.classifier = nn.Identity()

        # Freeze backbone if requested
        if freeze_backbone:
            for param in self.backbone.parameters():
                param.requires_grad = False

        # Custom classifier head
        self.classifier = nn.Sequential(
            nn.Linear(num_features, 256),
            nn.ReLU(inplace=True),
            nn.Dropout(0.3),
            nn.Linear(256, 1),
            nn.Sigmoid(),
        )

    def forward(self, x):
        features = self.backbone(x)
        return self.classifier(features)

    def unfreeze_layers(self, num_layers=3):
        """Unfreeze the last N feature blocks for fine-tuning."""
        features = list(self.backbone.features.children())
        for layer in features[-num_layers:]:
            for param in layer.parameters():
                param.requires_grad = True

    def count_parameters(self):
        total = sum(p.numel() for p in self.parameters())
        trainable = sum(p.numel() for p in self.parameters() if p.requires_grad)
        return {"total": total, "trainable": trainable}


# # Quick test
# if __name__ == "__main__":
#     dummy = torch.randn(4, 3, 224, 224)

#     print("=" * 60)
#     print("ResNet18 Transfer Learning")
#     print("=" * 60)
#     resnet = ParkingResNet()
#     params = resnet.count_parameters()
#     print(f"  Total params:     {params['total']:,}")
#     print(f"  Trainable params: {params['trainable']:,}")
#     out = resnet(dummy)
#     print(f"  Output shape: {out.shape}")

#     print()
#     print("=" * 60)
#     print("MobileNetV2 Transfer Learning")
#     print("=" * 60)
#     mobilenet = ParkingMobileNet()
#     params = mobilenet.count_parameters()
#     print(f"  Total params:     {params['total']:,}")
#     print(f"  Trainable params: {params['trainable']:,}")
#     out = mobilenet(dummy)
#     print(f"  Output shape: {out.shape}")
