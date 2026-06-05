"""
Parking geometry helpers — classify vehicle parking status against ROI polygons.

All boxes are pixel coordinates [x1, y1, x2, y2].
ROI polygons are stored as normalized [[x, y], ...] lists (values in [0, 1]).
Misparked classification clips the car box against the *actual* ROI polygon
(Sutherland–Hodgman, pure Python — no extra deps) so it stays correct for angled
(e.g. 45°) stalls, whose axis-aligned bounding boxes overlap their neighbours even
when the real stalls don't. Occupancy still uses a fast bounding-box IoU.
"""

from __future__ import annotations

# A double-parked car spans two lanes, so we measure how much of the CAR's area
# falls inside each spot (overlap_fraction), not IoU. IoU divides by the union, so
# it collapses whenever the spot box and the car differ in size — which is exactly
# when a correctly-parked car in a generously-drawn or angled spot got falsely
# flagged "outside markings". Fraction-of-car is size-robust: a parked car reads
# ~1.0 inside its spot; a straddling car reads ~0.5 in each of two spots.
_STRADDLE_FRAC   = 0.35   # ≥ this fraction of the car inside ≥ 2 spots → straddling
_OUTSIDE_FRAC    = 0.10   # car's best overlap with any spot below this → outside markings
_OCCUPIED_THRESH = 0.20   # IoU threshold for marking a slot occupied (unchanged)


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


# ── Polygon-accurate overlap (for angled stalls) ──────────────────────────────

def _polygon_area(pts: list) -> float:
    """Shoelace area of a polygon given as [(x, y), ...]."""
    n = len(pts)
    if n < 3:
        return 0.0
    s = 0.0
    for i in range(n):
        x1, y1 = pts[i]
        x2, y2 = pts[(i + 1) % n]
        s += x1 * y2 - x2 * y1
    return abs(s) * 0.5


def _clip_polygon_to_rect(pts: list, rx1: float, ry1: float,
                          rx2: float, ry2: float) -> list:
    """Sutherland–Hodgman clip of polygon `pts` ([(x,y),...]) to the axis-aligned
    rectangle [rx1,ry1,rx2,ry2]. Returns the clipped polygon (empty if disjoint)."""
    def _clip(poly, inside, isect):
        out = []
        for i in range(len(poly)):
            a, b = poly[i - 1], poly[i]
            a_in, b_in = inside(a), inside(b)
            if b_in:
                if not a_in:
                    out.append(isect(a, b))
                out.append(b)
            elif a_in:
                out.append(isect(a, b))
        return out

    def _x_cross(a, b, x):
        (ax, ay), (bx, by) = a, b
        t = 0.0 if bx == ax else (x - ax) / (bx - ax)
        return (x, ay + t * (by - ay))

    def _y_cross(a, b, y):
        (ax, ay), (bx, by) = a, b
        t = 0.0 if by == ay else (y - ay) / (by - ay)
        return (ax + t * (bx - ax), y)

    pts = _clip(pts, lambda p: p[0] >= rx1, lambda a, b: _x_cross(a, b, rx1))
    if pts:
        pts = _clip(pts, lambda p: p[0] <= rx2, lambda a, b: _x_cross(a, b, rx2))
    if pts:
        pts = _clip(pts, lambda p: p[1] >= ry1, lambda a, b: _y_cross(a, b, ry1))
    if pts:
        pts = _clip(pts, lambda p: p[1] <= ry2, lambda a, b: _y_cross(a, b, ry2))
    return pts


def car_overlap_polygon(car_box: list, polygon_norm: list,
                        frame_w: int, frame_h: int) -> float:
    """Fraction of the car box's area that lies inside the *actual* ROI polygon.

    Unlike overlap_fraction (which uses the polygon's bounding box), this clips
    against the real polygon, so a car correctly parked in one 45°-angled stall
    is not counted as overlapping the neighbouring stall just because their
    bounding boxes overlap.
    """
    x1, y1, x2, y2 = car_box
    car_area = (x2 - x1) * (y2 - y1)
    if car_area <= 0:
        return 0.0
    poly_px = [(p[0] * frame_w, p[1] * frame_h) for p in polygon_norm]
    clipped = _clip_polygon_to_rect(poly_px, x1, y1, x2, y2)
    return _polygon_area(clipped) / car_area


# ── Per-vehicle classification ─────────────────────────────────────────────────

def classify_vehicle_parking(
    car_box: list,
    roi_polygons: list,
    frame_w: int,
    frame_h: int,
    straddle_thresh: float = _STRADDLE_FRAC,
    outside_thresh: float = _OUTSIDE_FRAC,
) -> dict:
    """
    Classify a single detected vehicle bounding box against ROI polygons.

    Args:
        car_box:      Pixel bbox [x1, y1, x2, y2] of the detected car.
        roi_polygons: ROI dicts from RoiStore.get_rois() — each has 'id',
                      'label', 'polygon' (normalized coords).
        frame_w/h:    Pixel dimensions used to denormalize polygon coords.
        straddle_thresh: fraction of the car inside a spot that counts as
                         "intruding" it. A car intruding ≥ 2 spots is straddling.
        outside_thresh:  if the car's best overlap fraction across all spots is
                         below this, it is parked outside the markings entirely.

    Returns dict:
        status:        "ok" | "misparked"
        reason:        None | "straddling" | "outside_markings"
        overlaps:      list of {"roi_id", "label", "overlap"} for every ROI
        intruded_rois: list of roi_id strings with overlap ≥ straddle_thresh
    """
    overlaps = []
    for roi in roi_polygons:
        polygon = roi.get("polygon", [])
        if len(polygon) < 3:
            continue
        # Fraction of the car inside the actual spot POLYGON (not its bounding
        # box) — bounding boxes of 45°-angled stalls overlap their neighbours.
        frac = car_overlap_polygon(car_box, polygon, frame_w, frame_h)
        overlaps.append({
            "roi_id": roi.get("id"),
            "label": roi.get("label", "Slot"),
            "overlap": round(frac, 4),
        })

    if not overlaps:
        return {"status": "ok", "reason": None, "overlaps": overlaps, "intruded_rois": []}

    max_overlap = max(e["overlap"] for e in overlaps)

    if max_overlap < outside_thresh:
        return {
            "status": "misparked",
            "reason": "outside_markings",
            "overlaps": overlaps,
            "intruded_rois": [],
        }

    intruded = [e["roi_id"] for e in overlaps if e["overlap"] >= straddle_thresh]
    if len(intruded) >= 2:
        return {
            "status": "misparked",
            "reason": "straddling",
            "overlaps": overlaps,
            "intruded_rois": intruded,
        }

    return {
        "status": "ok",
        "reason": None,
        "overlaps": overlaps,
        "intruded_rois": intruded,
    }


# ── Lot-level aggregation ──────────────────────────────────────────────────────

def aggregate_lot(
    cars: list,
    rois: list,
    frame_w: int,
    frame_h: int,
    straddle_thresh: float = _STRADDLE_FRAC,
    outside_thresh: float = _OUTSIDE_FRAC,
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
