# Edge — Raspberry Pi

Two deployment paths, depending on the board:

| Board | RAM | Path | Where |
|-------|-----|------|-------|
| **Pi 5** | ≥ 4 GB | Docker (arm64) | root `Dockerfile.rpi` + `docker-compose.rpi.yml` |
| **Pi Zero 2 W** | 512 MB | Docker *or* native | `docker-compose.zero.yml` **or** [`native/`](native/) |
| **Pi 3B** | 1 GB | Native | [`native/`](native/) |

On the Pi 5 the Docker daemon overhead (~100–150 MB) is affordable. On the 512 MB / 1 GB
boards it is not — there the backend runs **directly under systemd**, no container. That is
the [`native/`](native/) path.

All edge tiers run **NCNN, torch-free** inference.

## Docker (Pi 5 / Zero 2 W)

Build files live at the **repo root** (`Dockerfile.rpi`, `docker-compose.rpi.yml`,
`docker-compose.zero.yml`, `.env_edge`). Same arm64 image (`berth-rpi:latest`) for both boards;
the board differences live entirely in the compose env.

```bash
# Pi 5
docker compose -f docker-compose.rpi.yml up -d

# Pi Zero 2 W (512 MB tuning, hard mem cap 450 MB)
docker compose -f docker-compose.zero.yml up -d
```

Both publish host port **8001** → container 8000 and pass through `/dev/video0`.

## Native (Zero 2 W / 3B)

The lowest-footprint tier — no Docker daemon at all. See [`native/`](native/) for the
one-shot installer (`install.sh`), the systemd unit (`berth.service`), and the full
setup / ops / recovery guide.
