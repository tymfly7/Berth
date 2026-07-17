"""
Edge Smoke Check — post-deploy sanity
======================================
Verifies the NCNN model loads and produces a sane prediction on this device.
Run after every deploy/restart; exit code 0 = pass, 1 = fail.

    python edge_check.py [--model yolo26n_classify] [--image path/to/crop.jpg]

Without --image a synthetic gray crop is used — that checks load + inference
plumbing (layer names, threads, export integrity), not accuracy.
"""

import argparse
import sys
import time
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import config
from eval_edge import build_classifier


def main():
    ap = argparse.ArgumentParser(description="NCNN model load + single-inference smoke check.")
    ap.add_argument("--model", default=config.ACTIVE_MODEL, help="classifier name (default: BERTH_MODEL)")
    ap.add_argument("--image", default="", help="optional real crop to classify")
    args = ap.parse_args()

    clf = build_classifier(args.model)
    t0 = time.perf_counter()
    clf.load()
    load_ms = (time.perf_counter() - t0) * 1000

    if not clf.is_loaded():
        print(f"FAIL: model '{args.model}' did not load — check edge_models/ exports.")
        sys.exit(1)
    print(f"PASS: model '{args.model}' loaded in {load_ms:.0f} ms")

    image = args.image if args.image else Image.new("RGB", (128, 128), (96, 96, 96))
    t0 = time.perf_counter()
    result = clf.predict(image)
    infer_ms = (time.perf_counter() - t0) * 1000

    if not (0.0 <= result["probability"] <= 1.0):
        print(f"FAIL: probability out of range: {result}")
        sys.exit(1)
    print(f"PASS: inference in {infer_ms:.0f} ms -> {result}")
    sys.exit(0)


if __name__ == "__main__":
    main()
