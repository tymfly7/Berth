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

    _INFERENCE_MODELS = {"cnn_scratch", "resnet50", "mobilenetv4", "yolo26_classify", "yolo26"}

    def __init__(self, model_name=None, device=None, confidence_threshold=None):
        candidate = model_name or config.ACTIVE_MODEL
        self.model_name = candidate if candidate in self._INFERENCE_MODELS else None
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
        if self.model_name is None:
            self.model = None
            self._yolo_classify = None
            self._yolo_detect = None
            return
        if self.model_name == "yolo26_classify":
            self._load_yolo_classify()
            return
        if self.model_name == "yolo26":
            self._load_yolo_detect()
            return
        from src.models.model_factory import load_model
        try:
            self.model = load_model(self.model_name, device=self.device)
            logger.info(f"✅ Loaded model: {self.model_name} on {self.device}")
        except (FileNotFoundError, ValueError) as e:
            logger.warning(f"⚠️  {e}")
            self.model = None
        self._yolo_classify = None
        self._yolo_detect = None

    def _load_yolo_classify(self):
        """Load a YOLO26 classify model (Ultralytics API)."""
        try:
            from ultralytics import YOLO
            model_path = config.YOLO26_CLASSIFY_PATH
            if not model_path.exists():
                raise FileNotFoundError(
                    f"YOLO26 classify weights not found at '{model_path}'. Train it first."
                )
            self._yolo_classify = YOLO(str(model_path))
            self.model = True  # sentinel so is_loaded() returns True
            logger.info(f"✅ Loaded YOLO26 classify model on {self.device}")
        except FileNotFoundError as e:
            logger.warning(f"⚠️  {e}")
            self.model = None
            self._yolo_classify = None

    def _load_yolo_detect(self):
        """Load a YOLO26 detect model (Ultralytics API)."""
        try:
            from ultralytics import YOLO
            model_path = config.YOLO26_DETECT_PATH
            if not model_path.exists():
                raise FileNotFoundError(
                    f"YOLO26 detect weights not found at '{model_path}'. Train it first."
                )
            self._yolo_detect = YOLO(str(model_path))
            self.model = True
            logger.info(f"✅ Loaded YOLO26 detect model on {self.device}")
        except FileNotFoundError as e:
            logger.warning(f"⚠️  {e}")
            self.model = None
            self._yolo_detect = None

    def is_loaded(self):
        return self.model is not None

    def _to_pil(self, image):
        """Convert any image input to a RGB PIL Image."""
        if isinstance(image, (str, Path)):
            return Image.open(image).convert("RGB")
        if isinstance(image, np.ndarray):
            if len(image.shape) == 3 and image.shape[2] == 3:
                return Image.fromarray(image[:, :, ::-1])  # BGR → RGB
            return Image.fromarray(image)
        return image  # assume PIL already

    def _yolo_result_to_dict(self, result) -> dict:
        """Convert a single Ultralytics classify result to a prediction dict."""
        probs = result.probs.data.cpu().numpy()
        # Class 0 = occupied, Class 1 = vacant (alphabetical folder order in YOLO classify dataset)
        prob_occupied = float(probs[0]) if len(probs) > 0 else 0.5
        if prob_occupied > 0.5:
            return {"status": "occupied", "confidence": round(prob_occupied, 4), "probability": round(prob_occupied, 4)}
        return {"status": "vacant", "confidence": round(1.0 - prob_occupied, 4), "probability": round(prob_occupied, 4)}

    def _yolo_detect_to_dict(self, result) -> dict:
        """Convert a YOLO26 detect result on a crop to occupied/vacant."""
        boxes = result.boxes
        if boxes is not None and len(boxes) > 0:
            conf = float(boxes.conf.max().cpu().numpy())
            return {"status": "occupied", "confidence": round(conf, 4), "probability": round(conf, 4)}
        return {"status": "vacant", "confidence": 0.9, "probability": 0.1}

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

        if getattr(self, "_yolo_classify", None) is not None:
            pil_img = self._to_pil(image)
            results = self._yolo_classify.predict(pil_img, verbose=False)
            return self._yolo_result_to_dict(results[0])

        # Convert input to PIL Image
        pil_img = self._to_pil(image)

        # Preprocess
        tensor = self.transform(pil_img).unsqueeze(0).to(self.device)

        # Inference — model outputs raw logit; apply sigmoid to get probability
        output = self.model(tensor)
        prob = torch.sigmoid(output).squeeze().item()

        if prob > 0.5:
            status = "occupied"
            confidence = prob
        else:
            status = "vacant"
            confidence = 1.0 - prob

        if confidence < self.threshold:
            return {"status": "unknown", "confidence": round(confidence, 4), "probability": round(prob, 4)}

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

        if getattr(self, "_yolo_classify", None) is not None:
            pil_images = [self._to_pil(img) for img in images]
            results = self._yolo_classify.predict(pil_images, verbose=False)
            return [self._yolo_result_to_dict(r) for r in results]

        if getattr(self, "_yolo_detect", None) is not None:
            pil_images = [self._to_pil(img) for img in images]
            results = self._yolo_detect.predict(pil_images, verbose=False, conf=0.3)
            return [self._yolo_detect_to_dict(r) for r in results]

        # Preprocess all images
        tensors = []
        for img in images:
            pil_img = self._to_pil(img) if not isinstance(img, Image.Image) else img
            tensors.append(self.transform(pil_img))

        batch = torch.stack(tensors).to(self.device)
        outputs = torch.sigmoid(self.model(batch)).squeeze(1)

        results = []
        for prob in outputs.cpu().numpy():
            prob_f = float(prob)
            if prob_f > 0.5:
                status, confidence = "occupied", prob_f
            else:
                status, confidence = "vacant", 1.0 - prob_f
            if confidence < self.threshold:
                results.append({"status": "unknown", "confidence": round(confidence, 4), "probability": round(prob_f, 4)})
            else:
                results.append({"status": status, "confidence": round(confidence, 4), "probability": round(prob_f, 4)})

        return results
