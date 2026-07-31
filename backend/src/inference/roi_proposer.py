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
from typing import Optional

import numpy as np
import cv2

logger = logging.getLogger("berth.roi_proposer")

# Class id from the project's single-class ("vehicle") detect model.
_VEHICLE_CLASSES = frozenset([0])


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

def _snap_to_lines(box: list, frame_bgr: np.ndarray) -> Optional[list]:
    """
    Attempt to snap a bounding box to painted parking-lot markings via
    Canny edge detection + HoughLinesP, returning an ORIENTED quad that
    follows the marking angle (important for angled stalls).

    Returns a list of 4 pixel corners [[x, y], ...], or None if no usable
    markings are found in the neighbourhood (caller falls back to the AABB).
    """
    h, w = frame_bgr.shape[:2]
    x1, y1, x2, y2 = [int(v) for v in box]
    pad = 20
    rx1 = max(0, x1 - pad)
    ry1 = max(0, y1 - pad)
    rx2 = min(w, x2 + pad)
    ry2 = min(h, y2 + pad)
    region = frame_bgr[ry1:ry2, rx1:rx2]
    if region.size == 0:
        return None

    gray = cv2.cvtColor(region, cv2.COLOR_BGR2GRAY)
    edges = cv2.Canny(gray, 50, 150, apertureSize=3)
    lines = cv2.HoughLinesP(
        edges, 1, np.pi / 180,
        threshold=30, minLineLength=20, maxLineGap=5,
    )
    if lines is None or len(lines) < 2:
        return None

    pts = []
    for ln in lines:
        lx1, ly1, lx2, ly2 = ln[0]
        pts.append([lx1 + rx1, ly1 + ry1])
        pts.append([lx2 + rx1, ly2 + ry1])

    pts = np.array(pts, dtype=np.float32)
    # minAreaRect yields a rotated rectangle, preserving the stall angle.
    rect = cv2.minAreaRect(pts)
    (rw, rh) = rect[1]
    if rw < 10 or rh < 10:
        return None

    corners = cv2.boxPoints(rect)
    return [[float(np.clip(px, 0, w)), float(np.clip(py, 0, h))] for px, py in corners]


# ── Angled-layout estimation (no markings) ───────────────────────────────────

def _estimate_layout_angle(boxes: list, min_boxes: int = 3) -> Optional[float]:
    """
    Estimate the dominant row orientation (radians) from the arrangement of box
    centers via PCA. Angled stalls repeat along a row, so the principal axis of
    the cluster centers approximates the row direction.

    Returns None when there are too few boxes or no clearly dominant axis (a
    blob rather than a row), so the caller keeps axis-aligned output.
    """
    if len(boxes) < min_boxes:
        return None
    centers = np.array([[(b[0] + b[2]) / 2.0, (b[1] + b[3]) / 2.0] for b in boxes])
    centered = centers - centers.mean(axis=0)
    cov = np.cov(centered, rowvar=False)
    eigvals, eigvecs = np.linalg.eigh(cov)  # ascending; largest axis last
    if eigvals[-1] <= 1e-6 or eigvals[-1] / max(eigvals[0], 1e-6) < 3.0:
        return None
    vx, vy = eigvecs[:, -1]
    return float(np.arctan2(vy, vx))


# ── Coordinate conversion ────────────────────────────────────────────────────

def _box_corners(box: list) -> list:
    """Convert pixel [x1,y1,x2,y2] box to its 4 axis-aligned pixel corners."""
    x1, y1, x2, y2 = box
    return [[x1, y1], [x2, y1], [x2, y2], [x1, y2]]


def _oriented_quad(box: list, angle: float, frame_w: int, frame_h: int) -> list:
    """Rotate a box's corners by `angle` (radians) about its center, clamped."""
    x1, y1, x2, y2 = box
    cx, cy = (x1 + x2) / 2.0, (y1 + y2) / 2.0
    hw, hh = (x2 - x1) / 2.0, (y2 - y1) / 2.0
    ca, sa = np.cos(angle), np.sin(angle)
    quad = []
    for dx, dy in ((-hw, -hh), (hw, -hh), (hw, hh), (-hw, hh)):
        px = cx + dx * ca - dy * sa
        py = cy + dx * sa + dy * ca
        quad.append([float(np.clip(px, 0, frame_w)), float(np.clip(py, 0, frame_h))])
    return quad


def _quad_to_polygon(quad: list, w: int, h: int) -> list:
    """Convert a pixel quad [[x,y],...] to a normalised [[x,y],...] quad (0–1)."""
    return [[round(px / w, 6), round(py / h, 6)] for px, py in quad]


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
      1. Ultralytics YOLO — the project's YOLO26 detect weights first, then
         COCO-pretrained yolo26s.pt (auto-downloaded on first call). Falls back
         to contour detection if ultralytics is not installed or all model
         candidates fail to load.
      2. Detections are accumulated across all frames and clustered by IoU.
      3. Angled-parking handling:
           - use_line_detection=True: each cluster is snapped to painted
             markings via Canny + HoughLinesP + minAreaRect, yielding an
             ORIENTED quad that follows the stall angle (AABB fallback when no
             markings are found).
           - use_line_detection=False: the dominant row angle is estimated
             from the cluster layout (PCA over box centers) and applied to all
             boxes; axis-aligned when no clear row is detected.
      4. Quads are normalised to [0,1] and returned as editable ROI dicts.

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

        # Project YOLO model first, then a small pretrained fallback
        candidates = [str(cfg.YOLO26_DETECT_PATH), "yolo26s.pt"]
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
                # Match the resolution the detect model was trained at (640) —
                # pinned explicitly so it can't drift from ultralytics' own default.
                results = yolo_model(
                    frame, verbose=False, conf=conf_threshold,
                    imgsz=cfg.YOLO_DETECT_IMG_SIZE,
                )
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

    # ── 4. Build oriented pixel quads (angled-parking aware) ──────
    quads: list = []
    if use_line_detection and clusters:
        # Snap each box to painted markings; oriented quad or AABB fallback.
        ref = frames[0]
        for box in clusters:
            snapped = _snap_to_lines(box, ref)
            quads.append(snapped if snapped is not None else _box_corners(box))
    else:
        # No markings: infer the row angle from the cluster layout, if any.
        angle = _estimate_layout_angle(clusters)
        if angle is not None:
            quads = [_oriented_quad(box, angle, fw, fh) for box in clusters]
        else:
            quads = [_box_corners(box) for box in clusters]

    # ── 5. Convert to normalised polygon ROI dicts ────────────────
    proposals = []
    for i, quad in enumerate(quads):
        polygon = _quad_to_polygon(quad, fw, fh)
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
