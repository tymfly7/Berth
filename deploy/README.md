# Deploying Berth

Berth is **one product** with several deployment **tiers**. The core (model, inference, and
detection pipeline) is identical everywhere and lives in [`backend/`](../backend/). Only the
packaging and runtime tuning change between tiers.

## Which tier do I want?

| Tier | Hardware | How you deploy it | Docs |
|------|----------|-------------------|------|
| **[Dev](dev/)** | Any laptop | `python backend/main.py` from a checkout | [dev/](dev/) |
| **[Docker](docker/)** | x86 server / cloud | `docker compose -f deploy/docker/docker-compose.yml up -d` from repo root | [docker/](docker/) |
| **[Edge · Pi 5 (Docker)](edge/docker/)** | RPi 5 (arm64) | build image on dev → ship tarball + compose to the Pi → run there | [edge/docker/](edge/docker/) |
| **[Edge · Zero 2 W / 3B (native)](edge/native/)** | RPi Zero 2 W / 3B | `sudo install.sh` on the Pi, systemd | [edge/native/](edge/native/) |

## How this is organised

The core lives in [`backend/`](../backend/); each tier just packages it. There are two
deployment shapes:

**Built and run on one machine, from a repo checkout** — the **Dev** and **x86 Docker** tiers.
Run compose from the **repo root**: the build context is the root (the Dockerfiles `COPY
backend/` and `frontend/`), and each compose file sets `build.context` back to it.
`.dockerignore` and `.env_edge` (local secrets, gitignored) stay at the repo root; a checkout
build reads secrets via `--env-file .env_edge` or a root `.env`.

**Built here, shipped as an image** — the **Edge Pi 5** tier. The Pi gets **no repo checkout**.
On the dev machine, build the arm64 image, `docker save` it to
`deploy/edge/docker/berth-rpi.tar.gz`, and copy just that tarball + `docker-compose.rpi.yml` to
`~/berth/` on the Pi; create the `.env` there. Then `docker load` and
`docker compose -f docker-compose.rpi.yml up -d` **from `~/berth/`**. Full walkthrough (cameras,
secrets, port 8001, verification) in [`edge/docker/README.md`](edge/docker/README.md).

**No Docker at all** — the **Edge Zero 2 W / 3B native** tier: ship the code, run `install.sh`,
serve under systemd. See [`edge/native/README.md`](edge/native/README.md).
