# Edge Device Evaluation

Standalone, API-off benchmarking of the exported classifiers on the Raspberry Pi
boards and on the development laptop. The eval CLI never starts FastAPI/uvicorn.

The default runtime is NCNN and torch-free, which is what the edge nodes actually
run and the only runtime that fits on the 512 MB / 1 GB boards. A
`--runtime torch` path exists for benchmarking the same weights with PyTorch, and
is documented in section 10.

Every block below is bash (Git Bash / WSL / macOS / Linux) unless marked
PowerShell. `USER@HOST` is the device login, substituted per board. The install
path is `~/berth` on every device, matching
[deploy/edge/native/README.md](../../deploy/edge/native/README.md).

---

## Contents

1. [The harness](#1-the-harness)
2. [Dataset layout](#2-dataset-layout)
3. [CLI reference](#3-cli-reference)
4. [Outputs](#4-outputs)
5. [Shipping scripts and datasets to a device](#5-shipping-scripts-and-datasets-to-a-device)
6. [Running the evaluation](#6-running-the-evaluation)
7. [Parity check: PyTorch to NCNN drift](#7-parity-check-pytorch-to-ncnn-drift)
8. [Collecting results](#8-collecting-results)
9. [Reading the numbers](#9-reading-the-numbers)
10. [PyTorch runtime, natively on the Pi 5](#10-pytorch-runtime-natively-on-the-pi-5)

---

## 1. The harness

All four files live in `backend/edge_eval/`.

| File | Runs on | Purpose |
|---|---|---|
| `eval_edge.py` | edge devices, laptop | Eval CLI. Classifies a crops dataset, writes three CSVs |
| `edge_check.py` | edge devices | Post-deploy smoke check (model load + one inference), exit 0/1 |
| `make_goldens.py` | hub / dev (needs torch) | Generates golden probabilities for parity checks |
| `run_eval.sh` | native devices | Stops the `berth` service, runs the eval, restarts it on exit |

The dependency budget on a device is numpy, Pillow, and ncnn only, all already
present in the edge install. System statistics are read from `/proc`,
`/sys/class/thermal` and `vcgencmd`, each best-effort and left blank on failure.

The scripts must stay in `backend/edge_eval/`. They bootstrap `sys.path` from
`Path(__file__).resolve().parent.parent`, and `run_eval.sh` additionally depends
on the sibling `venv/` and `data/` paths.

---

## 2. Dataset layout

Same as the benchmark crops layout (a `crops_classifier/` parent is also
accepted):

```
<dataset>/
    occupied/  *.jpg
    vacant/    *.jpg
```

Ship a small fixed subset (roughly 200–500 crops) to the devices, since the
Zero 2 W cannot hold the full set. `--limit N` caps crops per class on top of
whatever was shipped.

---

## 3. CLI reference

```bash
python edge_eval/eval_edge.py --dataset <dir> [options]
```

| Flag | Default | Meaning |
|---|---|---|
| `--dataset` | *(required)* | Directory holding `occupied/` + `vacant/` crops |
| `--model` | `BERTH_MODEL` | `cnn_scratch` `resnet18` `resnet50` `mobilenetv4s` `mobilenetv4m` `yolo26n_classify` `yolo26s_classify` `yolo26m_classify` |
| `--runtime` | `ncnn` | `ncnn` (torch-free) or `torch` (lazily imported, see section 10) |
| `--threads` | `BERTH_NCNN_THREADS` | Inference threads, honored by both runtimes |
| `--limit` | `0` | Max crops per class (`0` = all) |
| `--device` | hostname | Device tag written into the session directory name and `summary.csv` |
| `--out` | `backend/eval_results` | Results base directory |
| `--parity` | *(off)* | Goldens JSON from `make_goldens.py`, see section 7 |
| `--sample-interval` | `5.0` | System sampler period in seconds |

The decision rule matches production: YOLO classify heads use
`OCCUPANCY_THRESHOLD` (0.40), the CNN models use 0.5. Occupied is the positive
class.

Keep `--device` free of underscores where possible (`rpi5-nvme`, not
`rpi5_nvme`). The session directory is `<device>_<model>_<runtime>_<timestamp>`
and the dev-side run-history UI parses that name positionally.

---

## 4. Outputs

One session directory per run:
`eval_results/<device>_<model>_<runtime>_<timestamp>/`

| File | Contents |
|---|---|
| `predictions.csv` | Per crop: `filename, true_label, pred_label, status, probability, confidence, correct, latency_ms` |
| `summary.csv` | One row: device, model, dataset, counts (including below-threshold `n_unknown`), accuracy / precision / recall / f1, tp/tn/fp/fn, latency mean/p50/p95/max, throughput, `ncnn_threads`, `runtime`, `load_time_ms`, `total_duration_s`, `git_commit`, and the parity columns when `--parity` is used |
| `system.csv` | Sampled every `--sample-interval` seconds: `timestamp, cpu_percent, rss_mb, mem_available_mb, cpu_temp_c, throttled_hex, load_avg_1m` |

`summary.csv` rows from different devices, models and runtimes share the same
columns, so they concatenate directly for cross-device comparison.

`backend/eval_results/` is gitignored.

---

## 5. Shipping scripts and datasets to a device

### 5.1 Native devices (Pi 3B, Pi Zero 2 W)

```bash
# scripts + goldens (small)
ssh USER@HOST "mkdir -p ~/berth/backend/edge_eval ~/berth/backend/eval_results"
scp backend/edge_eval/eval_edge.py backend/edge_eval/edge_check.py backend/edge_eval/run_eval.sh USER@HOST:~/berth/backend/edge_eval/
scp backend/eval_results/goldens_*.json USER@HOST:~/berth/backend/eval_results/
ssh USER@HOST "chmod +x ~/berth/backend/edge_eval/run_eval.sh"

# datasets (one tarball, extracted into backend/data/)
scp eval_bundle.tar.gz USER@HOST:~/
ssh USER@HOST "tar -xzf ~/eval_bundle.tar.gz -C ~/berth/backend/data && rm ~/eval_bundle.tar.gz"
```

The full resync in
[deploy/edge/native/README.md](../../deploy/edge/native/README.md) also ships
`edge_eval/`.

No dataset is distributed with the repository, so `eval_bundle.tar.gz` is built on
the dev machine from whichever crop sets are being benchmarked, and it is
gitignored. Two kinds of set are worth shipping, and the commands throughout this
guide use them:

- A **cross-lot benchmark set**, written below as `data/<crop_set>/crops_classifier`.
  This is a lot the model was not trained on, which is what makes it a
  generalization test. Use `--parity eval_results/goldens_<model>.json` here,
  since golden filenames only match the set they were generated from.
- The **held-out test split of the training lot**, at `data/classify_split/test`.
  This one the backend builds automatically at training time. No parity applies.
  Use `--limit` on the Zero 2 W, since the full split runs to tens of thousands of
  crops.

If bash reports `bad interpreter` when running `run_eval.sh`, the file picked up
CRLF line endings in transit. Run `dos2unix edge_eval/run_eval.sh` on the device.

### 5.2 Pi 5 (Docker)

The image bakes `backend/` in at build time, so `edge_eval/eval_edge.py` is
already inside the container after a rebuild. Until then the scripts are
bind-mounted, and they must sit at the exact path the mount reads:

```bash
ssh USER@HOST "mkdir -p ~/berth/backend/edge_eval ~/berth/eval_data"
scp backend/edge_eval/eval_edge.py backend/edge_eval/edge_check.py USER@HOST:~/berth/backend/edge_eval/
scp backend/eval_results/goldens_*.json USER@HOST:~/berth/eval_data/
scp eval_bundle.tar.gz USER@HOST:~/berth/
ssh USER@HOST "cd ~/berth && tar -xzf eval_bundle.tar.gz -C eval_data && rm eval_bundle.tar.gz"
```

Datasets are then addressed inside the container as
`/app/eval_data/<crop_set>/crops_classifier` or
`/app/eval_data/classify_split/test`.

---

## 6. Running the evaluation

Stop the running service or container first on every device. The eval is a
latency measurement, and a live inference loop competing for the same cores makes
the numbers meaningless.

### 6.1 Pi 5 (Docker)

```bash
# 1. Stop the API container (frees the cores, compose run does not publish ports)
docker compose -f deploy/edge/docker/docker-compose.rpi.yml stop berth-rpi

# 2. Run the eval. The command override replaces the API entrypoint, no server starts
docker compose -f deploy/edge/docker/docker-compose.rpi.yml run --rm --no-deps \
  -v "$PWD/eval_data:/app/eval_data" \
  -v "$PWD/backend/edge_eval/eval_edge.py:/app/edge_eval/eval_edge.py" \
  -v "$PWD/backend/edge_eval/edge_check.py:/app/edge_eval/edge_check.py" \
  berth-rpi python edge_eval/eval_edge.py \
    --dataset /app/eval_data/<crop_set>/crops_classifier \
    --out /app/eval_data/results \
    --model yolo26m_classify --threads 3 --device rpi5

# 3. Restart the API
docker compose -f deploy/edge/docker/docker-compose.rpi.yml start berth-rpi
```

CSVs land in `./eval_data/results/` on the host. The two `-v` lines for the
scripts can be dropped once the image has been rebuilt with the current backend.

`vcgencmd` is not present in the container, so `throttled_hex` stays blank on
this path. Temperature still works via `/sys/class/thermal`.

### 6.2 Pi 3B (native, systemd)

```bash
cd ~/berth/backend
./edge_eval/run_eval.sh --dataset data/<crop_set>/crops_classifier --model yolo26n_classify --threads 3 --device rpi3b
```

`run_eval.sh` runs the eval with the venv python under `BERTH_DEPLOYMENT=edge` and
restarts the service on exit via a trap even if the eval crashes. Override the
service name with `BERTH_SERVICE=<name>`.

Smoke check (the service can stay running):

```bash
venv/bin/python edge_eval/edge_check.py
```

### 6.3 Pi Zero 2 W (native, systemd)

Same wrapper. The dataset must stay small here:

```bash
cd ~/berth/backend
./edge_eval/run_eval.sh --dataset data/<crop_set>/crops_classifier --model yolo26n_classify \
  --threads 3 --limit 250 --device rpizero2w
```

Use `yolo26n_classify` or `cnn_scratch` only, as the m-scale model is too heavy
for this board. Watch `mem_available_mb` in `system.csv`. If it approaches zero,
the run swapped and the latency numbers are void.

### 6.4 Development laptop (baseline)

Plug the machine in, select a high-performance power plan, and close heavy
applications. Note the CPU model alongside the results.

```powershell
# PowerShell, from backend\
venv\Scripts\python.exe edge_eval\eval_edge.py --dataset data\classify_split\test --model yolo26n_classify --runtime ncnn --threads 3 --limit 500 --device laptop
```

Run `pip show ncnn` first, because the training venv does not necessarily have it.
Install with `pip install ncnn` if missing. If the sampler columns (`cpu_percent`,
`rss_mb`) come out blank on Windows that is acceptable, since latency is the point
of the laptop baseline.

---

## 7. Parity check: PyTorch to NCNN drift

Confirms the NCNN export did not change the model's predictions.

1. On the hub or dev machine (needs torch), from `backend/`:

   ```bash
   python edge_eval/make_goldens.py --dataset data/<crop_set>/crops_classifier --model yolo26n_classify --limit 30
   # -> eval_results/goldens_yolo26n_classify.json
   ```

2. Copy the JSON to the device alongside the same dataset subset (section 5).

3. Add `--parity` to the eval command:

   ```bash
   ./edge_eval/run_eval.sh --dataset data/<crop_set>/crops_classifier --model yolo26n_classify \
     --threads 3 --device rpi3b --parity eval_results/goldens_yolo26n_classify.json
   ```

`summary.csv` gains `parity_n`, `parity_max_drift`, `parity_mean_drift` and
`parity_label_agreement`. Expect drift below roughly 0.02 and agreement 1.0.
Anything worse points at the NCNN export or a preprocessing mismatch, not at the
device.

Once on-device probabilities match the dev-side model, later runs can use a subset
purely for latency.

---

## 8. Collecting results

Pull the session directories back to the dev machine:

```bash
# native devices
scp -r USER@HOST:~/berth/backend/eval_results/<session_dir> backend/eval_results/

# Pi 5 Docker (results were written to the bind-mounted host dir)
scp -r USER@HOST:~/berth/eval_data/results/* backend/eval_results/rpi5/
```

On Windows, `scp -O` forces the legacy protocol that the Pi pull needs, and the
destination should use forward slashes so PowerShell does not mangle a trailing
backslash:

```powershell
scp -O -r USER@HOST:~/berth/backend/eval_results/* backend/eval_results/rpi5/
```

Keep one subdirectory per round (`rpi5/`, `rpi3b/`, `rpizero/`, `laptop/`) so the
`summary.csv` rows stay attributable after they are concatenated.

---

## 9. Reading the numbers

Check these before trusting a run:

- `throttled_hex` is `0x0` for the whole of `system.csv`. A non-zero value means
  the board thermal-throttled mid-run and the latency figures are suspect.
  Rerun after a cool-down.
- `mem_available_mb` never approaches zero. If it did, the run swapped to SD and
  the latency is measuring the card, not the model.
- `n_images` is what was intended (`--limit 500` on a two-class set gives 1000).
- `runtime` and `ncnn_threads` are what was intended. Comparing a 3-thread run
  against a 1-thread run is the easiest way to produce a wrong speedup figure.
- Rows being compared were produced with the same `--dataset` and the same
  `--limit`. Latency is model-bound rather than dataset-bound, but accuracy is
  not: the cross-lot set and the in-domain test split give very different
  accuracy for the same weights, and that gap is domain shift, not the device.

`load_time_ms` is a cold/warm-cache-sensitive number, not a stable property of
the model. It falls sharply on the second run of the same session because the
weights and the shared libraries are still in page cache. Do not compare it
across runs unless the caches were dropped between them.

---

## 10. PyTorch runtime, natively on the Pi 5

Run this last, and only when a torch-versus-NCNN comparison is required. It puts a
~1.5 GB wheel set on the board.

Scope: Pi 5 only. PyTorch is not attempted on the Pi 3B or the Zero 2 W, because
1 GB and 512 MB of RAM do not realistically hold the torch runtime alongside a
model.

The edge image stays torch-free (`backend/requirements.edge.txt`). This path builds
a throwaway venv on the Pi OS host instead.

### 10.1 Sync the code and the torch weights

This needs `backend/models` (the `.pth` / `.pt` torch weights), not
`backend/edge_models`. `scp` has no `--exclude`, so the code is named explicitly,
which skips `venv/`, `data/` and `eval_results/`.

```bash
ssh USER@HOST "mkdir -p ~/berth-torch/backend ~/berth-torch/eval_data"
scp -r backend/config.py backend/src backend/edge_eval USER@HOST:~/berth-torch/backend/
scp -r backend/models USER@HOST:~/berth-torch/backend/
scp -r backend/data/classify_split/test USER@HOST:~/berth-torch/eval_data/classify_split_test
```

Skipping `backend/models` here is the direct cause of
`YOLO26 classify weights not found at '.../backend/models/best_yolo26n_classify.pt'`
at load time.

### 10.2 Build the torch virtualenv

```bash
cd ~/berth-torch/backend
python3 -m venv venv-torch
venv-torch/bin/pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu
venv-torch/bin/pip install timm dotenv ultralytics numpy pillow
```

CPU wheels, roughly 1.5 GB, a one-time cost. Nothing compiles on the device on a
64-bit OS.

On a Pi OS **Lite** image this venv will fail at import with
`libGL.so.1: cannot open shared object file`. Ultralytics pulls in the full
`opencv-python`, which links against GUI libraries a Lite image does not carry.
Swap it for the headless build, matching `backend/requirements.edge.txt`:

```bash
venv-torch/bin/pip uninstall -y opencv-python
venv-torch/bin/pip install opencv-python-headless
```

Installing `libgl1 libglib2.0-0` with apt also clears the error.

### 10.3 Run

Stop the container first so the eval gets the full CPU and RAM budget, mirroring
how the NCNN round was measured, and restart it afterwards:

```bash
docker stop <berth-container-name>

cd ~/berth-torch/backend
venv-torch/bin/python edge_eval/eval_edge.py --dataset ~/berth-torch/eval_data/classify_split_test --model yolo26n_classify --runtime torch --threads 3 --limit 500 --device rpi5
venv-torch/bin/python edge_eval/eval_edge.py --dataset ~/berth-torch/eval_data/classify_split_test --model mobilenetv4s     --runtime torch --threads 3 --limit 500 --device rpi5
venv-torch/bin/python edge_eval/eval_edge.py --dataset ~/berth-torch/eval_data/classify_split_test --model cnn_scratch      --runtime torch --threads 3 --limit 500 --device rpi5
venv-torch/bin/python edge_eval/eval_edge.py --dataset ~/berth-torch/eval_data/classify_split_test --model resnet50         --runtime torch --threads 3 --limit 500 --device rpi5

docker start <berth-container-name>
```

`resnet50` is the slow one, on the order of a few minutes for 1000 crops. Watch
`system.csv` afterwards, since a non-zero `throttled_hex` voids that model's run.

**Thread count, already handled in the runner.**
`src/inference/torch_classifier.py` calls `torch.set_num_threads(1)` at module
import, so `eval_edge.py` re-applies `torch.set_num_threads(args.threads)` after
that import ([eval_edge.py:251-253](eval_edge.py#L251-L253)). Without it the
torch runs would be single-threaded against 3-thread NCNN runs and the comparison
would be meaningless. Any reworking of that branch must preserve the ordering.

### 10.4 Pair the runs against NCNN

A torch row is only comparable to an NCNN row measured on the **same crops with
the same flags**. Earlier NCNN sessions run on the full split cannot be paired
with a `--limit 500` torch run. Rerun NCNN with the matching flags:

```bash
./edge_eval/run_eval.sh --dataset data/classify_split/test --model yolo26n_classify \
  --runtime ncnn --threads 3 --limit 500 --device rpi5
```

Then pull both back per section 8, into separate subdirectories
(`rpi5_torch/`, `rpi5_rerun/`) so the pairing stays legible.

Accuracy must come out identical between the two runtimes for a given model. If
it does not, the export drifted and section 7 is where to look.
