"""
Model Factory — Create Models by Name
=======================================
Provides a unified interface to instantiate any supported model architecture.
"""

from functools import partial

import torch
import config
from src.models.cnn_scratch import ParkingCNN
from src.models.cnn_transfer import ParkingResNet, ParkingMobileNetV4


# torch/timm classifiers only — the YOLO26 classify heads train and load via the
# Ultralytics path (train_manager / torch_classifier), not this factory.
MODEL_REGISTRY = {
    "cnn_scratch": ParkingCNN,
    "resnet18": partial(ParkingResNet, depth=18),
    "resnet50": partial(ParkingResNet, depth=50),
    "mobilenetv4s": partial(ParkingMobileNetV4, variant="conv_small"),
    "mobilenetv4m": partial(ParkingMobileNetV4, variant="conv_medium"),
}

# Transfer models accept a `pretrained` flag; cnn_scratch does not.
_PRETRAINED_MODELS = {"resnet18", "resnet50", "mobilenetv4s", "mobilenetv4m"}


def create_model(name, **kwargs):
    """
    Create a model by name.

    Args:
        name (str): Model name — a key of MODEL_REGISTRY.
        **kwargs: Additional arguments passed to the model constructor

    Returns:
        nn.Module: Instantiated model

    Raises:
        ValueError: If model name is not recognized
    """
    if name not in MODEL_REGISTRY:
        raise ValueError(
            f"Unknown model '{name}'. Available: {list(MODEL_REGISTRY.keys())}"
        )
    return MODEL_REGISTRY[name](**kwargs)


def get_model_path(name):
    """Get the default save path for a model by name."""
    paths = {
        "cnn_scratch": config.CNN_SCRATCH_PATH,
        "resnet18": config.RESNET18_PATH,
        "resnet50": config.RESNET50_PATH,
        "mobilenetv4s": config.MOBILENETV4S_PATH,
        "mobilenetv4m": config.MOBILENETV4M_PATH,
    }
    return paths.get(name)


def load_model(name, device=None, **kwargs):
    """
    Load a trained model from disk.

    Args:
        name (str): Model name
        device: Target device (auto-detected if None)
        **kwargs: Extra args for model constructor

    Returns:
        nn.Module: Loaded model in eval mode
    """
    if device is None:
        device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

    if name in _PRETRAINED_MODELS:
        kwargs.setdefault("pretrained", False)
    model = create_model(name, **kwargs)
    model_path = get_model_path(name)

    if model_path and model_path.exists():
        state_dict = torch.load(model_path, map_location=device, weights_only=True)
        model.load_state_dict(state_dict)
        model.to(device)
        model.eval()
        return model
    else:
        raise FileNotFoundError(
            f"No saved weights found for '{name}' at {model_path}. "
            f"Train the model first."
        )


def list_available_models():
    """List all registered model names."""
    return list(MODEL_REGISTRY.keys())
