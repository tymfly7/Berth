# Edge: Raspberry Pi

Two deployment paths, depending on the board:

| Board | RAM | Path | Where |
|-------|-----|------|-------|
| **Pi 5** | ≥ 4 GB | Docker (arm64) | [`docker/`](docker/): `Dockerfile.rpi` + `docker-compose.rpi.yml` |
| **Pi Zero 2 W** | 512 MB | Native | [`native/`](native/) |
| **Pi 3B** | 1 GB | Native | [`native/`](native/) |

On the Pi 5 the Docker daemon overhead (~100–150 MB) is affordable. On the 512 MB / 1 GB
boards it is not, so there the backend runs **directly under systemd**, no container. That is
the [`native/`](native/) path.

All edge tiers run **NCNN, torch-free** inference.

## Docker (Pi 5)

Build files live in [`docker/`](docker/) (`Dockerfile.rpi`, `docker-compose.rpi.yml`).
`.env_edge` (local secrets, gitignored) stays at the repo root. **Run all commands from the
repo root** (the build context):

```bash
# Pi 5
docker compose -f deploy/edge/docker/docker-compose.rpi.yml up -d
```

Publishes host port **8001** → container 8000 and passes through `/dev/video0`.

### Cross-building the image tarball

To build on x86 and ship to the Pi, run the save from the repo root so the tarball lands at the
root (where it is gitignored, alongside the other local artifacts):

```bash
docker buildx build --platform linux/arm64 -t berth-rpi:latest \
  -f deploy/edge/docker/Dockerfile.rpi . --load
docker save berth-rpi:latest | gzip > berth-rpi.tar.gz     # → repo root, gitignored
```

## Native (Zero 2 W / 3B)

The lowest-footprint tier, with no Docker daemon at all. See [`native/`](native/) for the
one-shot installer (`install.sh`), the systemd unit (`berth.service`), and the full
setup / ops / recovery guide.
