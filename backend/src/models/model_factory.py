"""
Model Factory — Create Models by Name
=======================================
Provides a unified interface to instantiate any supported model architecture.
"""

import torch
import config
from src.models.cnn_scratch import ParkingCNN
from src.models.cnn_transfer import ParkingResNet, ParkingMobileNetV4


MODEL_REGISTRY = {
    "cnn_scratch": ParkingCNN,
    "resnet50": ParkingResNet,
    "mobilenetv4": ParkingMobileNetV4,
}


def create_model(name, **kwargs):
    """
    Create a model by name.

    Args:
        name (str): Model name — one of 'cnn_scratch', 'resnet50', 'mobilenetv4'.
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
        "resnet50": config.RESNET50_PATH,
        "mobilenetv4": config.MOBILENETV4_PATH,
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
