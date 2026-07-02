"""
Classifier dispatcher — torch-free
==================================
Routes classifier construction by deployment profile + model so the edge image
stays torch-free: edge nodes get the NCNN classifiers, everything else lazily
imports the full torch/ultralytics ParkingClassifier (src.inference.torch_classifier).

Keep this module free of top-level torch/torchvision/ultralytics imports — it sits
on the app startup graph (video_processor → slot_detector → classifier).
"""

import config

# CNN classifiers exported to NCNN for edge.
_EDGE_CNN_MODELS  = {"cnn_scratch", "resnet50", "mobilenetv4s"}
# YOLO26 classify head — shares one NCNN export for both selectable names.
_EDGE_YOLO_MODELS = {"yolo26_classify", "yolo26"}


def get_classifier(model_name=None, **kwargs):
    """Return the right classifier for the active deployment profile + model.

    On edge: CNN models → EdgeClassifier, YOLO classify → EdgeYoloClassifier
    (both torch-free NCNN). Otherwise: the full torch ParkingClassifier.
    """
    effective = model_name or config.ACTIVE_MODEL
    if config.DEPLOYMENT_PROFILE == "edge":
        if effective in _EDGE_CNN_MODELS:
            from src.inference.ncnn_classifier import EdgeClassifier
            return EdgeClassifier(model_name=model_name, **kwargs)
        if effective in _EDGE_YOLO_MODELS:
            from src.inference.ncnn_classifier import EdgeYoloClassifier
            return EdgeYoloClassifier(model_name=model_name, **kwargs)
    from src.inference.torch_classifier import ParkingClassifier
    return ParkingClassifier(model_name=model_name, **kwargs)
