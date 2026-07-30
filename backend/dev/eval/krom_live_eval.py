"""Score the classifier roster on the hand-labelled Krom live set.

Out-of-domain counterpart to the t10lot test split: same models, but real frames
from the deployed camera at native capture resolution. The t10lot split shares its
source crops with train, so it cannot catch resolution-domain failures — this can.

Usage:
    python -m dev.eval.krom_live_eval                  # native resolution
    python -m dev.eval.krom_live_eval --height 540     # simulate a lower-res ingest
    python -m dev.eval.krom_live_eval --threshold 0.999

51 slots, one camera, one afternoon — a regression guard, not a headline figure.
"""
import argparse
import json
from pathlib import Path

import cv2
import numpy as np

import config
from src.inference.torch_classifier import ParkingClassifier
from src.roi.roi_crop import crop_roi

FIXTURE = Path(__file__).resolve().parent / "krom_live"


def _crops(frame, rois, height):
    """ROI crops, optionally after a round trip through a lower source height.

    Mirrors the ingest path: video_processor resizes every frame to FRAME_WIDTH/HEIGHT
    before detect(), so a lower-res source reaches the classifier as an upscaled frame,
    not as smaller crops.
    """
    h, w = frame.shape[:2]
    if height and height < h:
        small = cv2.resize(frame, (int(w * height / h), height), interpolation=cv2.INTER_AREA)
        frame = cv2.resize(small, (w, h), interpolation=cv2.INTER_LINEAR)
    return [crop_roi(frame, r["polygon"]) for r in rois]


def run(models, height=None, threshold=0.5):
    spec = json.loads((FIXTURE / "labels.json").read_text())
    rois = spec["rois"]
    frames = {n: cv2.imread(str(FIXTURE / "frames" / n)) for n in spec["frames"]}
    missing = [n for n, f in frames.items() if f is None]
    if missing:
        raise FileNotFoundError(f"missing fixture frames: {missing}")
    y = np.concatenate([np.array(v) for v in spec["frames"].values()])

    rows = []
    for name in models:
        clf = ParkingClassifier(model_name=name)
        clf.load()
        if not clf.is_loaded():
            rows.append((name, None, None, None))
            continue
        probs = np.concatenate([
            np.array([d["probability"] for d in clf.predict_batch(_crops(f, rois, height))])
            for f in frames.values()
        ])
        pred = (probs > threshold).astype(int)
        rows.append((name, (pred == y).mean(),
                     int(((pred == 1) & (y == 0)).sum()),
                     int(((pred == 0) & (y == 1)).sum())))
    return rows, y


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--models", nargs="*", default=list(config.CLASSIFY_MODELS))
    ap.add_argument("--height", type=int, default=None,
                    help="simulate this source height before cropping (default: native)")
    ap.add_argument("--threshold", type=float, default=0.5)
    args = ap.parse_args()

    rows, y = run(args.models, args.height, args.threshold)
    print(f"krom_live — {len(y)} slots ({y.sum()} occupied / {len(y) - y.sum()} vacant)  "
          f"height={args.height or 'native'}  threshold={args.threshold}")
    for name, acc, fp, fn in rows:
        if acc is None:
            print(f"  {name:18s} not loaded")
        else:
            print(f"  {name:18s} acc {acc:6.1%}   FP {fp:2d}  FN {fn:2d}")


if __name__ == "__main__":
    main()
