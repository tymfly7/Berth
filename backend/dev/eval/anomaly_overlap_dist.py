"""Distribution of vehicle-to-bay overlap on a deployed camera.

Misparking is decided by the fraction of a detected vehicle's box that falls
inside its best-matching bay polygon, flagged below park_thresh. This measures
that fraction for every vehicle in a capture set, so the threshold can be seen
against the population it cuts rather than assumed.

Writes the raw fractions as JSON and renders the figure used in the thesis.

Usage:
    python -m dev.eval.anomaly_overlap_dist --frames data/berth_captures/rpi5/until_8 \
        --rois configs/roi/lot-new-t12.json
"""
import argparse
import glob
import json
import os
from pathlib import Path

import cv2
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

import config
from src.inference.parking_geometry import car_overlap_polygon
from src.models.yolo_detector import ParkingYOLO26

# One hue at two lightness steps: readable in greyscale print, and it says the
# in-lot bars are one population rather than two categories.
INK        = "#1c2530"
MUTED      = "#5b6672"
BAR_IN_LOT = "#2f6f9f"
BAR_OFF    = "#a8c8dd"
RULE       = "#b4331f"


def overlaps(frames_dir, rois_path):
    rois = json.loads(Path(rois_path).read_text())
    det = ParkingYOLO26(str(config.VEHICLE_DETECT_PATH),
                        conf=config.VEHICLE_DETECT_CONF, imgsz=640)
    out = []
    for p in sorted(glob.glob(os.path.join(frames_dir, "*.jpg"))):
        frame = cv2.imread(p)
        if frame is None:
            continue
        h, w = frame.shape[:2]
        for d in det.predict_frame(frame):
            out.append(max((car_overlap_polygon(d["bbox"], r["polygon"], w, h)
                            for r in rois), default=0.0))
    return np.array(out)


def render(vals, out_png, park_thresh=0.60, off_lot=0.02):
    fig, ax = plt.subplots(figsize=(6.4, 3.5), dpi=300)
    edges = np.arange(0, 1.0001, 0.05)
    counts, _ = np.histogram(vals, bins=edges)

    colours = [BAR_OFF if edges[i] < off_lot else BAR_IN_LOT for i in range(len(counts))]
    ax.bar(edges[:-1], counts, width=0.047, align="edge", color=colours, zorder=3)

    ax.axvline(park_thresh, color=RULE, lw=1.6, ls=(0, (5, 3)), zorder=4)

    in_lot = vals[vals >= off_lot]
    below = float((in_lot < park_thresh).mean())
    top = counts.max()

    ax.annotate(f"default threshold {park_thresh:.2f}",
                xy=(park_thresh, top * 0.94), xytext=(park_thresh + 0.03, top * 0.94),
                color=RULE, fontsize=8.5, va="center")
    ax.annotate("vehicles off the marked bays", xy=(0.05, counts[0] * 0.97),
                xytext=(0.10, counts[0] * 0.90), color=MUTED, fontsize=8.5, va="center",
                arrowprops=dict(arrowstyle="-", color=MUTED, lw=0.8))
    # Sits in the empty 0.05-0.35 band so it clears every bar.
    ax.annotate(f"{below:.0%} of in-lot vehicles\nfall below the threshold",
                xy=(0.09, top * 0.58), color=INK, fontsize=8.5, va="top")

    ax.set_xlabel("fraction of the vehicle's area inside its best-matching bay", fontsize=9)
    ax.set_ylabel("vehicles", fontsize=9)
    ax.set_xlim(0, 1.0)
    ax.set_xticks(np.arange(0, 1.01, 0.1))
    ax.tick_params(labelsize=8.5, colors=MUTED, length=0)
    ax.grid(axis="y", color="#d8dde2", lw=0.6, zorder=0)
    ax.set_axisbelow(True)
    for side in ("top", "right", "left"):
        ax.spines[side].set_visible(False)
    ax.spines["bottom"].set_color("#c3c9cf")

    fig.tight_layout()
    fig.savefig(out_png, bbox_inches="tight", facecolor="white")
    print(f"wrote {out_png}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--frames", required=True)
    ap.add_argument("--rois", required=True)
    ap.add_argument("--json-out", default="outputs/anomaly_overlap_dist.json")
    ap.add_argument("--fig-out", default="../thesis/pict/anomaly_overlap.png")
    ap.add_argument("--park-thresh", type=float, default=0.60)
    args = ap.parse_args()

    vals = overlaps(args.frames, args.rois)
    Path(args.json_out).parent.mkdir(parents=True, exist_ok=True)
    Path(args.json_out).write_text(json.dumps({
        "frames_dir": args.frames, "rois": args.rois,
        "detector_conf": config.VEHICLE_DETECT_CONF,
        "overlaps": [round(float(v), 4) for v in vals],
    }, indent=1))

    in_lot = vals[vals >= 0.02]
    print(f"vehicles {len(vals)}, in-lot {len(in_lot)}, median {np.median(in_lot):.2f}, "
          f"below {args.park_thresh}: {(in_lot < args.park_thresh).mean():.1%}")
    render(vals, args.fig_out, args.park_thresh)


if __name__ == "__main__":
    main()
