"""
Model Factory — Create Models by Name
=======================================
Provides a unified interface to instantiate any supported model architecture.
"""

import torch
from src.models.cnn_scratch import ParkingCNN
from src.models.cnn_transfer import ParkingResNet, ParkingMobileNet
import sys
from pathlib import Path
import config


# Registry of all available models
MODEL_REGISTRY = {
    "cnn_scratch":  ParkingCNN,
    "resnet18":     ParkingResNet,
    "mobilenetv2":  ParkingMobileNet,
}


def create_model(name, **kwargs):
    """
    Create a model by name.

    Args:
        name (str): Model name — one of 'cnn_scratch', 'resnet18', 'mobilenetv2'
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

    model = MODEL_REGISTRY[name](**kwargs)
    return model


def get_model_path(name):
    """Get the default save path for a model by name."""
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

    paths = {
        "cnn_scratch":  config.CNN_SCRATCH_PATH,
        "resnet18":     config.RESNET18_PATH,
        "mobilenetv2":  config.MOBILENET_PATH,
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
