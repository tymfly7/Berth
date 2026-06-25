"""krom crop-dump diagnostic — what does the CNN actually receive on the live feed?

Reproduces slot_detector's exact per-slot crop (gray-128 polygon mask) from the saved
kromd snapshot + ROIs, plus an UNMASKED raw-bbox version, and runs cnn_scratch on both.

Goal: see whether the gray-128 masking on krom's oblique bays is what flips spots to
"occupied", vs. the unmasked crop the model would actually classify correctly.

Outputs:
  - prints a per-slot table: masked pred vs unmasked pred
  - krom_dump_masked.png / krom_dump_unmasked.png  (montages with predictions)
"""
import json
import sys
from pathlib import Path

import cv2
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

ROOT = Path(__file__).resolve().parent          # backend/
sys.path.insert(0, str(ROOT))
import config
from src.inference.classifier import ParkingClassifier

CAM = "kromd-afe50d"
SNAP = config.ROI_CONFIG_DIR / f"{CAM}_snapshot.jpg"
ROIS = config.ROI_CONFIG_DIR / f"{CAM}.json"

frame = cv2.imread(str(SNAP))                    # BGR, as production decodes
if frame is None:
    sys.exit(f"Could not read snapshot {SNAP}")
rois = json.loads(ROIS.read_text())
fh, fw = frame.shape[:2]
print(f"Snapshot {fw}x{fh}, {len(rois)} ROIs\n")

clf = ParkingClassifier(model_name="cnn_scratch")
clf.load()
if not clf.is_loaded():
    sys.exit("cnn_scratch failed to load")


def crop_for(roi):
    """Return (masked_bgr, unmasked_bgr) exactly as slot_detector would build them."""
    polygon = roi["polygon"]
    xs = [p[0] for p in polygon]
    ys = [p[1] for p in polygon]
    x1 = max(0, int(min(xs) * fw)); y1 = max(0, int(min(ys) * fh))
    x2 = min(fw, int(max(xs) * fw)); y2 = min(fh, int(max(ys) * fh))
    bw, bh = x2 - x1, y2 - y1
    if bw <= 5 or bh <= 5:
        return None, None
    raw = frame[y1:y2, x1:x2].copy()
    masked = raw.copy()
    poly_pts = np.array([[int(p[0] * fw) - x1, int(p[1] * fh) - y1] for p in polygon], np.int32)
    mask = np.zeros(raw.shape[:2], np.uint8)
    cv2.fillPoly(mask, [poly_pts], 255)
    masked[mask == 0] = 128
    return masked, raw


def pred(img_bgr):
    r = clf.predict(img_bgr)
    return r["status"], r["probability"]   # probability = P(occupied)


rows = []
masked_imgs, unmasked_imgs = [], []
for roi in rois:
    m, u = crop_for(roi)
    if m is None:
        continue
    ms, mp = pred(m)
    us, up = pred(u)
    rows.append((roi.get("label", roi["id"]), ms, mp, us, up))
    masked_imgs.append((roi.get("label", roi["id"]), m, ms, mp))
    unmasked_imgs.append((roi.get("label", roi["id"]), u, us, up))

# ── table ────────────────────────────────────────────────────────────────────
print(f"{'slot':<10} {'MASKED (prod)':<22} {'UNMASKED':<22} {'flip?'}")
flips = 0
for label, ms, mp, us, up in rows:
    flip = "  <-- FLIP" if ms != us else ""
    if ms != us:
        flips += 1
    print(f"{label:<10} {ms:<8} P(occ)={mp:<6} {us:<8} P(occ)={up:<6}{flip}")

m_occ = sum(1 for _, ms, *_ in rows if ms == "occupied")
u_occ = sum(1 for r in rows if r[3] == "occupied")
n = len(rows)
print(f"\nMASKED  : {n - m_occ} vacant / {m_occ} occupied  (of {n})")
print(f"UNMASKED: {n - u_occ} vacant / {u_occ} occupied  (of {n})")
print(f"{flips} slots flip between masked and unmasked.")
print("\nReading it:")
print("  many spots occupied when masked but vacant when unmasked → the gray-128 mask is the bug.")
print("  masked == unmasked → masking is innocent; it's domain shift (oblique krom vs PKLot).")


# ── montages ─────────────────────────────────────────────────────────────────
def montage(items, path, title):
    cols = 4
    rows_ = (len(items) + cols - 1) // cols
    fig, axes = plt.subplots(rows_, cols, figsize=(16, 4 * rows_))
    fig.suptitle(title, fontsize=14, fontweight="bold")
    axes = np.array(axes).reshape(-1)
    for ax in axes:
        ax.axis("off")
    for i, (label, img, status, prob) in enumerate(items):
        axes[i].imshow(cv2.cvtColor(img, cv2.COLOR_BGR2RGB))
        color = "red" if status == "occupied" else "green"
        axes[i].set_title(f"{label}: {status}\nP(occ)={prob:.2f}", color=color,
                          fontsize=10, fontweight="bold")
    plt.tight_layout()
    plt.savefig(path, dpi=120, bbox_inches="tight")
    plt.close()
    print(f"Saved: {path}")


print()
montage(masked_imgs, ROOT / "krom_dump_masked.png", "kromd — MASKED crops (what production feeds cnn_scratch)")
montage(unmasked_imgs, ROOT / "krom_dump_unmasked.png", "kromd — UNMASKED raw-bbox crops")
