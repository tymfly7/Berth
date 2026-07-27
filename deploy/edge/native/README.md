# Berth on Raspberry Pi: native (Docker-free) deployment

Native deployment of the Berth edge backend on the low-RAM boards: **Pi Zero 2 W**
(512 MB, 4× Cortex-A53) and **Pi 3B** (1 GB, 4× Cortex-A53). [Docker](../docker/) stays the
path for the Pi 5; on the small boards the Docker daemon alone costs 100–150 MB, so the
backend runs directly under **systemd** instead.

On this hardware the failure mode is usually a freeze rather than a crash. When RAM runs out
and the box swaps to SD card, the symptom is "no logs, SSH dead, UI gone", which is hard to
tell from a hang. The steps below aim to turn that freeze into a recoverable service restart.

Throughout: user is `edge`, host is `IP` (the Zero 2 W), project lives in `~/berth`,
backend listens on port `8001`. Adjust to taste; the 3B follows the same procedure with the
deltas in [Pi 3B profile](#pi-3b-profile).

---

## Files here

| File | What it is |
|------|------------|
| `install.sh` | Idempotent installer that scripts setup steps 1–5 below. Run it on the Pi. |
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
> Windows: run `dos2unix install.sh` on the Pi first.

The rest of this document is the **reference** for what `install.sh` automates, plus the parts
that stay manual (code transfer, updates, recovery).

---

## 1. Lean OS image

Flash **Raspberry Pi OS Lite, 64-bit (Bookworm)**. Lite has no desktop and idles ~120 MB.
64-bit matters: every wheel in `requirements.edge.txt` (ncnn, numpy, opencv-python-headless)
ships prebuilt `aarch64` wheels, so nothing compiles on the device. In the Imager's advanced
settings, preconfigure hostname, the `edge` user, Wi-Fi, and SSH for a headless first boot.

`install.sh` step [1/5] then: updates the OS; installs `python3-venv python3-pip libgl1
libglib2.0-0`; sets `gpu_mem=16` + `dtoverlay=disable-bt` in `/boot/firmware/config.txt`;
disables `bluetooth triggerhappy ModemManager`; and sets journald `Storage=volatile` (logs
live in RAM, so they don't survive a reboot, which is fine here and stops steady SD writes).

Do not install a desktop, Docker, or anything else: every resident megabyte comes out of the
model/stream budget.

## 2. zram swap + earlyoom

SD-card swap is what freezes the box. zram (compressed swap in RAM, ~3–4× with zstd) plus
earlyoom (kills the biggest process *before* the kernel livelocks) replaces it. `install.sh`
step [2/5]: removes the stock `dphys-swapfile`, installs `zram-tools earlyoom`, writes
`ALGO=zstd`/`PERCENT=60`, sets `vm.swappiness=100` + `vm.page-cluster=0`, and enables both
services.

> **Gotcha:** if `zramswap.service` fails with `mkswap: /dev/zram0 is mounted` or `Device or
> resource busy`, another mechanism claimed the device, and a reboot resolves it. After reboot,
> `swapon --show` must list **only** `/dev/zram0` (no `/var/swap`).

## 3. Enable the memory cgroup controller

**Raspberry Pi OS disables the kernel memory cgroup by default**: the firmware injects
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

Accounting overhead is ~1–2 % of RAM. In exchange, a runaway backend is killed at its cap and
restarted by systemd instead of dragging the box into a swap freeze.

**zram and the cgroup both need a reboot**, which is why `install.sh` stops after step 3 and
asks you to reboot, then finishes on the second run.

## 4. Install the backend

### Transfer the code (from the dev machine)

`rsync` isn't in Git Bash on Windows; use tar-over-ssh from the project root. Exclude
everything heavy or machine-specific. Throughout this guide, replace `USER@HOST` with your
Pi's `user@ip` (e.g. `pi@raspberrypi.local`) and `HOST` with its IP or hostname.

**Every block in this guide is bash** — run them in Git Bash, WSL, macOS, or Linux. They fail in
Windows PowerShell for two independent reasons: the trailing `\` is a bash line continuation
PowerShell does not support (it parses each line as its own command, reporting `USER@HOST : The
term 'USER@HOST' is not recognized as the name of a cmdlet`), and `tar -czf - | ssh` pipes
*binary* gzip, which PowerShell re-encodes as text between processes and corrupts. See
[From PowerShell](#from-powershell) for the equivalent.

```bash
tar -czf - \
  --exclude='backend/data' --exclude='backend/venv' --exclude='backend/models' \
  --exclude='backend/outputs' --exclude='backend/uploads' --exclude='__pycache__' \
  --exclude='backend/berth.db*' --exclude='backend/*.pt' --exclude='backend/.env' \
  --exclude='backend/eval_results' --exclude='backend/.pytest_cache' \
  --exclude='backend/.ruff_cache' --exclude='backend/.vscode' \
  backend | ssh USER@HOST 'mkdir -p ~/berth && tar -xzf - -C ~/berth'
```

This includes `backend/configs/` on purpose, since a first deploy needs the config skeleton. For
**updates**, use the section-7 commands instead (they preserve the device's camera config).

Also ship this native folder so `install.sh` + `berth.service` are on the Pi, e.g.:
```bash
tar -czf - deploy/edge/native | ssh USER@HOST 'mkdir -p ~/berth && tar -xzf - -C ~/berth'
```

The ncnn models must be present as `backend/edge_models/*_ncnn_model/` directories (each with
`model.ncnn.param` + `model.ncnn.bin`).

#### From PowerShell

Stage the archive to a file instead of piping it, and keep every exclude on the one line. Windows
ships `tar.exe` (bsdtar) since Windows 10, so nothing needs installing. **Run these one at a
time** — pasted as a block they can merge into a single line, and `backend` fuses onto the next
command as `backendscp`, which surfaces as a row of `tar.exe: : Couldn't visit directory` errors:

```powershell
# 1. Build the archive (project root)
tar -czf berth-code.tar.gz --exclude=backend/data --exclude=backend/venv --exclude=backend/models --exclude=backend/outputs --exclude=backend/uploads --exclude=__pycache__ --exclude=backend/berth.db* --exclude=backend/*.pt --exclude=backend/.env --exclude=backend/eval_results --exclude=backend/.pytest_cache --exclude=backend/.ruff_cache --exclude=backend/.vscode backend

# 2. Check it before shipping — a failed run still leaves a partial file behind
(Get-Item berth-code.tar.gz).Length / 1MB
tar -tzf berth-code.tar.gz | Select-Object -First 5      # entries should start with backend/

# 3. Ship and extract
scp berth-code.tar.gz USER@HOST:~/
ssh USER@HOST 'mkdir -p ~/berth && tar -xzf ~/berth-code.tar.gz -C ~/berth && rm ~/berth-code.tar.gz'

# 4. Clean up locally
Remove-Item berth-code.tar.gz
```

Same pattern for the native folder:

```powershell
tar -czf native.tar.gz deploy/edge/native
scp native.tar.gz USER@HOST:~/
ssh USER@HOST 'mkdir -p ~/berth && tar -xzf ~/native.tar.gz -C ~/berth && rm ~/native.tar.gz'
Remove-Item native.tar.gz
```

Plain `scp` and `ssh` invocations work unchanged in PowerShell; only the `tar … | ssh` pipes need
this treatment. The excludes are unquoted on purpose — PowerShell does not glob-expand arguments,
so `--exclude=backend/*.pt` reaches `tar` intact.

### Secrets: the `.env` file

**Required on every native device, Zero 2 W and 3B alike.** The transfer above excludes
`backend/.env` deliberately and [`berth.service`](berth.service) carries only tuning knobs, so a
freshly deployed Pi has no credentials at all. `config.py` calls `load_dotenv()`, which searches
upward from `backend/`, so the file belongs at `~/berth/backend/.env` and is created **on the
device**:

```bash
ssh USER@HOST
cd ~/berth/backend
cat > .env <<EOF
BERTH_ADMIN_PASSWORD=choose-a-real-password
BERTH_API_KEY=$(openssl rand -hex 32)
BERTH_AUTH_SECRET=$(openssl rand -hex 32)
EOF
chmod 600 .env
```

| Var | If unset |
|-----|----------|
| `BERTH_ADMIN_PASSWORD` | `/api/auth/login` returns **503** and the admin UI cannot be used at all. |
| `BERTH_API_KEY` | Every protected endpoint is publicly accessible. `main.py` warns at startup. |
| `BERTH_AUTH_SECRET` | A random signing key is generated per process, so every restart invalidates issued tokens. |

Write values bare — `BERTH_ADMIN_PASSWORD=secret`, **not** `="secret"`; the quotes become part of
the value and show up later as a 401 on a password that looks correct.

`load_dotenv()` never overrides a variable already in the environment, so anything on the unit's
`Environment=` line wins over `.env`. Keep the two sets disjoint: tuning in the unit, secrets in
`.env`. After editing `.env`, `sudo systemctl restart berth` is enough — unlike Docker, where env
is frozen at container creation. Verify:

```bash
curl -i -X POST http://HOST:8001/api/auth/login \
  -H 'Content-Type: application/json' -d '{"password":"choose-a-real-password"}'
```

`503` = the file was not read; `401` = read but mismatched; `200` with a JSON `token` = working.

### Python environment + smoke test

`install.sh` steps [4/5]–[5/5] create `~/berth/venv` and `pip install -r
backend/requirements.edge.txt` (all prebuilt aarch64 wheels, slow on SD, one-time). To smoke
test in the foreground before enabling the service:

```bash
cd ~/berth/backend
BERTH_DEPLOYMENT=edge BERTH_MODEL=cnn_scratch BERTH_INFERENCE_WORKERS=1 \
  ~/berth/venv/bin/python main.py
```

Expect: SQLite ready → InferencePool (1 worker) → ncnn model loaded → Uvicorn on
`0.0.0.0:8001`. Check: `curl http://HOST:8001/api/health`.

> **Before first start, audit `backend/configs/cameras.json`.** A camera carried over from dev
> with `"active": true` starts decoding at boot, and a 1080p stream can eat all RAM before you
> can log in. Set every camera `"active": false` for first boot, and `"data_gathering": false`
> unless you want the Zero writing training crops to SD on every inference pass.

## 5. The systemd unit

`install.sh` copies [`berth.service`](berth.service) to `/etc/systemd/system/`. Why each knob
matters:

| Setting | Why |
|---|---|
| `BERTH_INFERENCE_WORKERS=1` | Default pool is `min(cores−1, 4)` = 3; one worker fits the budget. |
| `BERTH_MAX_ACTIVE_CAMERAS=1` | Edge default is 2; a second decode loop kills a 512 MB box. Over-activation becomes a clean API refusal. |
| `BERTH_MAX_STREAM_HEIGHT=480` | Caps the YouTube rendition yt-dlp picks. 1080p decode is the #1 OOM cause. |
| `BERTH_MAX_FRAME_HEIGHT=480` | Downscales *every* source at ingest. A 3200×1800 upload is ~17 MB/frame; 480p is ~1.2 MB. |
| `BERTH_SNAPSHOT_INTERVAL=15` | Snapshot mode: one frame every 15 s instead of continuous decode. `0`/unset = continuous. The single biggest CPU lever on this hardware. |
| `MALLOC_ARENA_MAX=2` | glibc otherwise makes up to 8×cores malloc arenas, a notorious RSS inflator for Python servers. |
| `MemoryHigh=340M` | Reclaim threshold. Idle RSS is ~294 MB; setting this below the real footprint makes the kernel reclaim in a permanent loop. |
| `MemoryMax=420M` + `OOMPolicy=kill` | Hard kill line. 463 MB total − ~80 MB base leaves ~380 MB. |
| `MemorySwapMax=200M` | `MemoryHigh/Max` cap RAM only. Without this, an over-cap process spills unlimited pages into zram and thrashes instead of dying. This makes the kill actually fire. |

Three more slimming measures are built into the code (no unit knobs needed): the FastAPI
sync-endpoint threadpool is capped at 8 threads, each per-thread SQLite connection's page cache
is 256 KB (not 2 MB), and yt-dlp resolves stream URLs in a subprocess instead of pinning
~50–80 MB as an in-process import. The worst case is then a dying service (auto-restarted in
10 s) rather than a dying box.

## Pi 3B profile

The 3B runs the same install (sections 1–4) with relaxed caps and its own model. Edit
`berth.service` before installing:

```ini
MemoryHigh=580M
MemoryMax=620M
MemorySwapMax=200M
```

And its `.env` — same file and location as [Secrets](#secrets-the-env-file), with two extra
model-specific lines (regenerate secrets rather than hunt for the live values):

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

### 6a. Small update: scp the changed files

```bash
scp backend/config.py USER@HOST:~/berth/backend/config.py
scp backend/src/inference/video_processor.py USER@HOST:~/berth/backend/src/inference/video_processor.py
ssh USER@HOST 'sudo systemctl restart berth'
```

`scp` overwrites exactly those files; everything else stays byte-for-byte.

### 6b. Full resync: delete-then-extract

Neither `scp` nor tar ever *deletes* on the device, so files removed from the repo linger as
orphans. Wipe the code dirs first, then extract (this keeps `venv`, `edge_models`, `configs/`,
`berth.db`, `uploads/`, `outputs/`, the device's live state):

```bash
ssh USER@HOST 'sudo systemctl stop berth && rm -rf ~/berth/backend/src ~/berth/backend/tests ~/berth/backend/edge_eval'

tar -czf - \
  --exclude='backend/data' --exclude='backend/venv' --exclude='backend/models' \
  --exclude='backend/outputs' --exclude='backend/uploads' --exclude='__pycache__' \
  --exclude='backend/berth.db*' --exclude='backend/*.pt' --exclude='backend/.env' \
  --exclude='backend/configs' --exclude='backend/cameras.json' \
  --exclude='backend/eval_results' --exclude='backend/.pytest_cache' \
  --exclude='backend/.ruff_cache' --exclude='backend/.vscode' \
  backend | ssh USER@HOST 'tar -xzf - -C ~/berth'

ssh USER@HOST 'sudo systemctl restart berth && journalctl -u berth -n 50 -f'
```

This *includes* `backend/edge_models/` deliberately: re-shipping the ncnn exports keeps the
device in sync. No pip reinstall unless `requirements.edge.txt` changed.

From PowerShell, use the staged-file form from [From PowerShell](#from-powershell) with the two
extra excludes above (`--exclude=backend/configs --exclude=backend/cameras.json`), and extract
with `tar -xzf ~/berth-code.tar.gz -C ~/berth` — no `mkdir`, the tree already exists.

## 7. Reading memory reports

```bash
systemctl show berth -p MemoryCurrent          # needs the cgroup step, else "[not set]"
cat /sys/fs/cgroup/system.slice/berth.service/memory.current
cat /sys/fs/cgroup/system.slice/berth.service/memory.peak
cat /sys/fs/cgroup/system.slice/berth.service/memory.swap.current
```

(`memory.peak` resets on restart. `systemctl show -p MemoryPeak` needs systemd ≥ 254; Bookworm
has 252, so read the cgroup file.) Whole-box view: `free -h` (watch Swap), `top` (a busy
`kswapd0` = thrashing), `systemd-cgtop`. Interpreting on the Zero:

- **~294 MiB idle** is normal: the import weight of the full aarch64 stack before any camera.
- `memory.current` pinned at `MemoryHigh` = perpetual reclaim; raise the cap or shrink work.
- `memory.swap.current` pinned at `MemorySwapMax` = over budget, one allocation from the kill.

## 8. Recovery: the box is frozen / SSH is dead

1. Power-cycle. Nothing else works once SD-swap thrash sets in.
2. The service auto-starts and may re-enter the same state. From another machine, repeat until
   it lands (the app needs ~15 s to load models, your window):
   ```bash
   ssh USER@HOST 'sudo systemctl stop berth.service'
   ```
3. Defuse the trigger - usually a camera in `configs/cameras.json` with `"active": true` (video
   uploads auto-register *and auto-activate* as `file` cameras).
4. `sudo systemctl start berth.service` and watch `journalctl -u berth -f`.

## 9. Optional: serve the web UI from the device

`main.py` only mounts static files when `static/assets/` exists. Build on the dev machine and
ship only `dist/`:

```bash
cd frontend && npm run build
tar -czf - -C dist . | ssh USER@HOST 'mkdir -p ~/berth/backend/static && tar -xzf - -C ~/berth/backend/static'
```

From PowerShell:

```powershell
cd frontend
npm run build
tar -czf dist.tar.gz -C dist .
scp dist.tar.gz USER@HOST:~/
ssh USER@HOST 'mkdir -p ~/berth/backend/static && tar -xzf ~/dist.tar.gz -C ~/berth/backend/static && rm ~/dist.tar.gz'
Remove-Item dist.tar.gz
```

Restart the service; the UI is then at `http://HOST:8001/`. Serving pre-built static
files costs almost nothing at runtime. (Same-origin from the device: no `VITE_API_BASE`, no CORS.)


