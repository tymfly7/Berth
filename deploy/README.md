# Deploying Berth

Berth is one product with several deployment tiers. The core (model, inference, and
detection pipeline) is identical everywhere and lives in [`backend/`](../backend/). Only the
packaging and runtime tuning change between tiers.

## Which tier applies?

| Tier | Hardware | Deployment command | Docs |
|------|----------|-------------------|------|
| **[Dev](dev/)** | Any laptop | `python backend/main.py` from a checkout | [dev/](dev/) |
| **[Docker](docker/)** | x86 server / cloud | `docker compose -f deploy/docker/docker-compose.yml up -d` from repo root | [docker/](docker/) |
| **[Edge · Pi 5 (Docker)](edge/docker/)** | RPi 5 (arm64) | build image on dev → ship tarball + compose to the Pi → run there | [edge/docker/](edge/docker/) |
| **[Edge · Zero 2 W / 3B (native)](edge/native/)** | RPi Zero 2 W / 3B | `sudo install.sh` on the Pi, systemd | [edge/native/](edge/native/) |

## How this is organized

The core lives in [`backend/`](../backend/) and each tier packages it. There are two
deployment shapes.

**Built and run on one machine, from a repo checkout.** This covers the Dev and x86 Docker
tiers. Run compose from the repo root. The build context is the root, because the Dockerfiles
`COPY backend/` and `frontend/`, and each compose file sets `build.context` back to it.
`.dockerignore` stays at the repo root, and so does `.env`. A checkout build reads secrets from
that root `.env`. It is gitignored, so a clone does not carry one and each user writes their
own. See [Environment and Secrets](../README.md#environment-and-secrets-env).

**Built here, shipped as an image.** This covers the Edge Pi 5 tier. The Pi gets no repo
checkout. On the dev machine, build the arm64 image, `docker save` it to
`deploy/edge/docker/berth-rpi.tar.gz`, and copy just that tarball and
`docker-compose.rpi.yml` to `~/berth/` on the Pi, then create the `.env` there. Run
`docker load` followed by `docker compose -f docker-compose.rpi.yml up -d` from `~/berth/`.
The full walkthrough (cameras, secrets, port 8001, verification) is in
[`edge/docker/README.md`](edge/docker/README.md).

**No Docker at all.** This covers the Edge Zero 2 W / 3B native tier: ship the code, run
`install.sh`, serve under systemd. See [`edge/native/README.md`](edge/native/README.md).
