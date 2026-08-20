"""Build an offset bay grid for the positive side of misparked_eval.

The real check wants an offset ROI set drawn by hand in the ROI editor. This is a
stand-in, not a replacement. It shifts every bay by half its own short axis, so a
properly parked car straddles two bays. A hand-drawn set follows the real bay rows;
here the short axis is computed per bay, so on skewed quads neighbouring bays drift
in slightly different directions and a car can land between two displaced bays with
weak overlap on both. That reads "outside" rather than "straddling" and understates
the straddle hit rate.

Usage:
    python -m dev.eval.roi_offset --rois lot-new-t12 --out lot-new-t12-offset
"""
import argparse

import cv2
import numpy as np

import config
from src.roi.roi_store import RoiStore


def _shift(polygon, frame_w, frame_h):
    """Polygon moved half its short side. Returns (polygon, stayed_in_frame, shift_px)."""
    pts = np.array([[x * frame_w, y * frame_h] for x, y in polygon], np.float32)
    box = cv2.boxPoints(cv2.minAreaRect(pts))
    short = min((box[(i + 1) % 4] - box[i] for i in range(4)), key=np.linalg.norm)
    moved = [[float(p[0] + short[0] / 2) / frame_w,
              float(p[1] + short[1] / 2) / frame_h] for p in pts]
    inside = all(0.0 <= x <= 1.0 and 0.0 <= y <= 1.0 for x, y in moved)
    return moved, inside, float(np.linalg.norm(short)) / 2


def build(src_id, out_id):
    """Write an offset copy of ROI set `src_id` as `out_id`."""
    rois = RoiStore.get_rois(src_id)
    if not rois:
        raise ValueError(f"ROI set '{src_id}' is empty or missing")

    kept, dropped, shifts = [], 0, []
    for roi in rois:
        polygon = roi.get("polygon", [])
        if len(polygon) < 3:
            continue
        moved, inside, shift = _shift(polygon, config.FRAME_WIDTH, config.FRAME_HEIGHT)
        if not inside:
            # Clamping to the frame would deform the bay, which skews the overlap
            # fractions the check measures. Drop it instead.
            dropped += 1
            continue
        kept.append({**roi, "polygon": moved})
        shifts.append(shift)

    RoiStore.save_rois(out_id, kept)
    return kept, dropped, shifts


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--rois", required=True, help="ROI set id to offset")
    ap.add_argument("--out", required=True, help="ROI set id to write")
    args = ap.parse_args()

    kept, dropped, shifts = build(args.rois, args.out)
    print(f"{args.out}: {len(kept)} bays written, {dropped} dropped for leaving the frame")
    print(f"shift px at {config.FRAME_WIDTH}x{config.FRAME_HEIGHT}: "
          f"min {min(shifts):.1f}  median {np.median(shifts):.1f}  max {max(shifts):.1f}")


if __name__ == "__main__":
    main()
