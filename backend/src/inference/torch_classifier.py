"""
Parking Classifier — Single-Image Inference (torch backend)
============================================================
Loads a trained model and classifies a single parking space image as occupied
or vacant with confidence score. This is the full torch/torchvision/ultralytics
path used on the server profile (and as the non-edge fallback); the edge profile
routes to the torch-free NCNN classifiers via classifier.get_classifier().
"""

import sys
import logging
import threading
from pathlib import Path
import torch
import numpy as np
from PIL import Image
from torchvision import transforms
import config


logger = logging.getLogger("berth.classifier")
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

# Keep torch single-threaded per op so several concurrent inference workers can't
# each fan out to every core and starve the API event loop. See main.py.
torch.set_num_threads(1)


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

    _INFERENCE_MODELS = set(config.CLASSIFY_MODELS)

    def __init__(self, model_name=None, device=None, confidence_threshold=None):
        candidate = model_name or config.ACTIVE_MODEL
        self.model_name = candidate if candidate in self._INFERENCE_MODELS else None
        self.device = device or torch.device("cuda" if torch.cuda.is_available() else "cpu")
        self.threshold = confidence_threshold or config.CNN_CONFIDENCE_THRESHOLD
        self.model = None
        self._loaded = False
        # Ultralytics YOLO objects are not thread-safe for concurrent predict()
        # (the first call fuses the model, deleting Conv.bn). Multiple
        # InferencePool workers share one classifier per camera, so serialize.
        self._infer_lock = threading.Lock()

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
            return
        if self.model_name.startswith("yolo26") and self.model_name.endswith("_classify"):
            self._load_yolo_classify(self.model_name[len("yolo26")])  # scale: n|s|m
            return
        from src.models.model_factory import load_model
        try:
            self.model = load_model(self.model_name, device=self.device)
            self._loaded = True
            logger.info(f"✅ Loaded model: {self.model_name} on {self.device}")
        except (FileNotFoundError, ValueError) as e:
            logger.warning(f"⚠️  {e}")
            self.model = None
        self._yolo_classify = None

    def _load_yolo_classify(self, scale):
        """Load a YOLO26 classify model at the given scale ('n'|'s'|'m')."""
        try:
            from ultralytics import YOLO
            ncnn_path = config.YOLO26_CLASSIFY_NCNN_PATHS[scale]
            if config.DEPLOYMENT_PROFILE == "edge" and ncnn_path.exists():
                model_path = ncnn_path
            else:
                model_path = config.YOLO26_CLASSIFY_PATHS[scale]
                if not model_path.exists():
                    raise FileNotFoundError(
                        f"YOLO26 classify weights not found at '{model_path}'. Train it first."
                    )
            self._yolo_classify = YOLO(str(model_path), task="classify")
            self._loaded = True
            logger.info(f"✅ Loaded yolo26{scale}_classify model on {self.device}")
        except Exception as e:
            logger.warning(f"⚠️  YOLO26 classify failed to load: {e}")
            self.model = None
            self._yolo_classify = None

    def is_loaded(self):
        return self._loaded

    def _to_pil(self, image):
        """Convert any image input to a RGB PIL Image."""
        if isinstance(image, (str, Path)):
            return Image.open(image).convert("RGB")
        if isinstance(image, np.ndarray):
            if len(image.shape) == 3 and image.shape[2] == 3:
                return Image.fromarray(image[:, :, ::-1])  # BGR → RGB
            return Image.fromarray(image)
        return image  # assume PIL already

    @staticmethod
    def _letterbox_square(pil_img):
        """Pad a PIL image to a square with neutral gray so YOLO's resize doesn't
        squash non-square ROI crops. Aspect distortion of angled/perspective slots
        is the main source of occupied→vacant false negatives."""
        w, h = pil_img.size
        if w == h:
            return pil_img
        side = max(w, h)
        canvas = Image.new("RGB", (side, side), (114, 114, 114))
        canvas.paste(pil_img, ((side - w) // 2, (side - h) // 2))
        return canvas

    def _yolo_result_to_dict(self, result) -> dict:
        """Convert a single Ultralytics classify result to a prediction dict."""
        probs = result.probs.data.cpu().numpy()
        # Class 0 = occupied, Class 1 = vacant (alphabetical folder order in YOLO classify dataset)
        prob_occupied = float(probs[0]) if len(probs) > 0 else 0.5
        # Bias toward "occupied" via a sub-0.5 threshold to cut false negatives
        # (taken spots reported as vacant). Tunable via config.OCCUPANCY_THRESHOLD.
        if prob_occupied > config.OCCUPANCY_THRESHOLD:
            return {"status": "occupied", "confidence": round(prob_occupied, 4), "probability": round(prob_occupied, 4)}
        return {"status": "vacant", "confidence": round(1.0 - prob_occupied, 4), "probability": round(prob_occupied, 4)}

    @torch.no_grad()
    def predict(self, image):
        """Classify a parking space image. Returns {status, confidence, probability}."""
        if not self.is_loaded():
            return {"status": "unknown", "confidence": 0.0, "probability": 0.5}

        if getattr(self, "_yolo_classify", None) is not None:
            pil_img = self._letterbox_square(self._to_pil(image))
            with self._infer_lock:
                results = self._yolo_classify.predict(pil_img, verbose=False)
            return self._yolo_result_to_dict(results[0])

        pil_img = self._to_pil(image)
        tensor = self.transform(pil_img).unsqueeze(0).to(self.device)
        # model outputs raw logit; apply sigmoid to get probability
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
        """Classify a batch of parking space images. Returns list of prediction dicts."""
        if not self.is_loaded():
            return [{"status": "unknown", "confidence": 0.0, "probability": 0.5}
                    for _ in images]

        if getattr(self, "_yolo_classify", None) is not None:
            # NCNN backend can't batch a list of crops — Ultralytics throws
            # "list index out of range" per frame. Loop one image at a time
            # through the single-image path instead.
            return [self.predict(img) for img in images]

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
