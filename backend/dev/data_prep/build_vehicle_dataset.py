"""Builds the single-class vehicle detection dataset from the hand-corrected pass.

Labels come from the makesense.ai export zip in data/vehicle_annotation/. The
COCO bootstrap labels in data/vehicle_annotation/labels/ are superseded and are
never read. Nothing in data/vehicle_annotation/ is written.

The split is by capture day, not by frame. Frames from one day share lighting,
weather and largely the same parked cars, so a random split would put near
duplicates on both sides and inflate the validation metric.
"""

import re
import shutil
from collections import defaultdict
from datetime import datetime
from pathlib import Path
from zipfile import ZipFile

import cv2

SRC = Path("data/vehicle_annotation")
ZIP = SRC / "labels_yolo_det_data_2026-07-29-07-45-54.zip"

# Every run writes a new directory. Builds are never replaced in place, so a
# rerun against a different annotation pass cannot clobber an earlier dataset.
DST = Path("data") / f"vehicle_dataset_{datetime.now():%Y-%m-%d_%H%M%S}"

# Frames with no label file in the export, analysed by hand and split in two.
# Genuinely empty daylight lots. Kept as empty-label negatives.
EMPTY_KEEP = [
    "2026-03-29_0650",
    "2026-03-29_1000",
    "2026-03-29_1310",
    "2026-03-29_1620",
    "2026-03-29_1930",
    "2026-04-14_1053",
]
# Night frames that do contain vehicles the annotator could not see. Excluded,
# because labelling them empty would teach the detector that night vehicles are
# background and undo the correction work on the 14 labelled night frames.
NIGHT_EXCLUDE = [
    "2026-02-27_1851", "2026-03-04_1821", "2026-03-24_1858", "2026-04-01_1943",
    "2026-04-14_2003", "2026-04-16_2022", "2026-04-22_2055", "2026-04-27_2054",
    "2026-04-29_2032", "2026-04-30_2053",
]

BANDS = [("night", 0, 20), ("dusk", 20, 60), ("overcast", 60, 110), ("bright", 110, 256)]

# Capture filenames come in three shapes across the lots in data/. Only the date
# is needed, as the split key.
_DATE_PATTERNS = (
    re.compile(r"^(\d{4})-(\d{2})-(\d{2})[ _]"),   # 2026-03-10_1229, 2026-02-20 08_05_58
    re.compile(r"^IMG_(\d{4})(\d{2})(\d{2})_"),    # IMG_20260625_105448, IMG_20260520_195652_294
)


def band(lum):
    return next(name for name, lo, hi in BANDS if lo <= lum < hi)


def capture_date(stem):
    """Returns YYYY-MM-DD, or raises on a filename shape not listed above.

    Raising matters. A slice or a permissive fallback that returns the wrong
    substring groups unrelated frames under one pseudo-day, and the split then
    runs to completion on nonsense groups instead of failing.
    """
    for pattern in _DATE_PATTERNS:
        m = pattern.match(stem)
        if m:
            return "-".join(m.groups())
    raise ValueError(f"unrecognised capture filename: {stem!r}")


def main():
    # 1. Labels, straight from the export zip.
    labels = {}
    with ZipFile(ZIP) as z:
        for name in z.namelist():
            if name.endswith(".txt"):
                text = z.read(name).decode("utf-8")
                lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
                labels[Path(name).stem] = lines
    for stem in EMPTY_KEEP:
        labels[stem] = []

    overlap = sorted(set(labels) & set(NIGHT_EXCLUDE))
    assert not overlap, f"excluded night frames present in the label set: {overlap}"

    missing = sorted(s for s in labels if not (SRC / "images" / f"{s}.jpg").exists())
    assert not missing, f"labels without an image: {missing}"

    # 2. Luminance per frame, used for the split guard and the report.
    lum = {}
    for stem in labels:
        img = cv2.imread(str(SRC / "images" / f"{stem}.jpg"), cv2.IMREAD_GRAYSCALE)
        lum[stem] = float(img.mean())

    # 3. Day-level split. Days are walked in date order and handed to val
    # whenever val sits below its 20% share, which spreads val across the
    # whole capture period instead of clustering it in one season.
    days = defaultdict(list)
    for stem in labels:
        days[capture_date(stem)].append(stem)

    split_of_day, val_frames, seen = {}, 0, 0
    for day in sorted(days):
        n = len(days[day])
        to_val = val_frames < 0.2 * seen
        split_of_day[day] = "val" if to_val else "train"
        val_frames += n if to_val else 0
        seen += n

    for name in ("train", "val"):
        nights = [s for d, sp in split_of_day.items() if sp == name
                  for s in days[d] if lum[s] < 20]
        assert nights, f"{name} split has no night frames"

    # 4. Write the dataset. mkdir refuses an existing directory by design.
    for sub in ("images/train", "images/val", "labels/train", "labels/val"):
        (DST / sub).mkdir(parents=True)

    for day, sp in split_of_day.items():
        for stem in days[day]:
            shutil.copy2(SRC / "images" / f"{stem}.jpg", DST / "images" / sp / f"{stem}.jpg")
            body = "".join(f"{ln}\n" for ln in labels[stem])
            (DST / "labels" / sp / f"{stem}.txt").write_text(body, encoding="utf-8")

    (DST / "dataset.yaml").write_text(
        f"path: {DST.resolve()}\n"
        "train: images/train\n"
        "val: images/val\n"
        "nc: 1\n"
        "names: [vehicle]\n",
        encoding="utf-8",
    )

    val_days = [d for d in sorted(split_of_day) if split_of_day[d] == "val"]
    train_days = [d for d in sorted(split_of_day) if split_of_day[d] == "train"]
    n_val = sum(len(days[d]) for d in val_days)
    n_train = sum(len(days[d]) for d in train_days)
    (DST / "README.md").write_text(
        f"""# Vehicle detection dataset

Single class (`vehicle`), {n_train + n_val} frames at 1600x900, YOLO format.
Generated by `backend/dev/data_prep/build_vehicle_dataset.py`. Do not edit by hand.

## Where the labels came from

200 frames were sampled from the camera archive and pre-labelled with stock COCO
YOLO weights, then corrected by hand in makesense.ai. The corrected export is
`data/vehicle_annotation/labels_yolo_det_data_2026-07-29-07-45-54.zip` and it is
the only source of boxes used here.

The COCO bootstrap labels in `data/vehicle_annotation/labels/` are superseded.
They are the uncorrected machine output and are not read by the build script.

## Frames without a label file

184 of the 200 frames came back with a label file. The remaining 16 were
inspected and fall into two groups that are treated differently.

Six are genuinely empty daylight lots. They are included with empty `.txt`
files, as real negatives that help suppress false positives:

{chr(10).join('- `' + s + '`' for s in EMPTY_KEEP)}

Ten are night frames that do contain vehicles the annotator could not see in the
image. They are excluded from the dataset entirely and appear in neither split:

{chr(10).join('- `' + s + '`' for s in NIGHT_EXCLUDE)}

The reason for excluding rather than including them as empty: a COCO pass at
confidence 0.05 finds one to six vehicles in most of them. Labelling them empty
would teach the detector that vehicles at night are background, which would undo
the hand correction done on the 14 night frames that are properly labelled. The
absent label file records annotator visibility, not an empty lot.

Final size: 184 labelled + 6 empty = {n_train + n_val} frames.

## Split

The split is by capture day, not by frame. Frames from one day share lighting,
weather and largely the same parked cars, so a random split would place near
duplicates on both sides of the split and inflate the validation metric. Whole
days are assigned, so no day contributes to both splits.

Days are walked in date order and handed to val whenever val sits below its 20%
share, which spreads validation across the whole capture period rather than
clustering it in one part of the season.

- train: {len(train_days)} days, {n_train} frames ({n_train / (n_train + n_val):.0%})
- val: {len(val_days)} days, {n_val} frames ({n_val / (n_train + n_val):.0%})

Val days: {", ".join(val_days)}

Train days: {", ".join(train_days)}

Both splits contain night frames (mean luminance below 20), which is the hard
case for this camera. A val set without night frames would not measure it.
""",
        encoding="utf-8",
    )

    # 5. Validation over what was actually written.
    print(f"=== {DST} ===")
    bad = []
    boxes = {"train": 0, "val": 0}
    for sp in ("train", "val"):
        for txt in sorted((DST / "labels" / sp).glob("*.txt")):
            for i, ln in enumerate(txt.read_text().splitlines(), 1):
                if not ln.strip():
                    continue
                parts = ln.split()
                ok = len(parts) == 5 and parts[0] == "0"
                if ok:
                    vals = [float(p) for p in parts[1:]]
                    ok = all(0.0 < v < 1.0 for v in vals)
                if not ok:
                    bad.append(f"{sp}/{txt.name}:{i} {ln!r}")
                boxes[sp] += 1
    print(f"label format 0 xc yc w h, all floats strictly in (0,1): "
          f"{'PASS' if not bad else 'FAIL ' + str(bad[:5])}")

    pair_err = []
    for sp in ("train", "val"):
        imgs = {p.stem for p in (DST / "images" / sp).glob("*.jpg")}
        lbls = {p.stem for p in (DST / "labels" / sp).glob("*.txt")}
        pair_err += [f"{sp}: image without label {s}" for s in sorted(imgs - lbls)]
        pair_err += [f"{sp}: label without image {s}" for s in sorted(lbls - imgs)]
    print(f"image/label pairing both ways: {'PASS' if not pair_err else 'FAIL ' + str(pair_err)}")

    written = {p.stem for sp in ("train", "val") for p in (DST / "images" / sp).glob("*.jpg")}
    leaked = sorted(set(NIGHT_EXCLUDE) & written)
    print(f"10 excluded night frames absent from output: {'PASS' if not leaked else 'FAIL ' + str(leaked)}")

    empt = []
    for stem in EMPTY_KEEP:
        hits = [p for sp in ("train", "val") if (p := DST / "labels" / sp / f"{stem}.txt").exists()]
        if len(hits) != 1 or hits[0].stat().st_size != 0:
            empt.append(stem)
    print(f"6 empty-lot frames present with empty label files: {'PASS' if not empt else 'FAIL ' + str(empt)}")

    # 6. Report.
    total = len(written)
    print(f"\nframes {total}   boxes {sum(boxes.values())}   "
          f"boxes/frame {sum(boxes.values()) / total:.2f}")
    for sp in ("train", "val"):
        n = len(list((DST / "images" / sp).glob("*.jpg")))
        print(f"{sp}: {n} frames ({n / total:.0%})   {boxes[sp]} boxes")

    print("\nluminance bands (frames / boxes)")
    print(f"{'band':<10}{'train':>16}{'val':>16}")
    for name, lo, hi in BANDS:
        cells = []
        for sp in ("train", "val"):
            stems = [p.stem for p in (DST / "images" / sp).glob("*.jpg") if lo <= lum[p.stem] < hi]
            b = sum(len(labels[s]) for s in stems)
            cells.append(f"{len(stems)} / {b}")
        print(f"{name:<10}{cells[0]:>16}{cells[1]:>16}")

    print("\nday assignment")
    for day in sorted(split_of_day):
        stems = days[day]
        nights = sum(1 for s in stems if lum[s] < 20)
        print(f"  {day}  {split_of_day[day]:<6} {len(stems):>2} frames  "
              f"{sum(len(labels[s]) for s in stems):>3} boxes  {nights} night")

    return split_of_day, days, lum, labels


if __name__ == "__main__":
    main()
