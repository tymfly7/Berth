"""
Transfer Learning Models — ResNet & MobileNetV4
====================================================
Two pre-trained backbone families with custom binary classification heads for
binary parking space classification (occupied vs vacant). ResNet comes in depth
18/50 and MobileNetV4 in conv_small/conv_medium variants.

Both heads output raw logits — NO Sigmoid — so BCEWithLogitsLoss in the
trainer and torch.sigmoid in the classifier stay correct.
"""

import torch
import torch.nn as nn
from torchvision import models
from torchvision.models import ResNet18_Weights, ResNet50_Weights


class ParkingResNet(nn.Module):
    """
    ResNet (depth 18 or 50) with frozen backbone and custom binary head.

    Architecture:
        ResNet backbone (pre-trained, frozen, fc→Identity)
        → Linear(num_features→512) → ReLU → Dropout(0.3)
        → Linear(512→1)            [raw logits, no Sigmoid]

    num_features is 512 for resnet18 and 2048 for resnet50.
    """

    _BACKBONES = {
        18: (models.resnet18, ResNet18_Weights),
        50: (models.resnet50, ResNet50_Weights),
    }

    def __init__(self, depth=50, pretrained=True, freeze_backbone=True):
        super().__init__()

        if depth not in self._BACKBONES:
            raise ValueError(f"Unsupported ResNet depth {depth}; choose from {list(self._BACKBONES)}")
        ctor, weights_enum = self._BACKBONES[depth]
        weights = weights_enum.DEFAULT if pretrained else None
        self.backbone = ctor(weights=weights)

        num_features = self.backbone.fc.in_features  # 512 (r18) / 2048 (r50)
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

    def count_parameters(self):
        total = sum(p.numel() for p in self.parameters())
        trainable = sum(p.numel() for p in self.parameters() if p.requires_grad)
        return {"total": total, "trainable": trainable}


class ParkingMobileNetV4(nn.Module):
    """
    MobileNetV4 (timm) with frozen backbone and custom binary classification head.

    Architecture:
        MobileNetV4 backbone (pre-trained, frozen, global_pool='avg')
        → Linear(num_features→256) → ReLU → Dropout(0.3)
        → Linear(256→1)            [raw logits, no Sigmoid]

    variant selects the timm checkpoint: 'conv_small' or 'conv_medium'.
    Raises RuntimeError if timm is not installed.
    """

    _TIMM_TAGS = {
        "conv_small":  "mobilenetv4_conv_small.e2400_r224_in1k",
        "conv_medium": "mobilenetv4_conv_medium.e500_r256_in1k",
    }

    def __init__(self, variant="conv_small", pretrained=True, freeze_backbone=True):
        super().__init__()

        if variant not in self._TIMM_TAGS:
            raise ValueError(f"Unsupported MobileNetV4 variant '{variant}'; choose from {list(self._TIMM_TAGS)}")

        try:
            import timm
        except ImportError:
            raise RuntimeError(
                "timm is required for ParkingMobileNetV4. "
                "Install it with: pip install timm"
            )

        self.backbone = timm.create_model(
            self._TIMM_TAGS[variant],
            pretrained=pretrained,
            num_classes=0,
            global_pool='avg',
        )

        # Probe feature dimension — eval mode prevents BN failure when
        # batch_size=1 hits a 1×1 spatial tensor inside the backbone.
        self.backbone.eval()
        with torch.no_grad():
            dummy = torch.zeros(1, 3, 224, 224)
            num_features = self.backbone(dummy).shape[1]
        self.backbone.train()  # restore; freeze logic below overrides if needed

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

    def count_parameters(self):
        total = sum(p.numel() for p in self.parameters())
        trainable = sum(p.numel() for p in self.parameters() if p.requires_grad)
        return {"total": total, "trainable": trainable}
