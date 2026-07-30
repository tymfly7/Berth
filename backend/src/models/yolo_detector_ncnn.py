"""
YOLO26 Detector — NCNN (torch-free) edge variant
=================================================
Drop-in replacement for ParkingYOLO26 on ARM64 edge nodes. Runs the exported
NCNN detect model via the ncnn Python package — no torch, no ultralytics.

Interface mirrors ParkingYOLO26: predict_frame(frame_bgr) -> list[dict] with the
same 'bbox'/'confidence'/'class_id' shape and the same phantom-box filters.

The exported head (end2end:false) already does DFL + anchor decode and sigmoids
the class scores, so out0 is (4+nc, N): rows 0:4 = cx,cy,w,h in 960-letterbox
pixels, rows 4: = per-class scores. This wrapper only has to threshold, run a
class-agnostic NMS, and map boxes back to source-frame pixels.
"""

import logging
from pathlib import Path

import numpy as np
import ncnn

import config

logger = logging.getLogger("berth.edge_detector")

# Mirror ParkingYOLO26's phantom-detection filters (painted bay-marking edges).
_MIN_BOX_AREA     = 1500   # px²
_MAX_ASPECT_RATIO = 4.0    # longer:shorter side


class EdgeYoloDetector:
    """Torch-free NCNN detector, drop-in for ParkingYOLO26."""

    _INPUT_LAYER  = "in0"
    _OUTPUT_LAYER = "out0"
    _IMGSZ        = config.YOLO_DETECT_IMG_SIZE   # 640

    def __init__(self, model_path: str, conf: float = 0.40, iou: float = 0.7):
        model_dir  = Path(model_path)
        param_path = model_dir / "model.ncnn.param"
        bin_path   = model_dir / "model.ncnn.bin"
        if not param_path.exists():
            raise FileNotFoundError(
                f"NCNN detect model not found at '{model_dir}'. Export it on the hub first."
            )
        net = ncnn.Net()
        net.opt.num_threads = 1
        net.load_param(str(param_path))
        net.load_model(str(bin_path))
        self._net  = net
        self._conf = conf
        self._iou  = iou

    # ── Preprocessing ─────────────────────────────────────────────────────────

    def _letterbox(self, frame_bgr: np.ndarray):
        """Resize (keep aspect) + pad to _IMGSZ² with gray 114, BGR→RGB, /255, CHW.
        Returns (chw_float32, scale, pad_x, pad_y) to map boxes back to frame px."""
        import cv2
        h, w = frame_bgr.shape[:2]
        scale = min(self._IMGSZ / w, self._IMGSZ / h)
        new_w, new_h = round(w * scale), round(h * scale)
        resized = cv2.resize(frame_bgr, (new_w, new_h), interpolation=cv2.INTER_LINEAR)
        pad_x = (self._IMGSZ - new_w) / 2.0
        pad_y = (self._IMGSZ - new_h) / 2.0
        canvas = np.full((self._IMGSZ, self._IMGSZ, 3), 114, dtype=np.uint8)
        top, left = int(round(pad_y - 0.1)), int(round(pad_x - 0.1))
        canvas[top:top + new_h, left:left + new_w] = resized
        rgb = canvas[:, :, ::-1].astype(np.float32) / 255.0
        chw = np.ascontiguousarray(rgb.transpose(2, 0, 1), dtype=np.float32)
        return chw, scale, left, top

    # ── Inference ─────────────────────────────────────────────────────────────

    def predict_frame(self, frame_bgr: np.ndarray) -> list:
        """Run NCNN detect on a BGR frame → list[{'bbox','confidence','class_id'}]."""
        chw, scale, pad_x, pad_y = self._letterbox(frame_bgr)
        ex = self._net.create_extractor()
        ex.input(self._INPUT_LAYER, ncnn.Mat(chw))
        _, out = ex.extract(self._OUTPUT_LAYER)
        arr = np.array(out)                       # (4+nc, N) or (N, 4+nc)
        if arr.ndim != 2:
            return []
        # Orient features-first: nc+4 (small) along axis 0, anchors (large) along axis 1.
        if arr.shape[0] > arr.shape[1]:
            arr = arr.T

        boxes_xywh = arr[:4]                       # (4, N) — cx,cy,w,h in letterbox px
        scores     = arr[4:]                       # (nc, N) — already sigmoided
        cls_conf   = scores.max(axis=0)
        cls_id     = scores.argmax(axis=0)

        keep = cls_conf >= self._conf
        if not np.any(keep):
            return []
        cx, cy, bw, bh = boxes_xywh[:, keep]
        cls_conf = cls_conf[keep]
        cls_id   = cls_id[keep]

        # xywh (letterbox px) → xyxy → undo letterbox → source-frame px.
        x1 = (cx - bw / 2.0 - pad_x) / scale
        y1 = (cy - bh / 2.0 - pad_y) / scale
        x2 = (cx + bw / 2.0 - pad_x) / scale
        y2 = (cy + bh / 2.0 - pad_y) / scale
        boxes = np.stack([x1, y1, x2, y2], axis=1)  # (M, 4)

        keep_idx = self._nms(boxes, cls_conf, self._iou)

        detections = []
        for i in keep_idx:
            bx1, by1, bx2, by2 = boxes[i]
            w, h = bx2 - bx1, by2 - by1
            if w <= 0 or h <= 0:
                continue
            # Reject phantom detections off painted bay-marking edges.
            if w * h < _MIN_BOX_AREA:
                continue
            if max(w, h) / min(w, h) > _MAX_ASPECT_RATIO:
                continue
            detections.append({
                "bbox":       [float(bx1), float(by1), float(bx2), float(by2)],
                "confidence": float(cls_conf[i]),
                "class_id":   int(cls_id[i]),
            })
        return detections

    @staticmethod
    def _nms(boxes: np.ndarray, scores: np.ndarray, iou_thresh: float) -> list:
        """Class-agnostic NMS. boxes: (N,4) xyxy, scores: (N,). Returns kept indices."""
        if len(boxes) == 0:
            return []
        x1, y1, x2, y2 = boxes[:, 0], boxes[:, 1], boxes[:, 2], boxes[:, 3]
        areas = np.maximum(0.0, x2 - x1) * np.maximum(0.0, y2 - y1)
        order = scores.argsort()[::-1]
        keep = []
        while order.size > 0:
            i = order[0]
            keep.append(int(i))
            xx1 = np.maximum(x1[i], x1[order[1:]])
            yy1 = np.maximum(y1[i], y1[order[1:]])
            xx2 = np.minimum(x2[i], x2[order[1:]])
            yy2 = np.minimum(y2[i], y2[order[1:]])
            inter = np.maximum(0.0, xx2 - xx1) * np.maximum(0.0, yy2 - yy1)
            union = areas[i] + areas[order[1:]] - inter
            iou = np.where(union > 0, inter / union, 0.0)
            order = order[1:][iou <= iou_thresh]
        return keep
