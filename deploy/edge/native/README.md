# Berth on Raspberry Pi — native (Docker-free) deployment

Native deployment of the Berth edge backend on the low-RAM boards — **Pi Zero 2 W**
(512 MB, 4× Cortex-A53) and **Pi 3B** (1 GB, 4× Cortex-A53). Docker (`Dockerfile.rpi`) stays
the path for the Pi 5; on the small boards the Docker daemon alone costs 100–150 MB, so the
backend runs directly under **systemd** instead.

The recurring theme on this hardware: **the failure mode is not a crash, it is a freeze.** When
RAM runs out and the box swaps to SD card, the symptom is "no logs, SSH dead, UI gone" —
indistinguishable from a hang. Every step below exists to convert that silent freeze into a
loud, recoverable service restart.

Throughout: user is `edge`, host is `192.168.0.27` (the Zero 2 W), project lives in `~/berth`,
backend listens on port `8001`. Adjust to taste; the 3B follows the same procedure with the
deltas in [Pi 3B profile](#pi-3b-profile).

---

## Files here

| File | What it is |
|------|------------|
| `install.sh` | Idempotent installer — scripts setup steps 1–5 below. Run it on the Pi. |
| `berth.service` | The systemd unit (Zero 2 W profile). `install.sh` copies it to `/etc/systemd/system/`. |
| `README.md` | This guide. |

## Quick start

```bash
# 1. From the dev machine: transfer the code (see "Transfer the code" below)
#    and ship this native/ folder to the Pi.

# 2. On the Pi, as user `edge`:
cd ~/berth/deploy/edge/native      # wherever you dropped this folder
chmod +x install.sh
./install.sh                       # runs steps 1-3, then asks for a reboot
sudo reboot
./install.sh                       # re-run: finishes venv + service install

# 3. Audit cameras.json (see the installer's closing note), then:
sudo systemctl start berth.service
journalctl -u berth -f
```

> If bash reports `bad interpreter` / `\r`, the script picked up CRLF line endings on
> Windows — run `dos2unix install.sh` on the Pi first.

The rest of this document is the **reference** for what `install.sh` automates, plus the parts
that stay manual (code transfer, updates, recovery).

---

## 1. Lean OS image

Flash **Raspberry Pi OS Lite, 64-bit (Bookworm)**. Lite has no desktop and idles ~120 MB.
64-bit matters: every wheel in `requirements.edge.txt` (ncnn, numpy, opencv-python-headless)
ships prebuilt `aarch64` wheels — nothing compiles on the device. In the Imager's advanced
settings, preconfigure hostname, the `edge` user, Wi-Fi, and SSH for a headless first boot.

`install.sh` step [1/5] then: updates the OS; installs `python3-venv python3-pip libgl1
libglib2.0-0`; sets `gpu_mem=16` + `dtoverlay=disable-bt` in `/boot/firmware/config.txt`;
disables `bluetooth triggerhappy ModemManager`; and sets journald `Storage=volatile` (logs
live in RAM — they don't survive a reboot, which is fine here and stops steady SD writes).

Do not install a desktop, Docker, or anything else — every resident megabyte comes out of the
model/stream budget.

## 2. zram swap + earlyoom

SD-card swap is what freezes the box. zram (compressed swap in RAM, ~3–4× with zstd) plus
earlyoom (kills the biggest process *before* the kernel livelocks) replaces it. `install.sh`
step [2/5]: removes the stock `dphys-swapfile`, installs `zram-tools earlyoom`, writes
`ALGO=zstd`/`PERCENT=60`, sets `vm.swappiness=100` + `vm.page-cluster=0`, and enables both
services.

> **Gotcha:** if `zramswap.service` fails with `mkswap: /dev/zram0 is mounted` or `Device or
> resource busy`, another mechanism claimed the device — a reboot resolves it. After reboot,
> `swapon --show` must list **only** `/dev/zram0` (no `/var/swap`).

## 3. Enable the memory cgroup controller

**Raspberry Pi OS disables the kernel memory cgroup by default** — the firmware injects
`cgroup_disable=memory`. Without this, the unit's `MemoryHigh=`/`MemoryMax=` are **silently
ignored** and `systemctl show berth -p MemoryCurrent` returns `[not set]`.

`install.sh` step [3/5] appends `cgroup_enable=memory cgroup_memory=1` to
`/boot/firmware/cmdline.txt`.

> **Critical:** `cmdline.txt` is a **single line**. The installer appends to the end of line 1;
> never add a newline. After the reboot, verify:
> ```bash
> grep cgroup /proc/cmdline     # must contain cgroup_enable=memory
> grep memory /proc/cgroups     # last column 1 = enabled
> ```

Accounting overhead is ~1–2 % of RAM — worth it: a runaway backend is killed at its cap and
restarted by systemd instead of dragging the box into a swap freeze.

**zram and the cgroup both need a reboot** — that is why `install.sh` stops after step 3 and
asks you to reboot, then finishes on the second run.

## 4. Install the backend

### Transfer the code (from the dev machine)

`rsync` isn't in Git Bash on Windows; use tar-over-ssh from the project root. Exclude
everything heavy or machine-specific:

```bash
tar -czf - \
  --exclude='backend/data' --exclude='backend/venv' --exclude='backend/models' \
  --exclude='backend/outputs' --exclude='backend/uploads' --exclude='__pycache__' \
  --exclude='backend/berth.db*' --exclude='backend/*.pt' --exclude='backend/.env' \
  --exclude='backend/eval_results' --exclude='backend/.pytest_cache' \
  --exclude='backend/.ruff_cache' --exclude='backend/.vscode' \
  backend | ssh edge@192.168.0.27 'mkdir -p ~/berth && tar -xzf - -C ~/berth'
```

This includes `backend/configs/` on purpose — a first deploy needs the config skeleton. For
**updates**, use the section-7 commands instead (they preserve the device's camera config).

Also ship this native folder so `install.sh` + `berth.service` are on the Pi, e.g.:
```bash
tar -czf - deploy/edge/native | ssh edge@192.168.0.27 'mkdir -p ~/berth && tar -xzf - -C ~/berth'
```

The ncnn models must be present as `backend/edge_models/*_ncnn_model/` directories (each with
`model.ncnn.param` + `model.ncnn.bin`).

### Python environment + smoke test

`install.sh` steps [4/5]–[5/5] create `~/berth/venv` and `pip install -r
backend/requirements.edge.txt` (all prebuilt aarch64 wheels — slow on SD, one-time). To smoke
test in the foreground before enabling the service:

```bash
cd ~/berth/backend
BERTH_DEPLOYMENT=edge BERTH_MODEL=cnn_scratch BERTH_INFERENCE_WORKERS=1 \
  ~/berth/venv/bin/python main.py
```

Expect: SQLite ready → InferencePool (1 worker) → ncnn model loaded → Uvicorn on
`0.0.0.0:8001`. Check: `curl http://192.168.0.27:8001/api/health`.

> **Before first start, audit `backend/configs/cameras.json`.** A camera carried over from dev
> with `"active": true` starts decoding at boot — a 1080p stream can eat all RAM before you can
> log in. Set every camera `"active": false` for first boot, and `"data_gathering": false`
> unless you want the Zero writing training crops to SD on every inference pass.

## 5. The systemd unit

`install.sh` copies [`berth.service`](berth.service) to `/etc/systemd/system/`. Why each knob
matters (the "shrink the workload" + "process diet" layer):

| Setting | Why |
|---|---|
| `BERTH_INFERENCE_WORKERS=1` | Default pool is `min(cores−1, 4)` = 3; one worker fits the budget. |
| `BERTH_MAX_ACTIVE_CAMERAS=1` | Edge default is 2; a second decode loop kills a 512 MB box. Over-activation becomes a clean API refusal. |
| `BERTH_MAX_STREAM_HEIGHT=480` | Caps the YouTube rendition yt-dlp picks. 1080p decode is the #1 OOM cause. |
| `BERTH_MAX_FRAME_HEIGHT=480` | Downscales *every* source at ingest. A 3200×1800 upload is ~17 MB/frame; 480p is ~1.2 MB. |
| `BERTH_SNAPSHOT_INTERVAL=15` | Snapshot mode: one frame every 15 s instead of continuous decode. `0`/unset = continuous. The single biggest CPU lever on this hardware. |
| `MALLOC_ARENA_MAX=2` | glibc otherwise makes up to 8×cores malloc arenas — a notorious RSS inflator for Python servers. |
| `MemoryHigh=320M` | Reclaim threshold. Idle RSS is ~294 MB; setting this below the real footprint makes the kernel reclaim in a permanent loop. |
| `MemoryMax=380M` + `OOMPolicy=kill` | Hard kill line. 463 MB total − ~80 MB base leaves ~380 MB. |
| `MemorySwapMax=64M` | `MemoryHigh/Max` cap RAM only. Without this, an over-cap process spills unlimited pages into zram and thrashes instead of dying. This makes the kill actually fire. |

Three more slimming measures are built into the code (no unit knobs needed): the FastAPI
sync-endpoint threadpool is capped at 8 threads, each per-thread SQLite connection's page cache
is 256 KB (not 2 MB), and yt-dlp resolves stream URLs in a subprocess instead of pinning
~50–80 MB as an in-process import. Result: worst case is a dying *service* (auto-restarted in
10 s), never a dying *box*.

## Pi 3B profile

The 3B runs the same install (sections 1–4) with relaxed caps and its own model. Edit
`berth.service` before installing:

```ini
MemoryHigh=580M
MemoryMax=620M
MemorySwapMax=200M
```

And its `.env` (regenerate secrets rather than hunt for the live values):

```
BERTH_DEPLOYMENT=edge
BERTH_MODEL=yolo26n_classify
BERTH_NCNN_THREADS=1
BERTH_AUTH_TTL=315360000
BERTH_API_KEY=<regenerate>
BERTH_ADMIN_PASSWORD=<regenerate>
BERTH_AUTH_SECRET=<regenerate>
```

The 3B runs `yolo26n_classify` (the Zero's unit uses `cnn_scratch`). Same 4× Cortex-A53 CPU as
the Zero, so every CPU lever (snapshot mode above all) matters just as much; only the memory
pressure is softer. `BERTH_INFERENCE_WORKERS=2` is affordable on 1 GB if needed, but start with
the Zero's conservative values.

## 6. Updating a deployed device

### 6a. Small update — scp the changed files

```bash
scp backend/config.py edge@192.168.0.27:~/berth/backend/config.py
scp backend/src/inference/video_processor.py edge@192.168.0.27:~/berth/backend/src/inference/video_processor.py
ssh edge@192.168.0.27 'sudo systemctl restart berth'
```

`scp` overwrites exactly those files; everything else stays byte-for-byte.

### 6b. Full resync — delete-then-extract

Neither `scp` nor tar ever *deletes* on the device, so files removed from the repo linger as
orphans. Wipe the code dirs first, then extract (this keeps `venv`, `edge_models`, `configs/`,
`berth.db`, `uploads/`, `outputs/` — the device's live state):

```bash
ssh edge@192.168.0.27 'sudo systemctl stop berth && rm -rf ~/berth/backend/src ~/berth/backend/tests ~/berth/backend/edge_eval'

tar -czf - \
  --exclude='backend/data' --exclude='backend/venv' --exclude='backend/models' \
  --exclude='backend/outputs' --exclude='backend/uploads' --exclude='__pycache__' \
  --exclude='backend/berth.db*' --exclude='backend/*.pt' --exclude='backend/.env' \
  --exclude='backend/configs' --exclude='backend/cameras.json' \
  --exclude='backend/eval_results' --exclude='backend/.pytest_cache' \
  --exclude='backend/.ruff_cache' --exclude='backend/.vscode' \
  backend | ssh edge@192.168.0.27 'tar -xzf - -C ~/berth'

ssh edge@192.168.0.27 'sudo systemctl restart berth && journalctl -u berth -n 50 -f'
```

This *includes* `backend/edge_models/` deliberately — re-shipping the ncnn exports keeps the
device in sync. No pip reinstall unless `requirements.edge.txt` changed.

## 7. Reading memory reports

```bash
systemctl show berth -p MemoryCurrent          # needs the cgroup step, else "[not set]"
cat /sys/fs/cgroup/system.slice/berth.service/memory.current
cat /sys/fs/cgroup/system.slice/berth.service/memory.peak
cat /sys/fs/cgroup/system.slice/berth.service/memory.swap.current
```

(`memory.peak` resets on restart. `systemctl show -p MemoryPeak` needs systemd ≥ 254; Bookworm
has 252 — read the cgroup file.) Whole-box view: `free -h` (watch Swap), `top` (a busy
`kswapd0` = thrashing), `systemd-cgtop`. Interpreting on the Zero:

- **~294 MiB idle** is normal — the import weight of the full aarch64 stack before any camera.
- `memory.current` pinned at `MemoryHigh` = perpetual reclaim; raise the cap or shrink work.
- `memory.swap.current` pinned at `MemorySwapMax` = over budget, one allocation from the kill.

## 8. Recovery: the box is frozen / SSH is dead

1. Power-cycle. Nothing else works once SD-swap thrash sets in.
2. The service auto-starts and may re-enter the same state. From another machine, repeat until
   it lands (the app needs ~15 s to load models — your window):
   ```bash
   ssh edge@192.168.0.27 'sudo systemctl stop berth.service'
   ```
3. Defuse the trigger — usually a camera in `configs/cameras.json` with `"active": true` (video
   uploads auto-register *and auto-activate* as `file` cameras).
4. `sudo systemctl start berth.service` and watch `journalctl -u berth -f`.

## 9. Optional: serve the web UI from the device

`main.py` only mounts static files when `static/assets/` exists. Build on the dev machine and
ship only `dist/`:

```bash
cd frontend && npm run build
tar -czf - -C dist . | ssh edge@192.168.0.27 'mkdir -p ~/berth/backend/static && tar -xzf - -C ~/berth/backend/static'
```

Restart the service; the UI is then at `http://192.168.0.27:8001/`. Serving pre-built static
files costs almost nothing at runtime. (Same-origin from the device: no `VITE_API_BASE`, no CORS.)

## 10. If it still doesn't fit: escalation levers, in order

1. Camera/source diet (the env knobs above) — biggest wins, no code.
2. Snapshot mode (`BERTH_SNAPSHOT_INTERVAL`) — done; the biggest CPU lever here.
3. yt-dlp resolve in a subprocess — done; now always how the resolver works.
4. Lazy one-model-at-a-time loading (evict the previous classifier on switch).
5. ncnn `num_threads=2` in the two ncnn wrappers — trades latency for scheduler headroom.
6. int8-quantized ncnn export — smaller weights and activations.
7. Last resort: a C++ ncnn worker process; Python keeps only the API.

---

*Source: consolidated from `log_pi_zero_setup.md` (native deployment sections). The edge
**evaluation** pipeline — `backend/edge_eval/`, parity checks, per-device result logs — is a
separate concern documented in that log, not here.*
