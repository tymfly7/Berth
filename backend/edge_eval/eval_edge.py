"""
Edge Evaluation CLI — API-off, torch-free
==========================================
Standalone evaluation runner for edge devices (RPi 5 / 3B / Zero 2W). Never
imports FastAPI or torch — only config, the NCNN classifiers, numpy and PIL —
so the full CPU/RAM budget goes to inference while the berth service is stopped.

Walks a crops dataset (occupied/ + vacant/ folders, same layout as the T12Lot
benchmark), classifies every crop with the exported NCNN model, and writes one
timestamped session directory of CSV files:

    predictions.csv   one row per crop (label, probability, latency, ...)
    summary.csv       one row per session (metrics, latency stats, run info)
    system.csv        sampled CPU / RAM / temperature / throttling during the run

Usage (from backend/, service stopped — see run_eval.sh):
    python eval_edge.py --dataset data/t12lot_subset [--model yolo26n_classify]
                        [--threads 3] [--limit 250] [--out eval_results]
                        [--parity eval_results/goldens_yolo26n_classify.json]
"""

import argparse
import csv
import json
import os
import platform
import subprocess
import sys
import threading
import time
from datetime import datetime
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import config

IMG_EXTS = {".jpg", ".jpeg", ".png", ".bmp"}


# ── Dataset discovery (T12Lot crops layout) ──────────────────────────────────

def resolve_dataset(root: Path) -> Path:
    """Accept either the dataset root or its crops_classifier/ subdirectory."""
    if (root / "crops_classifier").is_dir():
        return root / "crops_classifier"
    return root


def collect_files(dataset_dir: Path, limit: int = 0):
    """Return [(path, true_label), ...] from occupied/ and vacant/ subdirs."""
    files = []
    for label in ("occupied", "vacant"):
        d = dataset_dir / label
        if not d.is_dir():
            continue
        imgs = sorted(p for p in d.iterdir() if p.suffix.lower() in IMG_EXTS)
        if limit:
            imgs = imgs[:limit]
        files.extend((p, label) for p in imgs)
    return files


# ── Classifier construction (lazy ncnn import — make_goldens.py reuses the
#    helpers above on the torch-only hub where ncnn may be absent) ────────────

def build_classifier(model_name: str):
    if model_name.endswith("_classify"):
        from src.inference.ncnn_classifier import EdgeYoloClassifier
        return EdgeYoloClassifier(model_name=model_name)
    from src.inference.ncnn_classifier import EdgeClassifier
    return EdgeClassifier(model_name=model_name)


def decide(model_name: str, probability: float) -> str:
    """Occupied/vacant decision matching the classifier's own rule: YOLO
    classify heads use the sub-0.5 OCCUPANCY_THRESHOLD, CNN models use 0.5."""
    thr = config.OCCUPANCY_THRESHOLD if model_name.endswith("_classify") else 0.5
    return "occupied" if probability > thr else "vacant"


# ── System sampler — /proc + vcgencmd, no psutil ─────────────────────────────

class SystemSampler(threading.Thread):
    """Samples device health every `interval` seconds while eval runs. Every
    probe is best-effort: on a box without /proc or vcgencmd (e.g. dev Windows,
    Docker without the vc utils) the column is left blank rather than failing."""

    FIELDS = ["timestamp", "cpu_percent", "rss_mb", "mem_available_mb",
              "cpu_temp_c", "throttled_hex", "load_avg_1m"]

    def __init__(self, interval: float):
        super().__init__(daemon=True)
        self.interval = interval
        self.rows = []
        self._stop_evt = threading.Event()
        self._prev_cpu = self._cpu_times()

    @staticmethod
    def _cpu_times():
        try:
            fields = Path("/proc/stat").read_text().splitlines()[0].split()[1:]
            vals = [int(v) for v in fields]
            return sum(vals), vals[3] + (vals[4] if len(vals) > 4 else 0)  # total, idle+iowait
        except Exception:
            return None

    def _cpu_percent(self):
        cur = self._cpu_times()
        if cur is None or self._prev_cpu is None:
            return ""
        d_total = cur[0] - self._prev_cpu[0]
        d_idle = cur[1] - self._prev_cpu[1]
        self._prev_cpu = cur
        if d_total <= 0:
            return ""
        return round(100.0 * (d_total - d_idle) / d_total, 1)

    @staticmethod
    def _proc_kb(path: str, key: str):
        try:
            for line in Path(path).read_text().splitlines():
                if line.startswith(key):
                    return round(int(line.split()[1]) / 1024, 1)  # kB → MB
        except Exception:
            pass
        return ""

    @staticmethod
    def _cpu_temp():
        try:
            return round(int(Path("/sys/class/thermal/thermal_zone0/temp").read_text()) / 1000, 1)
        except Exception:
            return ""

    @staticmethod
    def _throttled():
        try:
            out = subprocess.run(["vcgencmd", "get_throttled"], capture_output=True,
                                 text=True, timeout=5).stdout.strip()
            return out.split("=")[1] if "=" in out else ""
        except Exception:
            return ""

    @staticmethod
    def _load_avg():
        try:
            return round(os.getloadavg()[0], 2)
        except (AttributeError, OSError):
            return ""

    def _sample(self):
        self.rows.append({
            "timestamp": datetime.now().isoformat(timespec="seconds"),
            "cpu_percent": self._cpu_percent(),
            "rss_mb": self._proc_kb("/proc/self/status", "VmRSS"),
            "mem_available_mb": self._proc_kb("/proc/meminfo", "MemAvailable"),
            "cpu_temp_c": self._cpu_temp(),
            "throttled_hex": self._throttled(),
            "load_avg_1m": self._load_avg(),
        })

    def run(self):
        while not self._stop_evt.wait(self.interval):
            self._sample()

    def stop(self):
        self._stop_evt.set()
        self._sample()  # final sample so short runs still get one row


# ── Helpers ──────────────────────────────────────────────────────────────────

def git_commit() -> str:
    try:
        return subprocess.run(
            ["git", "-C", str(Path(__file__).resolve().parent.parent), "rev-parse", "--short", "HEAD"],
            capture_output=True, text=True, timeout=5).stdout.strip()
    except Exception:
        return ""


def write_csv(path: Path, fieldnames, rows):
    with open(path, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


# ── Main ─────────────────────────────────────────────────────────────────────

def main():
    ap = argparse.ArgumentParser(description="Torch-free NCNN evaluation on edge devices (writes CSVs).")
    ap.add_argument("--model", default=config.ACTIVE_MODEL, help="classifier name (default: BERTH_MODEL)")
    ap.add_argument("--dataset", required=True, help="dataset dir with occupied/ + vacant/ crops")
    ap.add_argument("--threads", type=int, default=config.NCNN_THREADS, help="NCNN threads per inference")
    ap.add_argument("--limit", type=int, default=0, help="max crops per class (0 = all)")
    ap.add_argument("--out", default=str(config.BASE_DIR / "eval_results"), help="results base directory")
    ap.add_argument("--device", default=platform.node() or "edge", help="device tag in filenames/summary")
    ap.add_argument("--parity", default="", help="goldens JSON from make_goldens.py to check NCNN↔torch drift")
    ap.add_argument("--sample-interval", type=float, default=5.0, help="system sampler period, seconds")
    args = ap.parse_args()

    dataset_dir = resolve_dataset(Path(args.dataset))
    files = collect_files(dataset_dir, args.limit)
    if not files:
        sys.exit(f"No crops found under {dataset_dir} (expected occupied/ and vacant/ subdirs).")

    config.NCNN_THREADS = args.threads
    clf = build_classifier(args.model)
    t0 = time.perf_counter()
    clf.load()
    load_time_ms = (time.perf_counter() - t0) * 1000
    if not clf.is_loaded():
        sys.exit(f"Model '{args.model}' failed to load — check edge_models/ exports.")

    print(f"Model {args.model} loaded in {load_time_ms:.0f} ms — "
          f"evaluating {len(files)} crops with {args.threads} NCNN thread(s)...")

    sampler = SystemSampler(args.sample_interval)
    sampler.start()

    predictions = []
    run_start = time.perf_counter()
    for i, (path, true_label) in enumerate(files, 1):
        t = time.perf_counter()
        result = clf.predict(path)
        latency_ms = (time.perf_counter() - t) * 1000
        prob = result["probability"]
        pred_label = decide(args.model, prob)
        predictions.append({
            "filename": f"{true_label}/{path.name}",
            "true_label": true_label,
            "pred_label": pred_label,
            "status": result["status"],
            "probability": prob,
            "confidence": result["confidence"],
            "correct": int(pred_label == true_label),
            "latency_ms": round(latency_ms, 2),
        })
        if i % 100 == 0:
            print(f"  {i}/{len(files)}")
    total_duration_s = time.perf_counter() - run_start
    sampler.stop()

    # ── Metrics (occupied = positive class) ──────────────────────────────────
    tp = sum(1 for p in predictions if p["true_label"] == "occupied" and p["pred_label"] == "occupied")
    tn = sum(1 for p in predictions if p["true_label"] == "vacant" and p["pred_label"] == "vacant")
    fp = sum(1 for p in predictions if p["true_label"] == "vacant" and p["pred_label"] == "occupied")
    fn = sum(1 for p in predictions if p["true_label"] == "occupied" and p["pred_label"] == "vacant")
    n = len(predictions)
    accuracy = (tp + tn) / n
    precision = tp / (tp + fp) if (tp + fp) else 0.0
    recall = tp / (tp + fn) if (tp + fn) else 0.0
    f1 = 2 * precision * recall / (precision + recall) if (precision + recall) else 0.0

    lat = np.array([p["latency_ms"] for p in predictions])
    summary = {
        "device": args.device,
        "model": args.model,
        "dataset": str(dataset_dir),
        "n_images": n,
        "n_occupied": sum(1 for p in predictions if p["true_label"] == "occupied"),
        "n_vacant": sum(1 for p in predictions if p["true_label"] == "vacant"),
        "n_unknown": sum(1 for p in predictions if p["status"] == "unknown"),
        "accuracy": round(accuracy, 4),
        "precision": round(precision, 4),
        "recall": round(recall, 4),
        "f1": round(f1, 4),
        "tp": tp, "tn": tn, "fp": fp, "fn": fn,
        "latency_mean_ms": round(float(lat.mean()), 2),
        "latency_p50_ms": round(float(np.percentile(lat, 50)), 2),
        "latency_p95_ms": round(float(np.percentile(lat, 95)), 2),
        "latency_max_ms": round(float(lat.max()), 2),
        "throughput_imgs_per_s": round(n / total_duration_s, 2),
        "ncnn_threads": args.threads,
        "load_time_ms": round(load_time_ms, 1),
        "total_duration_s": round(total_duration_s, 1),
        "git_commit": git_commit(),
        "parity_n": "", "parity_max_drift": "", "parity_mean_drift": "", "parity_label_agreement": "",
    }

    # ── Parity vs hub goldens ────────────────────────────────────────────────
    if args.parity:
        goldens = json.loads(Path(args.parity).read_text())["files"]
        drifts, agree = [], 0
        for p in predictions:
            golden_prob = goldens.get(p["filename"])
            if golden_prob is None:
                continue
            drifts.append(abs(p["probability"] - golden_prob))
            agree += int(decide(args.model, golden_prob) == p["pred_label"])
        if drifts:
            summary["parity_n"] = len(drifts)
            summary["parity_max_drift"] = round(max(drifts), 4)
            summary["parity_mean_drift"] = round(float(np.mean(drifts)), 4)
            summary["parity_label_agreement"] = round(agree / len(drifts), 4)
        else:
            print("Warning: no golden entries matched the evaluated files — parity skipped.")

    # ── Write session CSVs ───────────────────────────────────────────────────
    session = f"{args.device}_{args.model}_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
    out_dir = Path(args.out) / session
    out_dir.mkdir(parents=True, exist_ok=True)
    write_csv(out_dir / "predictions.csv", list(predictions[0].keys()), predictions)
    write_csv(out_dir / "summary.csv", list(summary.keys()), [summary])
    write_csv(out_dir / "system.csv", SystemSampler.FIELDS, sampler.rows)

    print(f"\n{'=' * 60}")
    print(f"  accuracy {accuracy:.4f}  precision {precision:.4f}  "
          f"recall {recall:.4f}  f1 {f1:.4f}")
    print(f"  latency p50 {summary['latency_p50_ms']} ms  p95 {summary['latency_p95_ms']} ms  "
          f"throughput {summary['throughput_imgs_per_s']} img/s")
    if summary["parity_n"]:
        print(f"  parity: n={summary['parity_n']}  max drift {summary['parity_max_drift']}  "
              f"label agreement {summary['parity_label_agreement']}")
    print(f"  CSVs written to {out_dir}")


if __name__ == "__main__":
    main()
