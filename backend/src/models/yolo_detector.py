"""
YOLO26 Detector
================
Thin wrapper around Ultralytics YOLO26 for parking lot object detection.

This is a detector, not a classifier. Interface: predict_frame(frame_bgr) -> list[dict].
There is no forward() or sigmoid head. Training uses the Ultralytics CLI, not trainer.py.
"""

import numpy as np

# Painted bay-marking edges occasionally fire as phantom "vehicle" detections.
# They differ from real cars in shape: tiny area and/or a long thin sliver. Drop
# any detection below the minimum area or above the maximum aspect ratio so the
# anomaly/OUTSIDE path never sees them. Real vehicle boxes clear both bars.
_MIN_BOX_AREA     = 1500   # px²; smaller than the smallest plausible car box
_MAX_ASPECT_RATIO = 4.0    # longer:shorter side; a car box stays well under this


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

    def __init__(self, model_path: str, conf: float = 0.40, iou: float = 0.7,
                 imgsz: int | None = None):
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
        self._conf = conf
        self._iou = iou
        self._imgsz = imgsz

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
        # imgsz must be passed explicitly so it can't drift from the 640 the
        # NCNN edge path letterboxes to.
        kwargs = {}
        if self._imgsz:
            kwargs["imgsz"] = self._imgsz
        results = self.model(frame_bgr, verbose=False, conf=self._conf,
                             iou=self._iou, **kwargs)
        detections = []
        for r in results:
            for box in r.boxes:
                x1, y1, x2, y2 = box.xyxy[0].tolist()
                w, h = x2 - x1, y2 - y1
                if w <= 0 or h <= 0:
                    continue
                # Reject phantom detections off painted bay-marking edges.
                if w * h < _MIN_BOX_AREA:
                    continue
                if max(w, h) / min(w, h) > _MAX_ASPECT_RATIO:
                    continue
                detections.append({
                    "bbox":       [x1, y1, x2, y2],
                    "confidence": float(box.conf[0]),
                    "class_id":   int(box.cls[0]),
                })
        return detections


def load_vehicle_detector():
    """Build the detector used by the misparked-vehicle pass.

    Single-class ("vehicle") model fine-tuned on hand-corrected labels — the
    same checkpoint as the project's yolo26_detect model. On edge the torch
    .pt is absent, so the NCNN export is used when present.

    Both anomaly call sites go through here so the model and input size
    cannot drift apart between them.
    """
    import config

    if config.DEPLOYMENT_PROFILE == "edge" and config.VEHICLE_DETECT_NCNN_PATH.exists():
        from src.models.yolo_detector_ncnn import EdgeYoloDetector
        return EdgeYoloDetector(
            str(config.VEHICLE_DETECT_NCNN_PATH),
            conf=config.VEHICLE_DETECT_CONF,
        )
    return ParkingYOLO26(
        str(config.VEHICLE_DETECT_PATH),
        imgsz=config.YOLO_DETECT_IMG_SIZE,
        conf=config.VEHICLE_DETECT_CONF,
    )
