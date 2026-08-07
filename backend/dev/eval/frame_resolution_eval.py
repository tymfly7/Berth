"""Score the classifier roster on full frames resized before cropping.

The held-out crop split cannot show resolution sensitivity, because its crops were
cut once at native resolution and stored. This resizes the whole frame first, the
way the ingest path does, and cuts the bays afterwards.

Bay geometry and occupancy come from a YOLO detection dataset whose two classes are
vacant/occupied, one box per bay, so no separate ROI file is needed.

Usage:
    python -m dev.eval.frame_resolution_eval --dataset "D:/path/yolo_detect_dataset"
    python -m dev.eval.frame_resolution_eval --heights 480 720 0 --limit 60
"""
import argparse
import json
from pathlib import Path

import cv2
import numpy as np

import config
from edge_eval.eval_edge import build_classifier
from src.roi.roi_crop import crop_roi


def load_coco(labels_json, images_dir, limit=None):
    """Same output as load_split, from a COCO file whose categories are vacant/occupied."""
    spec = json.loads(Path(labels_json).read_text())
    occupied = {c["id"] for c in spec["categories"] if c["name"] == "occupied"}
    boxes = {}
    for a in spec["annotations"]:
        boxes.setdefault(a["image_id"], []).append(a)

    images = [im for im in spec["images"] if boxes.get(im["id"])]
    if limit and limit < len(images):
        idx = np.linspace(0, len(images) - 1, limit).round().astype(int)
        images = [images[i] for i in idx]

    frames = []
    for im in images:
        path = Path(images_dir) / Path(im["file_name"]).name
        if not path.exists():
            continue
        w, h = im["width"], im["height"]
        bays = []
        for a in boxes[im["id"]]:
            x, y, bw, bh = a["bbox"]
            x1, x2 = x / w, (x + bw) / w
            y1, y2 = y / h, (y + bh) / h
            bays.append(([[x1, y1], [x2, y1], [x2, y2], [x1, y2]],
                         1 if a["category_id"] in occupied else 0))
        if bays:
            frames.append((path, bays))
    return frames


def load_split(dataset, split, limit=None):
    """Frames as (image path, [(polygon, label)]), evenly subsampled when limited."""
    images = sorted((Path(dataset) / "images" / split).glob("*.jpg"))
    labels = Path(dataset) / "labels" / split
    if limit and limit < len(images):
        idx = np.linspace(0, len(images) - 1, limit).round().astype(int)
        images = [images[i] for i in idx]

    frames = []
    for img in images:
        txt = labels / (img.stem + ".txt")
        if not txt.exists():
            continue
        bays = []
        for line in txt.read_text().split("\n"):
            parts = line.split()
            if len(parts) != 5:
                continue
            cls, cx, cy, w, h = (float(p) for p in parts)
            x1, x2 = cx - w / 2, cx + w / 2
            y1, y2 = cy - h / 2, cy + h / 2
            bays.append(([[x1, y1], [x2, y1], [x2, y2], [x1, y2]], int(cls)))
        if bays:
            frames.append((img, bays))
    return frames


def _resized(frame, height):
    """Frame after a round trip through a lower source height, as ingest does."""
    h, w = frame.shape[:2]
    if not height or height >= h:
        return frame
    small = cv2.resize(frame, (int(w * height / h), height), interpolation=cv2.INTER_AREA)
    return cv2.resize(small, (w, h), interpolation=cv2.INTER_LINEAR)


def run(frames, models, heights, threshold=0.5, runtime="torch"):
    rows = []
    for name in models:
        clf = build_classifier(name, runtime)
        clf.load()
        if not clf.is_loaded():
            rows.append((name, None))
            continue
        per_height = {}
        for height in heights:
            pred, truth = [], []
            for path, bays in frames:
                frame = _resized(cv2.imread(str(path)), height)
                crops = [crop_roi(frame, poly) for poly, _ in bays]
                keep = [i for i, c in enumerate(crops) if c is not None and c.size]
                out = clf.predict_batch([crops[i] for i in keep])
                pred += [1 if d["probability"] > threshold else 0 for d in out]
                truth += [bays[i][1] for i in keep]
            pred, truth = np.array(pred), np.array(truth)
            per_height[height] = (
                (pred == truth).mean(),
                int(((pred == 1) & (truth == 0)).sum()),
                int(((pred == 0) & (truth == 1)).sum()),
                len(truth),
            )
        rows.append((name, per_height))
    return rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dataset", help="YOLO detection dataset root")
    ap.add_argument("--coco", nargs=2, metavar=("LABELS_JSON", "IMAGES_DIR"),
                    help="COCO label file and the directory holding its frames")
    ap.add_argument("--split", default="test")
    ap.add_argument("--models", nargs="*", default=list(config.CLASSIFY_MODELS))
    ap.add_argument("--heights", nargs="*", type=int, default=[480, 720, 0],
                    help="source heights to simulate before cropping; 0 means native")
    ap.add_argument("--limit", type=int, default=None, help="subsample this many frames")
    ap.add_argument("--threshold", type=float, default=0.5)
    ap.add_argument("--runtime", choices=["torch", "ncnn"], default="torch",
                    help="inference backend; ncnn loads the exports the edge node runs")
    ap.add_argument("--json-out", metavar="PATH",
                    help="also write the measured numbers to this file")
    args = ap.parse_args()

    if args.coco:
        frames = load_coco(args.coco[0], args.coco[1], args.limit)
        arm = Path(args.coco[0]).stem
    else:
        frames = load_split(args.dataset, args.split, args.limit)
        arm = args.split
    bays = sum(len(b) for _, b in frames)
    occ = sum(lbl for _, b in frames for _, lbl in b)
    print(f"{arm}: {len(frames)} frames, {bays} bays ({occ} occupied / {bays - occ} vacant), "
          f"threshold {args.threshold}, runtime {args.runtime}")
    header = "  ".join(f"{h or 'native':>8}" for h in args.heights)
    print(f"{'model':18s} {header}")

    rows = run(frames, args.models, args.heights, args.threshold, args.runtime)
    for name, per_height in rows:
        if per_height is None:
            print(f"{name:18s} not loaded")
            continue
        cells = "  ".join(f"{per_height[h][0]:7.1%} " for h in args.heights)
        print(f"{name:18s} {cells}")
        for h in args.heights:
            acc, fp, fn, n = per_height[h]
            print(f"    {h or 'native':>6}: acc {acc:6.2%}  FP {fp:4d}  FN {fn:4d}  n {n}")

    if args.json_out:
        models = {}
        for name, per_height in rows:
            if per_height is None:
                continue
            models[name] = {
                str(h or "native"): {"accuracy": acc, "fp": fp, "fn": fn, "bays": n}
                for h, (acc, fp, fn, n) in per_height.items()
            }
        Path(args.json_out).write_text(json.dumps({
            "arm": arm,
            "frames": len(frames),
            "bays": bays,
            "occupied": occ,
            "vacant": bays - occ,
            "threshold": args.threshold,
            "runtime": args.runtime,
            "heights": [h or "native" for h in args.heights],
            "models": models,
        }, indent=2))
        print(f"wrote {args.json_out}")


if __name__ == "__main__":
    main()
