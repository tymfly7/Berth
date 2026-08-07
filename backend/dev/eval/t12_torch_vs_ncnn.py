"""Score the classifier roster on the T12Lot crops under both runtimes.

Every published T12Lot number (outputs/model_comparison_t12lot.json) was produced
with torch, while every NCNN measurement so far is on T10Lot. That leaves the
cross-lot claim and the edge claim joined by argument rather than by one
measurement. This runs the same 746 T12Lot crops through torch and through the
NCNN exports, at threshold 0.5 for every model, so the two are directly
comparable.

The crops are identical between the two runs, so parity is checked per crop
(probability drift, label agreement) and not only per metric.

Usage (from backend/):
    python -m dev.eval.t12_torch_vs_ncnn
"""
import argparse
import json
import platform
import time
from datetime import datetime
from pathlib import Path

import numpy as np

import config
from edge_eval.eval_edge import build_classifier, collect_files, resolve_dataset

# The published torch table this run has to line up against.
REFERENCE_JSON = config.OUTPUT_DIR / "model_comparison_t12lot.json"


def score(files, model_name, runtime, threshold):
    """Run one model under one runtime. Returns (metrics, per-crop probabilities)."""
    clf = build_classifier(model_name, runtime)
    clf.load()
    if not clf.is_loaded():
        return None, None

    probs, latencies = [], []
    for path, _ in files:
        t = time.perf_counter()
        result = clf.predict(str(path))
        latencies.append((time.perf_counter() - t) * 1000)
        probs.append(result["probability"])

    truth = np.array([1 if lbl == "occupied" else 0 for _, lbl in files])
    pred = (np.array(probs) > threshold).astype(int)
    tp = int(((pred == 1) & (truth == 1)).sum())
    tn = int(((pred == 0) & (truth == 0)).sum())
    fp = int(((pred == 1) & (truth == 0)).sum())
    fn = int(((pred == 0) & (truth == 1)).sum())
    precision = tp / (tp + fp) if (tp + fp) else 0.0
    recall = tp / (tp + fn) if (tp + fn) else 0.0
    f1 = 2 * precision * recall / (precision + recall) if (precision + recall) else 0.0

    lat = np.array(latencies)
    metrics = {
        "accuracy": round((tp + tn) / len(truth) * 100, 2),
        "precision": round(precision * 100, 2),
        "recall": round(recall * 100, 2),
        "f1": round(f1 * 100, 2),
        "tp": tp, "tn": tn, "fp": fp, "fn": fn,
        "latency": {
            "crops": len(lat),
            "median_ms": round(float(np.percentile(lat, 50)), 2),
            "mean_ms": round(float(lat.mean()), 2),
            "p95_ms": round(float(np.percentile(lat, 95)), 2),
        },
    }
    return metrics, np.array(probs)


def summarise(rows, parity):
    """Conclusion block, derived from the rows so it cannot drift from them."""
    by = {(r["model"], r["backend"]): r for r in rows}
    models = sorted({m for m, _ in by})
    exact = [m for m in models
             if (m, "torch") in by and (m, "ncnn") in by
             and all(by[(m, "torch")][k] == by[(m, "ncnn")][k]
                     for k in ("accuracy", "precision", "recall", "f1", "tp", "tn", "fp", "fn"))]
    ncnn_rows = [r for r in rows if r["backend"] == "ncnn"]
    best = max(ncnn_rows, key=lambda r: r["accuracy"]) if ncnn_rows else None
    reproduced = [r["model"] for r in rows if r["backend"] == "torch"
                  and r.get("published_accuracy") == r["accuracy"]]
    diverged = [{"model": r["model"], "published": r["published_accuracy"], "rerun": r["accuracy"]}
                for r in rows if r["backend"] == "torch"
                and r.get("published_accuracy") is not None
                and r["published_accuracy"] != r["accuracy"]]
    return {
        "parity_holds": len(exact) == len(models),
        "models_bit_identical_on_metrics": exact,
        "total_labels_flipped": sum(p["labels_flipped"] for p in parity),
        "total_decisions": sum(r["crops"] for r in rows if r["backend"] == "ncnn"),
        "max_prob_drift_any_model": max((p["max_prob_drift"] for p in parity), default=None),
        "best_model_under_ncnn": {"model": best["model"], "accuracy": best["accuracy"]} if best else None,
        "torch_rerun_reproduces_published": reproduced,
        "torch_rerun_diverges_from_published": diverged,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dataset", default=str(config.DATA_DIR / "t12lot"))
    ap.add_argument("--models", nargs="*", default=list(config.CLASSIFY_MODELS))
    ap.add_argument("--threshold", type=float, default=0.5)
    ap.add_argument("--json-out", default=str(config.OUTPUT_DIR / "t12_torch_vs_ncnn_parity.json"))
    args = ap.parse_args()

    files = collect_files(resolve_dataset(Path(args.dataset)))
    occupied = sum(1 for _, lbl in files if lbl == "occupied")
    print(f"t12lot: {len(files)} crops ({occupied} occupied / {len(files) - occupied} vacant), "
          f"threshold {args.threshold}")

    reference = {}
    if REFERENCE_JSON.exists():
        reference = {r["model"]: r for r in json.loads(REFERENCE_JSON.read_text())}

    rows, findings = [], []
    for name in args.models:
        probs = {}
        for runtime in ("torch", "ncnn"):
            metrics, p = score(files, name, runtime, args.threshold)
            if metrics is None:
                print(f"{name:18s} {runtime:5s} not loaded")
                continue
            probs[runtime] = p
            row = {"model": name, "dataset": "t12lot", "lot": "t12lot",
                   "split": "benchmark_crops", "crops": len(files),
                   "backend": runtime, "threshold": args.threshold, **metrics}
            if runtime == "torch" and name in reference:
                row["published_accuracy"] = reference[name].get("test_accuracy")
            rows.append(row)
            print(f"{name:18s} {runtime:5s} acc {metrics['accuracy']:6.2f}  "
                  f"P {metrics['precision']:6.2f}  R {metrics['recall']:6.2f}  "
                  f"FP {metrics['fp']:3d}  FN {metrics['fn']:3d}  "
                  f"{metrics['latency']['median_ms']:7.2f} ms")

        if len(probs) == 2:
            drift = np.abs(probs["torch"] - probs["ncnn"])
            agree = ((probs["torch"] > args.threshold) == (probs["ncnn"] > args.threshold))
            findings.append({
                "model": name,
                "accuracy_delta": round(
                    next(r["accuracy"] for r in rows if r["model"] == name and r["backend"] == "ncnn")
                    - next(r["accuracy"] for r in rows if r["model"] == name and r["backend"] == "torch"), 2),
                "max_prob_drift": round(float(drift.max()), 4),
                "mean_prob_drift": round(float(drift.mean()), 4),
                "label_agreement": round(float(agree.mean()) * 100, 2),
                "labels_flipped": int((~agree).sum()),
            })

    try:
        import torch
        torch_version = torch.__version__
    except Exception:
        torch_version = None
    try:
        import ncnn
        ncnn_version = getattr(ncnn, "__version__", "unknown")
    except Exception:
        ncnn_version = None

    Path(args.json_out).write_text(json.dumps({
        "measurement": "torch vs ncnn parity, occupancy classifier roster, unseen lot (T12Lot)",
        "timestamp": datetime.now().isoformat(timespec="seconds"),
        "machine": f"{platform.system()} dev machine, CPU only, {platform.processor()}",
        "torch": torch_version,
        "ncnn": ncnn_version,
        "dataset": str(resolve_dataset(Path(args.dataset))),
        "torch_weights": str(config.MODEL_DIR),
        "ncnn_weights": str(config.EDGE_MODEL_DIR),
        "threshold": args.threshold,
        "notes": [
            "The 746 crops are the same T12Lot benchmark set behind model_comparison_t12lot.json "
            "(502 occupied / 244 vacant), so the torch rows here are a re-run of the published table.",
            "Threshold is 0.5 for every model, matching evaluator.py (sigmoid > 0.5) and the argmax "
            "the YOLO classify table used. config.OCCUPANCY_THRESHOLD (0.40) is deliberately not applied.",
            "Both backends are driven through the classifier pair the deployment actually uses: "
            "ParkingClassifier for torch, EdgeClassifier / EdgeYoloClassifier for NCNN. Preprocessing "
            "is matched by construction, so drift is attributable to the export, not the harness.",
            "The YOLO classify torch rows add the _letterbox_square step that the published table's raw "
            "Ultralytics predict() did not, so those may sit slightly off published_accuracy. The "
            "torch/ncnn pair stays internally consistent either way.",
            "Both classifiers round probability to 4 decimals before returning, so drift below 5e-5 "
            "reads as 0.0000. That is the resolution of max_prob_drift, not a claim of bit equality.",
            "Edge hardware out of scope. These are x86 timings and do not predict ARM.",
            "ncnn defaults use_fp16_storage and use_fp16_arithmetic on, and Cortex-A76 has fp16 arithmetic "
            "where x86 does not, so borderline probabilities could move on the Pi. Margins wide enough to "
            "survive that are reported in label_agreement and max_prob_drift.",
        ],
        "rows": rows,
        "parity": findings,
        "finding": summarise(rows, findings),
    }, indent=2))
    print(f"wrote {args.json_out}")


if __name__ == "__main__":
    main()
