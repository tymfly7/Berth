# Edge: Docker (Pi 5)

Arm64 image (`berth-rpi:latest`, torch-free / NCNN) for the **Raspberry Pi 5** (≥ 4 GB). The
512 MB / 1 GB boards (Zero 2 W, 3B) run directly under systemd instead: see
[`../native/`](../native/).

| File | What it is |
|------|------------|
| `Dockerfile.rpi` | The image |
| `docker-compose.rpi.yml` | Pi 5 profile, up to 3 active cameras |
| `README.md` | This guide |

**Run all commands from the repo root**: it is the build context, so the compose file sets
`build.context: ../../..`.

```bash
# Pi 5
docker compose -f deploy/edge/docker/docker-compose.rpi.yml up -d
```

Publishes host port **8001** → container 8000.

### Cameras

The container does not claim a specific webcam at start. It bind-mounts the host `/dev` and
grants V4L2 (character major 81) through `device_cgroup_rules`, so a USB camera plugged in
*after* the service is running is opened the moment a camera is activated in the UI. No
container recreate is needed, and the service still starts on a Pi with no camera attached at
all.

Ribbon/CSI cameras on Bookworm go through libcamera, which this image does not carry.
Use a USB webcam or a network stream.

## Secrets: the `.env` file

Nothing secret is baked into the image. `config.py` reads three env vars at every start, and
the compose file interpolates them as `${VAR:-}`, which defaults to empty.
A missing file therefore produces a silently broken login:

| Var | If unset |
|-----|----------|
| `BERTH_ADMIN_PASSWORD` | `/api/auth/login` returns **503** and the admin UI cannot be used at all. |
| `BERTH_API_KEY` | Every protected endpoint is publicly accessible. `main.py` warns at startup. |
| `BERTH_AUTH_SECRET` | A random signing key is generated per process, so every container restart invalidates issued tokens. |

The file is created on the device and never shipped from the repo (`.env` is gitignored). On
the Pi, put it next to the compose file:

```bash
cd ~/berth                      # wherever docker-compose.rpi.yml lives
cat > .env <<EOF
BERTH_ADMIN_PASSWORD=choose-a-real-password
BERTH_API_KEY=$(openssl rand -hex 32)
BERTH_AUTH_SECRET=$(openssl rand -hex 32)
EOF
chmod 600 .env
```

Write values bare, as `BERTH_ADMIN_PASSWORD=secret` and not `="secret"`. Compose keeps the
quotes as part of the value, which surfaces later as a 401 on a password that looks correct.

Compose auto-loads a file named `.env` from the directory it is run in. On the Pi that is
`~/berth`, next to the compose file. Building from a checkout instead, it is the repo root,
because compose is run from there:

```bash
docker compose -f deploy/edge/docker/docker-compose.rpi.yml up -d
```

The name is `.env` in both places.

**Env is frozen into the container at creation time.** Editing `.env` does nothing to a running
container. `docker compose restart` keeps the old values and only `up -d` recreates it. Verify
what the container actually received, and what login does with it:

```bash
docker exec berth-berth-rpi-1 printenv | grep BERTH_
curl -i -X POST http://localhost:8001/api/auth/login \
  -H 'Content-Type: application/json' -d '{"password":"choose-a-real-password"}'
```

- `503`: the password never arrived.
- `401`: it arrived but does not match. Check for stray quotes or whitespace.
- `200` with a JSON `token`: working.

## Cross-building the image tarball

Build on x86 and ship to the Pi. Both commands run from the repo root, but the tarball is
written here, next to the compose file that consumes it:

```bash
docker buildx build --platform linux/arm64 -t berth-rpi:latest \
  -f deploy/edge/docker/Dockerfile.rpi . --load
docker save berth-rpi:latest | gzip > deploy/edge/docker/berth-rpi.tar.gz
```

The Pi needs no repo checkout, only the image, the compose file, and a `.env`:

```bash
# From the dev machine: ship the image and the compose file
ssh USER@HOST 'mkdir -p ~/berth'
scp deploy/edge/docker/berth-rpi.tar.gz \
    deploy/edge/docker/docker-compose.rpi.yml USER@HOST:~/berth/

# On the Pi: load the image (docker load reads the gzip directly)
cd ~/berth
docker load < berth-rpi.tar.gz

# Create .env here first, see "Secrets" above, then:
docker compose -f docker-compose.rpi.yml up -d   # no --build: uses the loaded image
```

`docker-compose.rpi.yml` references `image: berth-rpi:latest`, so once the image is loaded the
compose run picks it up without rebuilding. Its `build.context: ../../..` points at a repo tree
that does not exist on the Pi. If the load failed or the tag differs, Compose falls back to
building and fails with a confusing missing-path error.
`docker images | grep berth-rpi` is the quick check.

A native build on the Pi
(`docker build -t berth-rpi:latest -f deploy/edge/docker/Dockerfile.rpi .`) also works, just
slower. The `.tar.gz` is gitignored. Rebuild it after any backend or frontend change so the
image does not go stale.
