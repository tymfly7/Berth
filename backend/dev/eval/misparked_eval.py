"""Two-sided regression check for the misparked-vehicle pass.

What this measures: the straddle geometry in parking_geometry.classify_vehicle_parking
and the thresholds it runs at. It does NOT measure real-world misparking behaviour.
A genuinely badly parked car sits at an angle, overhangs a line, or blocks a lane; the
positive side here is a properly parked car sitting squarely across two bays because
the bay grid was shifted underneath it. Passing both sides means the overlap maths and
its cut-offs behave as intended, nothing more.

Full ground truth is impractical because genuinely misparked cars are rare in the
archive, so the check is built from two ROI sets over the same frames:

  negative side — the correct ROI set for the lot. Every vehicle in these frames is
                  properly parked, so any flag is a false positive.
  positive side — a second ROI set whose bay grid is offset by roughly half a bay
                  width. Every properly parked vehicle now straddles two bays, so any
                  vehicle not flagged is a false negative.

The offset ROI set is drawn by hand in the ROI editor and saved like any other set;
this script only reads it by id. Both sides score the *same* detections, so the two
numbers differ only in geometry, never in what the detector found.

Caveat on the negative side: a vehicle driving through a lane is detected like any
other and reads as "outside", which counts as a false positive here. Pick frames in
which every vehicle present is parked.

Usage:
    python -m dev.eval.misparked_eval --frames data/t12lot \
        --rois lot-t12 --offset-rois lot-t12-offset
"""
import argparse
from collections import Counter
from pathlib import Path

import cv2

import config
from src.inference.parking_geometry import classify_vehicle_parking
from src.models.yolo_detector import load_vehicle_detector
from src.roi.roi_store import RoiStore

_EXTS = (".jpg", ".jpeg", ".png")


def _frame_paths(frame_dir):
    paths = sorted(p for p in frame_dir.iterdir() if p.suffix.lower() in _EXTS)
    if not paths:
        raise FileNotFoundError(f"no frames found in {frame_dir}")
    return paths


def _detect(detector, path):
    """Detections for one frame at the resolution the runtime feeds the detect pass.

    video_processor resizes every frame to FRAME_WIDTH/HEIGHT before the anomaly pass,
    so a native-resolution archive frame must go through the same resize or the
    detector sees an input the deployed system never sees.
    """
    raw = cv2.imread(str(path))
    if raw is None:
        raise FileNotFoundError(f"could not read frame {path}")
    frame = cv2.resize(raw, (config.FRAME_WIDTH, config.FRAME_HEIGHT))
    h, w = frame.shape[:2]
    return detector.predict_frame(frame), w, h


def run(frame_dir, roi_id, offset_roi_id):
    """Score every detected vehicle against both ROI sets, frame by frame."""
    rois = RoiStore.get_rois(roi_id)
    offset_rois = RoiStore.get_rois(offset_roi_id)
    if not rois:
        raise ValueError(f"ROI set '{roi_id}' is empty or missing")
    if not offset_rois:
        raise ValueError(f"ROI set '{offset_roi_id}' is empty or missing")

    detector = load_vehicle_detector()
    per_frame = []
    for path in _frame_paths(frame_dir):
        cars, w, h = _detect(detector, path)
        base = [classify_vehicle_parking(c["bbox"], rois, w, h) for c in cars]
        shifted = [classify_vehicle_parking(c["bbox"], offset_rois, w, h) for c in cars]
        per_frame.append({"name": path.name, "cars": cars, "base": base, "offset": shifted})
    return per_frame, len(rois), len(offset_rois)


def _tally(per_frame, side):
    """(vehicles, flagged, straddling, outside) over one side."""
    results = [r for f in per_frame for r in f[side]]
    flagged = [r for r in results if r["status"] == "misparked"]
    straddling = sum(1 for r in flagged if r["reason"] == "straddling")
    return len(results), len(flagged), straddling, len(flagged) - straddling


def _outcome(result):
    return result["reason"] if result["status"] == "misparked" else "ok"


def _crosstab(per_frame):
    """Base outcome against offset outcome, per vehicle.

    The negative tally alone is misleading: a car parked where no bay was drawn
    reads "outside" on both sides and inflates the false positive count without
    saying anything about the straddle geometry. Pairing the two sides separates
    those from the cars that really sit on the grid.
    """
    pairs = Counter()
    for f in per_frame:
        for base, offset in zip(f["base"], f["offset"]):
            pairs[(_outcome(base), _outcome(offset))] += 1
    return pairs


def _detail(per_frame, side, want_flagged):
    """Per-vehicle lines for the cases the author needs to eyeball."""
    lines = []
    for f in per_frame:
        for car, res in zip(f["cars"], f[side]):
            if (res["status"] == "misparked") != want_flagged:
                continue
            best = max((e["overlap"] for e in res["overlaps"]), default=0.0)
            bbox = " ".join(f"{v:.0f}" for v in car["bbox"])
            lines.append(f"    {f['name']}  bbox [{bbox}]  best overlap {best:.2f}"
                         f"  {res['reason'] or ''}")
    return lines


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--frames", type=Path, required=True,
                    help="directory of frames in which every vehicle is properly parked")
    ap.add_argument("--rois", required=True, help="ROI set id: the correct bays for the lot")
    ap.add_argument("--offset-rois", required=True,
                    help="ROI set id: same lot, bay grid offset by ~half a bay width")
    args = ap.parse_args()

    per_frame, n_rois, n_offset = run(args.frames, args.rois, args.offset_rois)
    vehicles, fp, fp_straddle, fp_outside = _tally(per_frame, "base")
    _, hits, hit_straddle, hit_outside = _tally(per_frame, "offset")

    print(f"misparked geometry check — {len(per_frame)} frames, {vehicles} vehicles detected")
    print(f"  negative  {args.rois:<24s} {n_rois:2d} bays   "
          f"false positives {fp:3d} / {vehicles}   "
          f"(straddling {fp_straddle}, outside {fp_outside})")
    print(f"  positive  {args.offset_rois:<24s} {n_offset:2d} bays   "
          f"false negatives {vehicles - hits:3d} / {vehicles}   "
          f"(flagged {hits}: straddling {hit_straddle}, outside {hit_outside})")

    print(f"  {'base':<12} {'offset':<12} {'vehicles':>8}")
    for (base, offset), n in sorted(_crosstab(per_frame).items(), key=lambda kv: -kv[1]):
        print(f"  {base:<12} {offset:<12} {n:>8}")

    for title, lines in (("false positives (flagged on the correct ROI set)",
                          _detail(per_frame, "base", True)),
                         ("false negatives (unflagged on the offset ROI set)",
                          _detail(per_frame, "offset", False))):
        if lines:
            print(f"  {title}:")
            print("\n".join(lines))


if __name__ == "__main__":
    main()
