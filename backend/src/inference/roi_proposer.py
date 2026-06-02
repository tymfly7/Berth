"""
ROI Proposer — Automatic parking-spot candidate detection.

Runs YOLO vehicle detection (or falls back to contour detection) across one
or more BGR frames, clusters overlapping boxes across frames, and returns
candidate parking-spot polygons normalised to [0, 1].

IMPORTANT: Proposals reliably cover OCCUPIED spots (vehicles are visible in
the frame). Empty spots are only detected when use_line_detection=True and
painted stall markings are clearly visible. Always present proposals as
candidates requiring admin review — never as authoritative ROI definitions.
"""

import uuid
import logging
import numpy as np
import cv2

logger = logging.getLogger("smartpark.roi_proposer")

# Classes from the custom YOLO26 detect model (vacant=0, occupied=1)
_VEHICLE_CLASSES = frozenset([0, 1])


# ── IoU / clustering helpers ─────────────────────────────────────────────────

def _iou(a: list, b: list) -> float:
    ax1, ay1, ax2, ay2 = a
    bx1, by1, bx2, by2 = b
    ix1 = max(ax1, bx1)
    iy1 = max(ay1, by1)
    ix2 = min(ax2, bx2)
    iy2 = min(ay2, by2)
    inter = max(0.0, ix2 - ix1) * max(0.0, iy2 - iy1)
    ua = (ax2 - ax1) * (ay2 - ay1)
    ub = (bx2 - bx1) * (by2 - by1)
    denom = ua + ub - inter
    return inter / denom if denom > 0 else 0.0


def _cluster_boxes(boxes: list, iou_threshold: float = 0.3) -> list:
    """
    Merge overlapping boxes using union-find, returning one averaged box per cluster.
    Boxes are [x1, y1, x2, y2] in pixel coordinates.
    """
    if not boxes:
        return []
    n = len(boxes)
    parent = list(range(n))

    def find(i: int) -> int:
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    for i in range(n):
        for j in range(i + 1, n):
            if _iou(boxes[i], boxes[j]) >= iou_threshold:
                pi, pj = find(i), find(j)
                if pi != pj:
                    parent[pi] = pj

    clusters: dict[int, list] = {}
    for i in range(n):
        clusters.setdefault(find(i), []).append(boxes[i])

    return [np.mean(c, axis=0).tolist() for c in clusters.values()]


# ── Optional line-snapping ───────────────────────────────────────────────────

def _snap_to_lines(box: list, frame_bgr: np.ndarray) -> list:
    """
    Attempt to snap a bounding box to painted parking-lot markings via
    Canny edge detection + HoughLinesP. Returns the original box if no
    usable lines are found in the neighbourhood.
    """
    h, w = frame_bgr.shape[:2]
    x1, y1, x2, y2 = [int(v) for v in box]
    pad = 20
    rx1 = max(0, x1 - pad); ry1 = max(0, y1 - pad)
    rx2 = min(w, x2 + pad); ry2 = min(h, y2 + pad)
    region = frame_bgr[ry1:ry2, rx1:rx2]
    if region.size == 0:
        return box

    gray = cv2.cvtColor(region, cv2.COLOR_BGR2GRAY)
    edges = cv2.Canny(gray, 50, 150, apertureSize=3)
    lines = cv2.HoughLinesP(
        edges, 1, np.pi / 180,
        threshold=30, minLineLength=20, maxLineGap=5,
    )
    if lines is None:
        return box

    xs, ys = [], []
    for ln in lines:
        lx1, ly1, lx2, ly2 = ln[0]
        xs += [lx1 + rx1, lx2 + rx1]
        ys += [ly1 + ry1, ly2 + ry1]

    if not xs:
        return box

    sx1 = max(rx1, min(xs)); sy1 = max(ry1, min(ys))
    sx2 = min(rx2, max(xs)); sy2 = min(ry2, max(ys))
    if sx2 - sx1 < 10 or sy2 - sy1 < 10:
        return box
    return [float(sx1), float(sy1), float(sx2), float(sy2)]


# ── Coordinate conversion ────────────────────────────────────────────────────

def _box_to_polygon(box: list, w: int, h: int) -> list:
    """Convert pixel [x1,y1,x2,y2] box to a normalised [[x,y],...] quad (0–1)."""
    x1, y1, x2, y2 = box
    return [
        [round(x1 / w, 6), round(y1 / h, 6)],
        [round(x2 / w, 6), round(y1 / h, 6)],
        [round(x2 / w, 6), round(y2 / h, 6)],
        [round(x1 / w, 6), round(y2 / h, 6)],
    ]


# ── Contour fallback ─────────────────────────────────────────────────────────

def _contour_detect(frame_bgr: np.ndarray) -> list:
    """
    Detect rectangular blobs via Canny + contours when YOLO is unavailable.
    Returns a list of pixel boxes [[x1,y1,x2,y2], ...].
    """
    fh, fw = frame_bgr.shape[:2]
    max_area = fw * fh * 0.15

    gray = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2GRAY)
    blurred = cv2.GaussianBlur(gray, (5, 5), 0)
    edges = cv2.Canny(blurred, 30, 100)
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5))
    dilated = cv2.dilate(edges, kernel, iterations=2)

    contours, _ = cv2.findContours(dilated, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    boxes = []
    for cnt in contours:
        area = cv2.contourArea(cnt)
        if area < 1500 or area > max_area:
            continue
        x, y, cw, ch = cv2.boundingRect(cnt)
        aspect = cw / max(ch, 1)
        if aspect > 5 or aspect < 0.2:
            continue
        boxes.append([float(x), float(y), float(x + cw), float(y + ch)])
    return boxes


# ── Public API ───────────────────────────────────────────────────────────────

def propose_from_frames(
    frames: list,
    camera_id: str = "default",
    use_line_detection: bool = False,
    conf_threshold: float = 0.25,
    iou_threshold: float = 0.3,
) -> list:
    """
    Propose candidate parking-spot ROIs from one or more BGR frames.

    Detection pipeline:
      1. Ultralytics YOLO with pretrained COCO weights (auto-downloaded on first
         call; ~6 MB for yolo11n). Falls back to contour detection if ultralytics
         is not installed or all model candidates fail to load.
      2. Detections are accumulated across all frames and clustered by IoU.
      3. Optionally, each cluster box is snapped to painted line markings via
         Canny + HoughLinesP (gate with use_line_detection=True).
      4. Boxes are normalised to [0,1] and returned as ROI dicts.

    NOTE: Proposals reliably cover OCCUPIED spots. Empty spots are detected
    only when use_line_detection=True and stall markings are clearly visible.

    Args:
        frames:             List of BGR numpy arrays (OpenCV format).
        camera_id:          Camera identifier (passed for future context use).
        use_line_detection: Snap boxes to line markings (optional refinement).
        conf_threshold:     Minimum YOLO confidence score.
        iou_threshold:      IoU threshold for merging overlapping boxes.

    Returns:
        list[dict] — proposed ROI dicts NOT persisted, each containing:
            id (str), label (str), polygon (list[[x,y]]), proposed (True).
    """
    if not frames:
        return []

    fh, fw = frames[0].shape[:2]
    all_boxes: list = []

    # ── 1. YOLO vehicle detection ────────────────────────────────
    try:
        from ultralytics import YOLO
        import config as cfg
        from pathlib import Path

        # Project YOLO model first, then a small pretrained fallback
        candidates = [str(cfg.YOLO26_DETECT_PATH), "yolo11n.pt"]
        yolo_model = None
        for candidate in candidates:
            try:
                yolo_model = YOLO(candidate)
                logger.info(f"ROI proposer: loaded YOLO from '{candidate}'")
                break
            except Exception as exc:
                logger.debug(f"ROI proposer: skipping '{candidate}' — {exc}")

        if yolo_model is not None:
            for frame in frames:
                results = yolo_model(frame, verbose=False, conf=conf_threshold)
                for r in results:
                    for box in r.boxes:
                        if int(box.cls[0]) in _VEHICLE_CLASSES:
                            all_boxes.append(box.xyxy[0].tolist())

    except ImportError:
        logger.info("ROI proposer: ultralytics not installed — using contour fallback")
    except Exception as exc:
        logger.warning(f"ROI proposer: YOLO step failed ({exc}) — using contour fallback")

    # ── 2. Contour fallback ───────────────────────────────────────
    if not all_boxes:
        logger.info("ROI proposer: running contour-based detection")
        for frame in frames:
            all_boxes.extend(_contour_detect(frame))

    if not all_boxes:
        logger.info("ROI proposer: no detections found")
        return []

    # ── 3. Cluster overlapping boxes across frames ────────────────
    clusters = _cluster_boxes(all_boxes, iou_threshold=iou_threshold)

    # ── 4. Optional line snapping ─────────────────────────────────
    if use_line_detection and clusters:
        ref = frames[0]
        clusters = [_snap_to_lines(box, ref) for box in clusters]

    # ── 5. Convert to normalised polygon ROI dicts ────────────────
    proposals = []
    for i, box in enumerate(clusters):
        polygon = _box_to_polygon(box, fw, fh)
        if all(0.0 <= pt[0] <= 1.0 and 0.0 <= pt[1] <= 1.0 for pt in polygon):
            proposals.append({
                "id": f"prop_{uuid.uuid4().hex[:8]}",
                "label": f"Spot {i + 1}",
                "polygon": polygon,
                "proposed": True,
            })

    logger.info(
        f"ROI proposer: {len(proposals)} candidate spot(s) from {len(frames)} frame(s)"
    )
    return proposals
