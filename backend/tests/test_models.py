import torch

from src.models.cnn_scratch import ParkingCNN
from src.models.cnn_transfer import ParkingResNet, ParkingMobileNetV4

_dummy = torch.randn(1, 3, 224, 224)


# ── ParkingCNN ────────────────────────────────────────────────────────────────

def test_parkingcnn_forward():
    model = ParkingCNN()
    model.eval()
    with torch.no_grad():
        out = model(_dummy)
    assert out.shape == (1, 1)


def test_parkingcnn_params():
    assert ParkingCNN().count_parameters()["trainable"] > 0


# ── ParkingResNet (ResNet50) ──────────────────────────────────────────────────

def test_parkingresnet_forward():
    model = ParkingResNet(pretrained=False)
    model.eval()
    with torch.no_grad():
        out = model(_dummy)
    assert out.shape == (1, 1)


def test_parkingresnet_params():
    model = ParkingResNet(pretrained=False)
    params = model.count_parameters()
    assert params["trainable"] > 0


def test_parkingresnet_no_sigmoid():
    model = ParkingResNet(pretrained=False)
    for module in model.classifier.modules():
        assert not isinstance(module, torch.nn.Sigmoid), "Head must not contain Sigmoid"


# ── ParkingMobileNetV4 ────────────────────────────────────────────────────────

def test_parkingmobilenetv4_forward():
    model = ParkingMobileNetV4(pretrained=False)
    model.eval()
    with torch.no_grad():
        out = model(_dummy)
    assert out.shape == (1, 1)


def test_parkingmobilenetv4_params():
    model = ParkingMobileNetV4(pretrained=False)
    params = model.count_parameters()
    assert params["trainable"] > 0


def test_parkingmobilenetv4_no_sigmoid():
    model = ParkingMobileNetV4(pretrained=False)
    for module in model.classifier.modules():
        assert not isinstance(module, torch.nn.Sigmoid), "Head must not contain Sigmoid"
