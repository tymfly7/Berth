# Edge: Docker (Pi 5)

Arm64 image (`berth-rpi:latest`, torch-free / NCNN) for the Raspberry Pi 5:

| File | Board |
|------|-------|
| `Dockerfile.rpi` | the image |
| `docker-compose.rpi.yml` | Pi 5, up to 4 cameras |

**Run all commands from the repo root**: the build context is the root (the Dockerfile does
`COPY backend/` and `COPY frontend/`), so each compose file sets `build.context: ../../..`.

```bash
# Pi 5
docker compose -f deploy/edge/docker/docker-compose.rpi.yml up -d
```

Secrets: edge compose reads `.env_edge` (local, gitignored, at the repo root) via
`--env-file .env_edge`, or a `.env` in the root. Full workflow, including cross-building the
image tarball and shipping it to the Pi, is in [`../README.md`](../README.md) and the main
project README.

For the lowest-footprint boards (Zero 2 W / 3B), which run without Docker, see [`../native/`](../native/).
