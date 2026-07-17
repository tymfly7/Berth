"""
Golden Outputs Generator — hub side (torch)
============================================
Runs a fixed crop set through the full torch classifier and writes their
probabilities to a goldens JSON. Ship that JSON to an edge device and pass it
to eval_edge.py --parity to measure PyTorch -> NCNN conversion drift.

Run on the hub/dev machine (needs torch), from backend/:
    python make_goldens.py --dataset data/t12lot_subset [--model yolo26n_classify]
                           [--limit 30] [--out eval_results/goldens_<model>.json]
"""

import argparse
import json
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import config
from eval_edge import collect_files, resolve_dataset


def main():
    ap = argparse.ArgumentParser(description="Generate torch golden probabilities for edge parity checks.")
    ap.add_argument("--model", default=config.ACTIVE_MODEL, help="classifier name (default: BERTH_MODEL)")
    ap.add_argument("--dataset", required=True, help="dataset dir with occupied/ + vacant/ crops")
    ap.add_argument("--limit", type=int, default=30, help="crops per class (0 = all)")
    ap.add_argument("--out", default="", help="output JSON path")
    args = ap.parse_args()

    files = collect_files(resolve_dataset(Path(args.dataset)), args.limit)
    if not files:
        sys.exit(f"No crops found under {args.dataset} (expected occupied/ and vacant/ subdirs).")

    from src.inference.torch_classifier import ParkingClassifier
    clf = ParkingClassifier(model_name=args.model)
    clf.load()
    if not clf.is_loaded():
        sys.exit(f"Model '{args.model}' failed to load — train/export it first.")

    goldens = {f"{label}/{path.name}": clf.predict(path)["probability"]
               for path, label in files}

    out_path = Path(args.out) if args.out else config.BASE_DIR / "eval_results" / f"goldens_{args.model}.json"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps({
        "model": args.model,
        "created": datetime.now().isoformat(timespec="seconds"),
        "n_files": len(goldens),
        "files": goldens,
    }, indent=2))
    print(f"Wrote {len(goldens)} golden probabilities to {out_path}")


if __name__ == "__main__":
    main()
