# Deploying Berth

Berth is one product with several deployment tiers. The core (model, inference, and
detection pipeline) is identical everywhere and lives in [`backend/`](../backend/). Only the
packaging and runtime tuning change between tiers.

## Which tier applies?

| Tier | Hardware | Deployment command | Docs |
|------|----------|-------------------|------|
| **[Dev](dev/)** | Any laptop | `python backend/main.py` from a checkout | [dev/](dev/) |
| **[Docker](docker/)** | x86 server / cloud | `docker compose -f deploy/docker/docker-compose.yml up -d --build` from repo root | [docker/](docker/) |
| **[Edge · Pi 5 (Docker)](edge/docker/)** | RPi 5 (arm64) | build image on dev → ship tarball + compose to the Pi → run there | [edge/docker/](edge/docker/) |
| **[Edge · Zero 2 W / 3B (native)](edge/native/)** | RPi Zero 2 W / 3B | `sudo install.sh` on the Pi, systemd | [edge/native/](edge/native/) |

## How this is organized

**Built and run on one machine, from a repo checkout.** This covers the Dev and x86 Docker
tiers. Run compose from the repo root, which is the build context. `.dockerignore` and `.env`
both stay there, and a checkout build reads secrets from that root `.env`. See
[Environment and Secrets](../README.md#environment-and-secrets-env).

**Built here, shipped as an image.** This covers the Edge Pi 5 tier. The Pi gets no repo
checkout, only the image tarball, `docker-compose.rpi.yml`, and a `.env` created there. The
full walkthrough (cameras, secrets, port 8001, verification) is in
[`edge/docker/README.md`](edge/docker/README.md).

**No Docker at all.** This covers the Edge Zero 2 W / 3B native tier: ship the code, run
`install.sh`, serve under systemd. See [`edge/native/README.md`](edge/native/README.md).
