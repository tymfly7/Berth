"""COCO-bootstrapped vehicle annotations for manual correction.

Samples frames stratified by capture day and time-of-day, downscales them, and
pre-labels every vehicle with stock COCO YOLO weights. The output is a bundle the
author corrects by hand in makesense.ai.

This exists because the trained detector is a parking-BAY detector with classes
{0: vacant, 1: occupied}. A bay box cannot represent a vehicle parked outside the
marked bays, so a bay-derived dataset structurally cannot contain off-bay or lane
vehicles. Adding those by hand is the point of the bundle, which is why the
detection pass is tuned for recall: deleting a spurious box is cheaper for the
author than drawing a missed one.
"""

import csv
import json
import random
import re
from collections import Counter, defaultdict
from pathlib import Path

import cv2
from ultralytics import YOLO

SPLITS = ("train", "val")
COCO_VEHICLES = [2, 3, 5, 7]

# Capture filenames come in two shapes, both starting with a 10-character date.
_FMT_COMPACT = re.compile(r"^(\d{4}-\d{2}-\d{2})_(\d{2})(\d{2})$")       # 2026-03-10_1229
_FMT_SPACED = re.compile(r"^(\d{4}-\d{2}-\d{2}) (\d{2})_(\d{2})_(\d{2})$")  # 2026-02-20 08_05_58
_FMT_IMG = re.compile(r"^IMG_(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})$")  # IMG_20260625_105448
_DATE_DIR = re.compile(r"^\d{4}-\d{2}-\d{2}$")

_PRIORITY = """## What to correct, in priority order

**First: add vehicles the model missed in the driving lanes and outside the
marked bays.** The trained detector in this project is a bay detector, so a
bay-derived dataset cannot contain a vehicle parked outside a bay. Those frames
are the reason this bundle exists. Every misparked, double parked, lane blocking
or verge parked vehicle needs a box.

**Second: add ordinary missed vehicles.** Distant rows, partly occluded cars,
vehicles at the frame edge, and anything at dusk or at night.

**Third: delete false positives.** Boxes on bins, bollards, shadows or building
parts. Last on purpose. The detection pass was tuned for recall.

Box a vehicle if any part of it is visible and identifiable. One box per vehicle,
tight around the visible extent. The class is always `vehicle`.
"""


def parse_capture(path: Path):
    """(capture_date, seconds_into_day, hour) from the filename, else the parent
    date folder, else None."""
    m = _FMT_COMPACT.match(path.stem)
    if m:
        hh, mm = int(m.group(2)), int(m.group(3))
        return m.group(1), hh * 3600 + mm * 60, hh
    m = _FMT_SPACED.match(path.stem)
    if m:
        hh, mm, ss = int(m.group(2)), int(m.group(3)), int(m.group(4))
        return m.group(1), hh * 3600 + mm * 60 + ss, hh
    m = _FMT_IMG.match(path.stem)
    if m:
        y, mo, d, hh, mm, ss = (int(g) for g in m.groups())
        return f"{y:04d}-{mo:02d}-{d:02d}", hh * 3600 + mm * 60 + ss, hh
    if _DATE_DIR.match(path.parent.name):
        return path.parent.name, 0, 0
    return None


def split_of(path: Path):
    """Source split from the path, folded to train/val only — a source 'test'
    frame joins val. Keeps a frame's split consistent with its source so the
    correction set stays free of leakage. None when the layout has no split."""
    for part in reversed(path.parts):
        low = part.lower()
        if low == "train":
            return "train"
        if low in ("val", "valid", "test"):
            return "val"
    return None


def allocate(day_counts: dict, total: int) -> dict:
    """Even per-day quota, capped by what each day holds, leftovers to the largest
    days."""
    days = sorted(day_counts)
    quota = {d: 0 for d in days}
    remaining = total
    while remaining > 0:
        open_days = [d for d in days if quota[d] < day_counts[d]]
        if not open_days:
            break
        share = max(1, remaining // len(open_days))
        for d in sorted(open_days, key=lambda d: -day_counts[d]):
            if remaining == 0:
                break
            take = min(share, day_counts[d] - quota[d], remaining)
            quota[d] += take
            remaining -= take
    return quota


def spread_pick(frames: list, k: int) -> list:
    """Farthest-point selection in time: seed with the first and last capture of
    the day, then repeatedly take the frame with the largest minimum gap to what
    is already picked. Consecutive frames are near-duplicates, this avoids them."""
    frames = sorted(frames, key=lambda f: (f["secs"], f["path"].name))
    if k >= len(frames):
        return frames
    picked = [frames[0], frames[-1]][:k]
    while len(picked) < k:
        best = max(
            (f for f in frames if f not in picked),
            key=lambda f: (min(abs(f["secs"] - p["secs"]) for p in picked), f["secs"]),
        )
        picked.append(best)
    return sorted(picked, key=lambda f: f["secs"])


def _clear(root: Path) -> None:
    """Empty the split folders in place. Removing the trees invites WinError 32
    when anything holds a directory open."""
    for kind, pattern in (("images", "*.jpg"), ("labels", "*.txt")):
        for split in SPLITS:
            d = root / kind / split
            d.mkdir(parents=True, exist_ok=True)
            for f in d.glob(pattern):
                f.unlink(missing_ok=True)
    for f in root.glob("annotations_coco_*.json"):
        f.unlink(missing_ok=True)


def _write_coco(root: Path, split: str, records: list, out_w: int, out_h: int) -> None:
    """One COCO file per split. Boxes are absolute pixels against the downscaled
    images, which is what makesense.ai reads on import."""
    images, annotations, ann_id = [], [], 1
    for img_id, rec in enumerate(records, start=1):
        images.append({"id": img_id, "file_name": rec["name"],
                       "width": out_w, "height": out_h})
        for xc, yc, bw, bh in rec["boxes"]:
            w, h = bw * out_w, bh * out_h
            annotations.append({
                "id": ann_id, "image_id": img_id, "category_id": 1,
                "bbox": [round((xc - bw / 2) * out_w, 2), round((yc - bh / 2) * out_h, 2),
                         round(w, 2), round(h, 2)],
                "area": round(w * h, 2), "iscrowd": 0, "segmentation": [],
            })
            ann_id += 1
    payload = {"images": images, "annotations": annotations,
               "categories": [{"id": 1, "name": "vehicle", "supercategory": "none"}]}
    (root / f"annotations_coco_{split}.json").write_text(json.dumps(payload), encoding="utf-8")


def _report_text(report: dict) -> str:
    lines = [
        f"Frames selected: {report['n_selected']} of {report['n_available']}",
        f"Capture days covered: {len(report['day_hist'])} of {report['n_days']}",
        f"Split: " + ", ".join(f"{s} {report['split_counts'].get(s, 0)}" for s in SPLITS),
        f"Total boxes: {report['total_boxes']}",
        f"Mean boxes per frame: {report['mean_boxes']}",
        "",
        "Frames per capture day (selected / available):",
    ]
    lines += [f"  {d}  {n:>3} / {report['day_available'][d]}"
              for d, n in sorted(report["day_hist"].items())]
    lines += ["", "Frames per hour of day:"]
    lines += [f"  {int(h):02d}:00  {n:>3}  {'#' * n}"
              for h, n in sorted(report["hour_hist"].items(), key=lambda kv: int(kv[0]))]
    lines += ["", "Per-frame box count distribution:"]
    lines += [f"  {int(b):>3} boxes  {n:>3} frames"
              for b, n in sorted(report["box_hist"].items(), key=lambda kv: int(kv[0]))]
    lines += [""]
    if report["zero_detection"]:
        lines.append(f"Frames with zero detections ({len(report['zero_detection'])}). "
                     "Each is an empty lot or a detector failure, check every one:")
        lines += [f"  {n}" for n in report["zero_detection"]]
    else:
        lines.append("Frames with zero detections: none.")
    return "\n".join(lines)


def _write_readme(root: Path, report: dict, params: dict) -> None:
    text = f"""# Vehicle annotation bundle

Bootstrap labels for a vehicle detector. Boxes were produced by stock COCO
`{Path(params['weights']).name}` at `conf={params['conf']}`, `imgsz={params['imgsz']}`,
COCO classes `{COCO_VEHICLES}` (car, motorcycle, bus, truck) collapsed to a single
class `0 vehicle`. They are a starting point, not ground truth.

Detection ran on the full resolution originals. The images here are
{params['out_w']}x{params['out_h']} copies. YOLO labels are normalised, so the
same label files apply to both. Frames keep their original filenames. A frame
from a source train split stays train; a source val or test frame becomes val.

## Contents

| Path | What it is |
| --- | --- |
| `images/{{train,val}}/` | the sampled frames, {params['out_w']}x{params['out_h']} |
| `labels/{{train,val}}/` | annotations in YOLO format, one `.txt` per image |
| `labels/{{train,val}}/labels.txt` | the class name the YOLO import reads |
| `annotations_coco_<split>.json` | the same annotations in COCO JSON, one file per split |
| `classes.txt` | the label list, a single line: `vehicle` |
| `manifest.csv` | source_path, output_name, split, capture_date, capture_time, n_boxes |
| `report.json` | the run report below, machine readable |

The label is the class name, `vehicle`. The boxes are annotations. The folder
holding them is named `labels/` because YOLO training expects an `images/` and
`labels/` pair.

## Importing into makesense.ai

Work one split at a time.

1. Open <https://www.makesense.ai/>.
2. Click **Get Started**, then drop in every file from `images/<split>/`.
3. Choose **Object Detection**.
4. Click **Load labels from file**, select `classes.txt`, then **Start project**.
5. Open **Actions > Import Annotations** and use either format below.
6. Correct the boxes.
7. Export with **Actions > Export Annotations > A .zip package containing files
   in YOLO format**.

**Single file in COCO JSON format.** Load `annotations_coco_<split>.json`.

**Multiple files in YOLO format along with labels names definition - labels.txt
file.** Load the entire contents of `labels/<split>/` in one selection: the
annotation files and `labels.txt`, which names the class.

Image filenames must stay unchanged. They match a frame to its source row in
`manifest.csv` and to its annotations on import.

{_PRIORITY}
## Sampling

An even quota per capture day, then farthest-point selection in time within each
day. Every day contributes its first and last capture, which is why the hour
histogram peaks at the ends of the day. Those are the low-light frames where the
detector is weakest, so they are worth having.

## Run report

```
{_report_text(report)}
```
"""
    (root / "README.md").write_text(text, encoding="utf-8")


def build_bundle(images: list, out_root: Path, weights: str, n_frames: int,
                 conf: float, imgsz: int, out_w: int, out_h: int,
                 progress=None) -> dict:
    """Sample, downscale, pre-label. Returns the run report."""
    by_day = defaultdict(list)
    unparsed = 0
    for path in images:
        parsed = parse_capture(path)
        if parsed is None:
            unparsed += 1
            continue
        date, secs, hour = parsed
        by_day[date].append({"path": path, "secs": secs, "hour": hour, "date": date})
    if not by_day:
        raise ValueError("No image filenames carried a parseable capture date.")

    day_counts = {d: len(v) for d, v in by_day.items()}
    quota = allocate(day_counts, min(n_frames, sum(day_counts.values())))
    selected = []
    for date in sorted(by_day):
        selected.extend(spread_pick(by_day[date], quota[date]))

    # Frames without a split in their path get a deterministic one.
    unsplit = [f for f in selected if split_of(f["path"]) is None]
    random.Random(42).shuffle(unsplit)
    n_tr = int(len(unsplit) * 0.7)
    fallback = {id(f): s for s, group in
                (("train", unsplit[:n_tr]), ("val", unsplit[n_tr:]))
                for f in group}
    for f in selected:
        f["split"] = split_of(f["path"]) or fallback[id(f)]

    _clear(out_root)
    total_steps = len(selected) * 2
    for i, f in enumerate(selected):
        frame = cv2.imread(str(f["path"]))
        if frame is None:
            raise ValueError(f"Unreadable image: {f['path']}")
        small = cv2.resize(frame, (out_w, out_h), interpolation=cv2.INTER_AREA)
        cv2.imwrite(str(out_root / "images" / f["split"] / f["path"].name), small,
                    [cv2.IMWRITE_JPEG_QUALITY, 95])
        if progress:
            progress((i + 1) / total_steps)

    # Detect on the full-resolution originals, not the downscaled copies.
    model = YOLO(str(weights))
    for i in range(0, len(selected), 8):
        chunk = selected[i:i + 8]
        results = model.predict([str(f["path"]) for f in chunk], conf=conf,
                                imgsz=imgsz, classes=COCO_VEHICLES, verbose=False)
        for f, res in zip(chunk, results):
            f["boxes"] = [tuple(b) for b in res.boxes.xywhn.tolist()]
            lines = [f"0 {xc:.6f} {yc:.6f} {w:.6f} {h:.6f}" for xc, yc, w, h in f["boxes"]]
            label = out_root / "labels" / f["split"] / f"{f['path'].stem}.txt"
            label.write_text("\n".join(lines) + ("\n" if lines else ""), encoding="utf-8")
        if progress:
            progress((len(selected) + min(i + 8, len(selected))) / total_steps)

    (out_root / "classes.txt").write_text("vehicle\n", encoding="utf-8")
    for split in SPLITS:
        (out_root / "labels" / split / "labels.txt").write_text("vehicle\n", encoding="utf-8")
        _write_coco(out_root, split,
                    [{"name": f["path"].name, "boxes": f["boxes"]}
                     for f in selected if f["split"] == split], out_w, out_h)

    with open(out_root / "manifest.csv", "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(["source_path", "output_name", "split", "capture_date",
                    "capture_time", "n_boxes"])
        for f in selected:
            secs = f["secs"]
            w.writerow([f["path"].as_posix(), f["path"].name, f["split"], f["date"],
                        f"{secs // 3600:02d}:{secs % 3600 // 60:02d}:{secs % 60:02d}",
                        len(f["boxes"])])

    total_boxes = sum(len(f["boxes"]) for f in selected)
    report = {
        "n_selected": len(selected),
        "n_available": sum(day_counts.values()),
        "n_days": len(day_counts),
        "unparsed_filenames": unparsed,
        "total_boxes": total_boxes,
        "mean_boxes": round(total_boxes / len(selected), 2) if selected else 0,
        "split_counts": dict(Counter(f["split"] for f in selected)),
        "day_hist": dict(Counter(f["date"] for f in selected)),
        "day_available": day_counts,
        "hour_hist": {str(h): n for h, n in Counter(f["hour"] for f in selected).items()},
        "box_hist": {str(b): n for b, n in Counter(len(f["boxes"]) for f in selected).items()},
        "zero_detection": sorted(f["path"].name for f in selected if not f["boxes"]),
        "out_root": str(out_root),
    }
    (out_root / "report.json").write_text(json.dumps(report), encoding="utf-8")
    _write_readme(out_root, report, {"weights": weights, "conf": conf, "imgsz": imgsz,
                                     "out_w": out_w, "out_h": out_h})
    return report
