import importlib.util

import pytest
import torch

from src.models.cnn_scratch import ParkingCNN
from src.models.cnn_transfer import ParkingResNet, ParkingMobileNet, ParkingMobileNetV4

_dummy = torch.randn(1, 3, 224, 224)

_timm_available = importlib.util.find_spec("timm") is not None


# ── ParkingCNN ────────────────────────────────────────────────────────────────

def test_parkingcnn_forward():
    model = ParkingCNN()
    model.eval()
    with torch.no_grad():
        out = model(_dummy)
    assert out.shape == (1, 1)


def test_parkingcnn_params():
    assert ParkingCNN().count_parameters()["trainable"] > 0


# ── ParkingResNet (resnet50) ──────────────────────────────────────────────────

def test_parkingresnet_forward():
    model = ParkingResNet(pretrained=False)
    model.eval()
    with torch.no_grad():
        out = model(_dummy)
    assert out.shape == (1, 1)


def test_parkingresnet_params():
    assert ParkingResNet(pretrained=False).count_parameters()["trainable"] > 0


# ── ParkingMobileNetV4 ────────────────────────────────────────────────────────

@pytest.mark.skipif(not _timm_available, reason="timm not installed")
def test_parkingmobilenetv4_forward():
    model = ParkingMobileNetV4(pretrained=False)
    model.eval()
    with torch.no_grad():
        out = model(_dummy)
    assert out.shape == (1, 1)


@pytest.mark.skipif(not _timm_available, reason="timm not installed")
def test_parkingmobilenetv4_params():
    assert ParkingMobileNetV4(pretrained=False).count_parameters()["trainable"] > 0
