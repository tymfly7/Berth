"""
YOLO26 Detector
================
Thin wrapper around Ultralytics YOLO26 for parking lot object detection.

This is a detector, not a classifier. Interface: predict_frame(frame_bgr) -> list[dict].
There is no forward() or sigmoid head. Training uses the Ultralytics CLI, not trainer.py.
"""

import numpy as np


class ParkingYOLO26:
    """
    Thin wrapper around Ultralytics YOLO26 for parking lot object detection.

    IMPORTANT: This class does NOT follow the sigmoid-output binary classifier
    interface used by ParkingCNN and ParkingMobileNet. It is an object detector
    that returns bounding boxes, confidence scores, and class IDs for objects
    found in a full frame — not a per-patch occupied/vacant probability.
    Use predict_frame() for inference; there is no forward() or classifier head.

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
