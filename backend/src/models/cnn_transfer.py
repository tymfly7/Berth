"""
Transfer Learning Models — ResNet50, MobileNetV2, MobileNetV4, YOLO26
=======================================================================
Pre-trained models with custom classification heads for
binary parking space classification (occupied vs vacant).

ResNet50, MobileNetV2, and MobileNetV4 share a common sigmoid-output
binary-classifier interface. ParkingYOLO26 is an object detector — see
its docstring for the different interface.
"""

import numpy as np
import torch.nn as nn
from torchvision import models


class ParkingResNet(nn.Module):
    """
    ResNet50 with frozen backbone and custom binary classification head.

    NOTE: Saved weights from the old ResNet18-based ParkingResNet are
    incompatible — ResNet50 has a different architecture and
    fc.in_features=2048 vs 512 for ResNet18.

    Architecture:
        ResNet50 backbone (pre-trained, frozen)
        → AdaptiveAvgPool(1)
        → FC(2048→512) → ReLU → Dropout(0.3)
        → FC(512→1)    → Sigmoid
    """

    def __init__(self, pretrained=True, freeze_backbone=True):
        super().__init__()

        weights = models.ResNet50_Weights.DEFAULT if pretrained else None
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
            nn.Sigmoid(),
        )

    def forward(self, x):
        features = self.backbone(x)
        return self.classifier(features)

    def unfreeze_layers(self, num_layers=2):
        """Unfreeze the last N layers of the backbone for fine-tuning."""
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

    MobileNetV2 is lighter and faster than ResNet, ideal for
    edge deployment and real-time inference.
    """

    def __init__(self, pretrained=True, freeze_backbone=True):
        super().__init__()

        weights = models.MobileNet_V2_Weights.DEFAULT if pretrained else None
        self.backbone = models.mobilenet_v2(weights=weights)

        num_features = self.backbone.classifier[1].in_features  # 1280
        self.backbone.classifier = nn.Identity()

        if freeze_backbone:
            for param in self.backbone.parameters():
                param.requires_grad = False

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


class ParkingMobileNetV4(nn.Module):
    """
    MobileNetV4 (timm) with frozen backbone and custom binary classification head.

    Architecture:
        mobilenetv4_conv_small backbone (pre-trained via timm, frozen)
        → Global Average Pool (built-in: num_classes=0, global_pool='avg')
        → FC(num_features→256) → ReLU → Dropout(0.3)
        → FC(256→1) → Sigmoid
    """

    def __init__(self, pretrained=True, freeze_backbone=True):
        super().__init__()

        try:
            import timm
        except ImportError:
            raise RuntimeError("pip install timm>=1.0.0")

        self.backbone = timm.create_model(
            'mobilenetv4_conv_small',
            pretrained=pretrained,
            num_classes=0,
            global_pool='avg',
        )
        # num_features can misreport the pooled output size in some timm versions;
        # probe with a dummy pass to get the real dimension.
        import torch
        with torch.no_grad():
            num_features = self.backbone(torch.zeros(1, 3, 224, 224)).shape[1]

        if freeze_backbone:
            for param in self.backbone.parameters():
                param.requires_grad = False

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
        """Unfreeze the last N children of backbone for fine-tuning."""
        children = list(self.backbone.children())
        for child in children[-num_layers:]:
            for param in child.parameters():
                param.requires_grad = True

    def count_parameters(self):
        total = sum(p.numel() for p in self.parameters())
        trainable = sum(p.numel() for p in self.parameters() if p.requires_grad)
        return {"total": total, "trainable": trainable}


class ParkingYOLO26:
    """
    Thin wrapper around Ultralytics YOLO26 for parking lot object detection.

    IMPORTANT: This class does NOT follow the sigmoid-output binary classifier
    interface used by ParkingCNN, ParkingResNet, ParkingMobileNet, and
    ParkingMobileNetV4. It is an object detector that returns bounding boxes,
    confidence scores, and class IDs for objects found in a full frame — not a
    per-patch occupied/vacant probability. Use predict_frame() for inference;
    there is no forward() or classifier head.

    # TODO: YOLO26 training uses the Ultralytics CLI (yolo train ...), not the
    #       existing trainer.py / TrainManager pipeline. Integration requires a
    #       separate training workflow and a dataset converted to YOLO format.
    """

    def __init__(self, model_path: str):
        try:
            from ultralytics import YOLO
        except ImportError:
            raise RuntimeError("pip install ultralytics")

        from pathlib import Path
        if not Path(model_path).exists():
            raise FileNotFoundError(
                f"YOLO26 model not found at '{model_path}'. "
                "Train it first via the Training panel."
            )
        self.model = YOLO(model_path)

    def predict_frame(self, frame_bgr: np.ndarray) -> list:
        """
        Run YOLO26 inference on a BGR frame.

        Args:
            frame_bgr: BGR image array from OpenCV.

        Returns:
            list[dict] — one entry per detection:
                'bbox':       [x1, y1, x2, y2] pixel coordinates
                'confidence': float detection score
                'class_id':   int class index
        """
        results = self.model(frame_bgr, verbose=False)
        detections = []
        for r in results:
            for box in r.boxes:
                detections.append({
                    "bbox":       box.xyxy[0].tolist(),
                    "confidence": float(box.conf[0]),
                    "class_id":   int(box.cls[0]),
                })
        return detections
