"""
Unit tests for parking_geometry.py.

Run via pytest:  python -m pytest backend/tests/test_parking_geometry.py -v
Run directly:    python backend/tests/test_parking_geometry.py
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from src.inference.parking_geometry import (
    box_iou,
    overlap_fraction,
    classify_vehicle_parking,
    aggregate_lot,
)

# ── Shared fixture — two side-by-side spots in a 100×100 frame ───────────────
#   ROI_A pixel bbox: [10, 10, 40, 90]  (normalised x=[0.1–0.4], y=[0.1–0.9])
#   ROI_B pixel bbox: [40, 10, 70, 90]  (normalised x=[0.4–0.7], y=[0.1–0.9])
W, H = 100, 100
ROI_A = {
    "id": "roi_a",
    "label": "A",
    "polygon": [[0.1, 0.1], [0.4, 0.1], [0.4, 0.9], [0.1, 0.9]],
}
ROI_B = {
    "id": "roi_b",
    "label": "B",
    "polygon": [[0.4, 0.1], [0.7, 0.1], [0.7, 0.9], [0.4, 0.9]],
}
ROIS = [ROI_A, ROI_B]


# ── box_iou ──────────────────────────────────────────────────────────────────

def test_box_iou_no_overlap():
    assert box_iou([0, 0, 10, 10], [20, 20, 30, 30]) == 0.0


def test_box_iou_touching_edge():
    # Boxes share only an edge — zero-area intersection
    assert box_iou([0, 0, 10, 10], [10, 0, 20, 10]) == 0.0


def test_box_iou_full_overlap():
    box = [5, 5, 15, 15]
    assert abs(box_iou(box, box) - 1.0) < 1e-6


def test_box_iou_partial():
    # [0,0,10,10] and [5,5,15,15]: inter=5×5=25, union=100+100-25=175
    assert abs(box_iou([0, 0, 10, 10], [5, 5, 15, 15]) - 25 / 175) < 1e-6


# ── overlap_fraction ─────────────────────────────────────────────────────────

def test_overlap_fraction_car_wholly_inside():
    frac = overlap_fraction([12, 20, 38, 80], [10, 10, 40, 90])
    assert abs(frac - 1.0) < 1e-6


def test_overlap_fraction_no_overlap():
    assert overlap_fraction([80, 80, 90, 90], [10, 10, 40, 90]) == 0.0


def test_overlap_fraction_half():
    # car [0,0,20,10], roi [10,0,30,10] → inter=10×10=100, car_area=200 → 0.5
    assert abs(overlap_fraction([0, 0, 20, 10], [10, 0, 30, 10]) - 0.5) < 1e-6


# ── classify_vehicle_parking ─────────────────────────────────────────────────

def test_classify_straddling():
    """Car centred on boundary between ROI_A and ROI_B straddles both."""
    # bbox [25, 20, 55, 80] overlaps each ROI by ~0.27 IoU > 0.15 threshold
    result = classify_vehicle_parking([25, 20, 55, 80], ROIS, W, H)
    assert result["status"] == "misparked", result
    assert result["reason"] == "straddling", result
    assert "roi_a" in result["intruded_rois"]
    assert "roi_b" in result["intruded_rois"]


def test_classify_outside_markings():
    """Car in empty area (IoU < 0.2 with every ROI) is outside markings."""
    result = classify_vehicle_parking([80, 80, 95, 95], ROIS, W, H)
    assert result["status"] == "misparked", result
    assert result["reason"] == "outside_markings", result
    assert result["intruded_rois"] == []


def test_classify_ok_in_single_spot():
    """Car neatly inside ROI_A: high IoU with A, zero with B → ok."""
    result = classify_vehicle_parking([12, 12, 38, 88], ROIS, W, H)
    assert result["status"] == "ok", result
    assert result["reason"] is None


def test_classify_no_rois():
    """No ROIs → car cannot be classified as misparked."""
    result = classify_vehicle_parking([25, 20, 55, 80], [], W, H)
    assert result["status"] == "ok"


# ── aggregate_lot ─────────────────────────────────────────────────────────────

def test_aggregate_empty_lot():
    result = aggregate_lot([], ROIS, W, H)
    assert result["total"] == 2
    assert result["available"] == 2
    assert result["occupied"] == 0
    assert result["misparked_count"] == 0
    assert result["misparked"] == []


def test_aggregate_one_car_ok():
    cars = [{"bbox": [12, 12, 38, 88], "confidence": 0.9}]
    result = aggregate_lot(cars, ROIS, W, H)
    assert result["occupied"] == 1
    assert result["available"] == 1
    assert result["misparked_count"] == 0
    slot_a = next(s for s in result["slots"] if s["id"] == "roi_a")
    slot_b = next(s for s in result["slots"] if s["id"] == "roi_b")
    assert slot_a["status"] == "occupied"
    assert slot_b["status"] == "vacant"


def test_aggregate_straddling_car():
    """Straddling car flagged as misparked; both slots show occupied."""
    cars = [{"bbox": [25, 20, 55, 80], "confidence": 0.85}]
    result = aggregate_lot(cars, ROIS, W, H)
    assert result["misparked_count"] == 1
    assert result["misparked"][0]["reason"] == "straddling"


def test_aggregate_outside_car():
    cars = [{"bbox": [80, 80, 95, 95], "confidence": 0.7}]
    result = aggregate_lot(cars, ROIS, W, H)
    assert result["misparked_count"] == 1
    assert result["misparked"][0]["reason"] == "outside_markings"
    # Outside car does not occupy any slot
    assert result["occupied"] == 0


def test_aggregate_mixed():
    """One ok car + one straddler → 1 misparked, 2 occupied slots."""
    cars = [
        {"bbox": [12, 12, 38, 88], "confidence": 0.9},   # ok, inside A
        {"bbox": [25, 20, 55, 80], "confidence": 0.85},  # straddles A+B
    ]
    result = aggregate_lot(cars, ROIS, W, H)
    assert result["misparked_count"] == 1
    assert result["misparked"][0]["reason"] == "straddling"
    # Both slots occupied (straddling car overlaps both above 0.20 IoU)
    assert result["occupied"] == 2


# ── Self-runner ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    tests = [
        test_box_iou_no_overlap,
        test_box_iou_touching_edge,
        test_box_iou_full_overlap,
        test_box_iou_partial,
        test_overlap_fraction_car_wholly_inside,
        test_overlap_fraction_no_overlap,
        test_overlap_fraction_half,
        test_classify_straddling,
        test_classify_outside_markings,
        test_classify_ok_in_single_spot,
        test_classify_no_rois,
        test_aggregate_empty_lot,
        test_aggregate_one_car_ok,
        test_aggregate_straddling_car,
        test_aggregate_outside_car,
        test_aggregate_mixed,
    ]
    passed = failed = 0
    for t in tests:
        try:
            t()
            print(f"  PASS  {t.__name__}")
            passed += 1
        except AssertionError as e:
            print(f"  FAIL  {t.__name__}: {e}")
            failed += 1
        except Exception as e:
            print(f"  ERROR {t.__name__}: {e}")
            failed += 1
    print(f"\n{passed}/{passed + failed} tests passed")
    if failed:
        sys.exit(1)
