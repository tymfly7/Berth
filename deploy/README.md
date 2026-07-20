# Deploying Berth

Berth is **one product** with several deployment **tiers**. The core — model, inference, and
detection pipeline — is identical everywhere and lives in [`backend/`](../backend/). Only the
packaging and runtime tuning change between tiers.

## Which tier do I want?

| Tier | Hardware | Start command | Notes |
|------|----------|---------------|-------|
| **[Dev](dev/)** | Any laptop | `python backend/main.py` | Fast local iteration, venv |
| **[Docker](docker/)** | x86 server / cloud | `docker compose up -d` | Reproducible, host port 9000 |
| **[Edge · Pi 5](edge/)** | RPi 5 (arm64) | `docker compose -f docker-compose.rpi.yml up -d` | Up to 4 cameras, NCNN |
| **[Edge · Zero 2 W (Docker)](edge/)** | RPi Zero 2 W, 512 MB | `docker compose -f docker-compose.zero.yml up -d` | Mem-capped 450 MB |
| **[Edge · Zero 2 W / 3B (native)](edge/native/)** | RPi Zero 2 W / 3B | `sudo deploy/edge/native/install.sh` | No Docker, systemd, lowest footprint |

## How this is organised

Each tier has a folder here with its own README. To keep this change low-risk, the existing
`Dockerfile*` and `docker-compose*.yml` **still live at the repo root** — the tier READMEs
point at them. The only files that physically live under `deploy/` are the **native edge**
artifacts (`edge/native/`), which had no home before.

- [`dev/`](dev/) — run it locally from source.
- [`docker/`](docker/) — standard x86/cloud container.
- [`edge/`](edge/) — Raspberry Pi, both Docker (Pi 5, Zero 2 W) and native (Zero 2 W, 3B).
