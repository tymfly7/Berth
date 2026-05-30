"""
Transfer Learning Models — ResNet50 & MobileNetV4
====================================================
Two pre-trained backbones with custom binary classification heads for
binary parking space classification (occupied vs vacant).

Both heads output raw logits — NO Sigmoid — so BCEWithLogitsLoss in the
trainer and torch.sigmoid in the classifier stay correct.
"""

import torch
import torch.nn as nn
from torchvision import models
from torchvision.models import ResNet50_Weights


class ParkingResNet(nn.Module):
    """
    ResNet50 with frozen backbone and custom binary classification head.

    Architecture:
        ResNet50 backbone (pre-trained, frozen, fc→Identity)
        → Linear(2048→512) → ReLU → Dropout(0.3)
        → Linear(512→1)    [raw logits, no Sigmoid]
    """

    def __init__(self, pretrained=True, freeze_backbone=True):
        super().__init__()

        weights = ResNet50_Weights.DEFAULT if pretrained else None
        self.backbone = models.resnet50(weights=weights)

        num_features = self.backbone.fc.in_features  # 2048
        self.backbone.fc = nn.Identity()

        if freeze_backbone:
            for param in self.backbone.parameters():
                param.requires_grad = False

        self.classifier = nn.Sequential(
            nn.Linear(num_features, 512),
            nn.ReLU(inplace=True),
            nn.Dropout(0.3),
            nn.Linear(512, 1),
        )

    def forward(self, x):
        features = self.backbone(x)
        return self.classifier(features)

    def unfreeze_layers(self, num_layers=3):
        """Unfreeze the last N layers of the backbone for fine-tuning."""
        layers = list(self.backbone.children())
        for layer in layers[-num_layers:]:
            for param in layer.parameters():
                param.requires_grad = True

    def count_parameters(self):
        total = sum(p.numel() for p in self.parameters())
        trainable = sum(p.numel() for p in self.parameters() if p.requires_grad)
        return {"total": total, "trainable": trainable}


class ParkingMobileNetV4(nn.Module):
    """
    MobileNetV4 (timm) with frozen backbone and custom binary classification head.

    Architecture:
        mobilenetv4_conv_small backbone (pre-trained, frozen, global_pool='avg')
        → Linear(num_features→256) → ReLU → Dropout(0.3)
        → Linear(256→1)            [raw logits, no Sigmoid]

    Raises RuntimeError if timm is not installed.
    """

    def __init__(self, pretrained=True, freeze_backbone=True):
        super().__init__()

        try:
            import timm
        except ImportError:
            raise RuntimeError(
                "timm is required for ParkingMobileNetV4. "
                "Install it with: pip install timm"
            )

        self.backbone = timm.create_model(
            'mobilenetv4_conv_small',
            pretrained=pretrained,
            num_classes=0,
            global_pool='avg',
        )

        # Probe feature dimension with a dummy forward pass
        with torch.no_grad():
            dummy = torch.zeros(1, 3, 224, 224)
            num_features = self.backbone(dummy).shape[1]

        self._backbone_frozen = freeze_backbone
        if freeze_backbone:
            for param in self.backbone.parameters():
                param.requires_grad = False
            # Keep backbone BN in eval mode so it uses running stats instead of
            # batch stats — MobileNetV4 has a BN at 1×1 spatial resolution that
            # fails with batch size 1 when in training mode.
            self.backbone.eval()

        self.classifier = nn.Sequential(
            nn.Linear(num_features, 256),
            nn.ReLU(inplace=True),
            nn.Dropout(0.3),
            nn.Linear(256, 1),
        )

    def train(self, mode=True):
        super().train(mode)
        if self._backbone_frozen:
            self.backbone.eval()
        return self

    def forward(self, x):
        features = self.backbone(x)
        return self.classifier(features)

    def unfreeze_layers(self, num_layers=3):
        """Unfreeze the last N backbone blocks for fine-tuning."""
        self._backbone_frozen = False
        layers = list(self.backbone.children())
        for layer in layers[-num_layers:]:
            for param in layer.parameters():
                param.requires_grad = True

    def count_parameters(self):
        total = sum(p.numel() for p in self.parameters())
        trainable = sum(p.numel() for p in self.parameters() if p.requires_grad)
        return {"total": total, "trainable": trainable}
