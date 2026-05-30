"""
Parking geometry helpers — classify vehicle parking status against ROI polygons.

All boxes are pixel coordinates [x1, y1, x2, y2].
ROI polygons are stored as normalized [[x, y], ...] lists (values in [0, 1]).
Bounding-box approximations are used for polygon↔box intersection (pure numpy,
no extra deps). This is accurate for the axis-aligned quadrilateral spots that
the ROI editor produces.
"""

from __future__ import annotations

_STRADDLE_THRESH = 0.15   # IoU with ≥ 2 ROIs above this → straddling
_OUTSIDE_THRESH  = 0.20   # max IoU below this with every ROI → outside markings
_OCCUPIED_THRESH = 0.20   # IoU threshold for marking a slot occupied


# ── Low-level helpers ─────────────────────────────────────────────────────────

def _poly_to_pixel_bbox(polygon_norm: list, frame_w: int, frame_h: int) -> list:
    """Convert normalized polygon [[x,y], ...] to pixel bbox [x1, y1, x2, y2]."""
    xs = [p[0] * frame_w for p in polygon_norm]
    ys = [p[1] * frame_h for p in polygon_norm]
    return [min(xs), min(ys), max(xs), max(ys)]


def box_iou(box_a: list, box_b: list) -> float:
    """Intersection-over-union of two [x1, y1, x2, y2] boxes."""
    xa1, ya1, xa2, ya2 = box_a
    xb1, yb1, xb2, yb2 = box_b

    ix1 = max(xa1, xb1)
    iy1 = max(ya1, yb1)
    ix2 = min(xa2, xb2)
    iy2 = min(ya2, yb2)

    if ix2 <= ix1 or iy2 <= iy1:
        return 0.0

    inter = (ix2 - ix1) * (iy2 - iy1)
    area_a = (xa2 - xa1) * (ya2 - ya1)
    area_b = (xb2 - xb1) * (yb2 - yb1)
    union = area_a + area_b - inter
    return inter / union if union > 0 else 0.0


def overlap_fraction(box_car: list, box_roi: list) -> float:
    """Fraction of box_car's area that overlaps box_roi."""
    xa1, ya1, xa2, ya2 = box_car
    xb1, yb1, xb2, yb2 = box_roi

    ix1 = max(xa1, xb1)
    iy1 = max(ya1, yb1)
    ix2 = min(xa2, xb2)
    iy2 = min(ya2, yb2)

    if ix2 <= ix1 or iy2 <= iy1:
        return 0.0

    inter = (ix2 - ix1) * (iy2 - iy1)
    car_area = (xa2 - xa1) * (ya2 - ya1)
    return inter / car_area if car_area > 0 else 0.0


# ── Per-vehicle classification ─────────────────────────────────────────────────

def classify_vehicle_parking(
    car_box: list,
    roi_polygons: list,
    frame_w: int,
    frame_h: int,
    straddle_thresh: float = _STRADDLE_THRESH,
    outside_thresh: float = _OUTSIDE_THRESH,
) -> dict:
    """
    Classify a single detected vehicle bounding box against ROI polygons.

    Args:
        car_box:      Pixel bbox [x1, y1, x2, y2] of the detected car.
        roi_polygons: ROI dicts from RoiStore.get_rois() — each has 'id',
                      'label', 'polygon' (normalized coords).
        frame_w/h:    Pixel dimensions used to denormalize polygon coords.
        straddle_thresh: IoU with a spot that counts as "intruding" that spot.
                         A car intruding ≥ 2 spots is straddling.
        outside_thresh:  Max IoU across all spots below which the car is
                         considered outside markings entirely.

    Returns dict:
        status:        "ok" | "misparked"
        reason:        None | "straddling" | "outside_markings"
        ious:          list of {"roi_id", "label", "iou"} for every ROI
        intruded_rois: list of roi_id strings with IoU ≥ straddle_thresh
    """
    ious = []
    for roi in roi_polygons:
        polygon = roi.get("polygon", [])
        if len(polygon) < 3:
            continue
        roi_box = _poly_to_pixel_bbox(polygon, frame_w, frame_h)
        iou = box_iou(car_box, roi_box)
        ious.append({
            "roi_id": roi.get("id"),
            "label": roi.get("label", "Slot"),
            "iou": round(iou, 4),
        })

    if not ious:
        return {"status": "ok", "reason": None, "ious": ious, "intruded_rois": []}

    max_iou = max(e["iou"] for e in ious)

    if max_iou < outside_thresh:
        return {
            "status": "misparked",
            "reason": "outside_markings",
            "ious": ious,
            "intruded_rois": [],
        }

    intruded = [e["roi_id"] for e in ious if e["iou"] >= straddle_thresh]
    if len(intruded) >= 2:
        return {
            "status": "misparked",
            "reason": "straddling",
            "ious": ious,
            "intruded_rois": intruded,
        }

    return {
        "status": "ok",
        "reason": None,
        "ious": ious,
        "intruded_rois": intruded,
    }


# ── Lot-level aggregation ──────────────────────────────────────────────────────

def aggregate_lot(
    cars: list,
    rois: list,
    frame_w: int,
    frame_h: int,
    straddle_thresh: float = _STRADDLE_THRESH,
    outside_thresh: float = _OUTSIDE_THRESH,
    occupied_thresh: float = _OCCUPIED_THRESH,
) -> dict:
    """
    Aggregate per-spot occupancy and flag misparked vehicles.

    Args:
        cars:     List of dicts with at least 'bbox' ([x1,y1,x2,y2] pixels)
                  and optionally 'confidence'.
        rois:     ROI dicts from RoiStore.get_rois().
        frame_w/h: Pixel dimensions of the source frame.

    Returns:
        total:          Number of ROI spots.
        available:      Vacant spots.
        occupied:       Occupied spots.
        misparked_count: Number of misparked vehicles.
        slots:          [{"id", "label", "status": "vacant"|"occupied"}]
        misparked:      [{"bbox", "confidence", "reason", "intruded_rois"}]
    """
    slots = []
    for roi in rois:
        polygon = roi.get("polygon", [])
        if len(polygon) < 3:
            continue
        roi_box = _poly_to_pixel_bbox(polygon, frame_w, frame_h)
        is_occupied = any(
            box_iou(car["bbox"], roi_box) >= occupied_thresh for car in cars
        )
        slots.append({
            "id": roi.get("id"),
            "label": roi.get("label", "Slot"),
            "status": "occupied" if is_occupied else "vacant",
        })

    misparked = []
    for car in cars:
        result = classify_vehicle_parking(
            car["bbox"], rois, frame_w, frame_h, straddle_thresh, outside_thresh
        )
        if result["status"] == "misparked":
            misparked.append({
                "bbox": car["bbox"],
                "confidence": car.get("confidence", 0.0),
                "reason": result["reason"],
                "intruded_rois": result["intruded_rois"],
            })

    total = len(slots)
    occupied = sum(1 for s in slots if s["status"] == "occupied")

    return {
        "total": total,
        "available": total - occupied,
        "occupied": occupied,
        "misparked_count": len(misparked),
        "slots": slots,
        "misparked": misparked,
    }
