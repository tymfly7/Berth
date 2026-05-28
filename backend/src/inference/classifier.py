"""
Parking Classifier — Single-Image Inference
=============================================
Loads a trained model and classifies a single parking space
image as occupied or vacant with confidence score.
"""

import sys
import logging
from pathlib import Path
import torch
import numpy as np
from PIL import Image
from torchvision import transforms
import config


logger = logging.getLogger("smartpark.classifier")
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))


class ParkingClassifier:
    """
    Classifies individual parking space crops as occupied/vacant.

    Args:
        model_name (str): Model architecture name
        device: Computation device (auto-detected if None)
        confidence_threshold (float): Minimum confidence for a prediction
    """

    IMAGENET_MEAN = [0.485, 0.456, 0.406]
    IMAGENET_STD  = [0.229, 0.224, 0.225]

    def __init__(self, model_name=None, device=None, confidence_threshold=None):
        self.model_name = model_name or config.ACTIVE_MODEL
        self.device = device or torch.device("cuda" if torch.cuda.is_available() else "cpu")
        self.threshold = confidence_threshold or config.CNN_CONFIDENCE_THRESHOLD
        self.model = None

        # Preprocessing transform (no augmentation — inference only)
        self.transform = transforms.Compose([
            transforms.Resize((config.CNN_INPUT_SIZE, config.CNN_INPUT_SIZE)),
            transforms.ToTensor(),
            transforms.Normalize(mean=self.IMAGENET_MEAN, std=self.IMAGENET_STD),
        ])

    def load(self):
        """Load the trained model weights."""
        from src.models.model_factory import load_model
        try:
            self.model = load_model(self.model_name, device=self.device)
            logger.info(f"✅ Loaded model: {self.model_name} on {self.device}")
        except FileNotFoundError as e:
            logger.warning(f"⚠️  {e}")
            self.model = None

    def is_loaded(self):
        return self.model is not None

    @torch.no_grad()
    def predict(self, image):
        """
        Classify a single parking space image.

        Args:
            image: PIL Image, numpy array (HWC, BGR or RGB), or file path string

        Returns:
            dict: {
                "status": "occupied" | "vacant",
                "confidence": float (0-1),
                "probability": float (0-1, raw model output)
            }
        """
        if self.model is None:
            return {"status": "unknown", "confidence": 0.0, "probability": 0.5}

        # Convert input to PIL Image
        if isinstance(image, str) or isinstance(image, Path):
            image = Image.open(image).convert("RGB")
        elif isinstance(image, np.ndarray):
            # Assume BGR from OpenCV — convert to RGB
            if len(image.shape) == 3 and image.shape[2] == 3:
                image = Image.fromarray(image[:, :, ::-1])
            else:
                image = Image.fromarray(image)

        # Preprocess
        tensor = self.transform(image).unsqueeze(0).to(self.device)

        # Inference
        output = self.model(tensor)
        prob = output.squeeze().item()

        # Interpret result
        if prob > 0.5:
            status = "occupied"
            confidence = prob
        else:
            status = "vacant"
            confidence = 1.0 - prob

        return {
            "status": status,
            "confidence": round(confidence, 4),
            "probability": round(prob, 4),
        }

    @torch.no_grad()
    def predict_batch(self, images):
        """
        Classify multiple parking space images in a single batch.

        Args:
            images: List of PIL Images or numpy arrays

        Returns:
            list[dict]: List of prediction dicts
        """
        if self.model is None:
            return [{"status": "unknown", "confidence": 0.0, "probability": 0.5}
                    for _ in images]

        # Preprocess all images
        tensors = []
        for img in images:
            if isinstance(img, np.ndarray):
                if len(img.shape) == 3 and img.shape[2] == 3:
                    img = Image.fromarray(img[:, :, ::-1])
                else:
                    img = Image.fromarray(img)
            elif isinstance(img, (str, Path)):
                img = Image.open(img).convert("RGB")
            tensors.append(self.transform(img))

        batch = torch.stack(tensors).to(self.device)
        outputs = self.model(batch).squeeze(1)

        results = []
        for prob in outputs.cpu().numpy():
            if prob > 0.5:
                results.append({
                    "status": "occupied",
                    "confidence": round(float(prob), 4),
                    "probability": round(float(prob), 4),
                })
            else:
                results.append({
                    "status": "vacant",
                    "confidence": round(float(1.0 - prob), 4),
                    "probability": round(float(prob), 4),
                })

        return results
