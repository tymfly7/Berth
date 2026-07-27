# Deploying Berth

Berth is **one product** with several deployment **tiers**. The core (model, inference, and
detection pipeline) is identical everywhere and lives in [`backend/`](../backend/). Only the
packaging and runtime tuning change between tiers.

## Which tier do I want?

| Tier | Hardware | Start command *(run from repo root)* | Notes |
|------|----------|---------------|-------|
| **[Dev](dev/)** | Any laptop | `python backend/main.py` | Fast local iteration, venv |
| **[Docker](docker/)** | x86 server / cloud | `docker compose -f deploy/docker/docker-compose.yml up -d` | Reproducible, host port 9000 |
| **[Edge · Pi 5 (Docker)](edge/docker/)** | RPi 5 (arm64) | `docker compose -f deploy/edge/docker/docker-compose.rpi.yml up -d` | Up to 4 cameras, NCNN |
| **[Edge · Zero 2 W / 3B (native)](edge/native/)** | RPi Zero 2 W / 3B | `sudo deploy/edge/native/install.sh` | No Docker, systemd, lowest footprint |

## How this is organised

Each tier has a folder here with its own README and its build files. Always run compose from
the **repo root**: the build context is the root (the Dockerfiles `COPY backend/` and
`frontend/`), and each compose file sets `build.context` back to the root accordingly.

- `.dockerignore` stays at the repo root (Docker reads it from the build-context root).
- `.env_edge` (local secrets, gitignored) stays at the repo root; edge compose reads it via
  `--env-file .env_edge`.

- [`dev/`](dev/): run it locally from source.
- [`docker/`](docker/): standard x86/cloud container.
- [`edge/docker/`](edge/docker/): Raspberry Pi 5, containerised.
- [`edge/native/`](edge/native/): Raspberry Pi Zero 2 W / 3B, systemd, no Docker.
