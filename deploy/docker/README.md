# Docker: standard x86 / cloud

Reproducible container for a normal x86-64 server or the cloud. Build files live here
(`deploy/docker/Dockerfile`, `deploy/docker/docker-compose.yml`); the build context is the
repo root, so run from there:

```bash
docker compose -f deploy/docker/docker-compose.yml up -d      # from the repo root
```

- Image: `berth:1.0`, container `berth`.
- Host port **9000** → container 8000 (`127.0.0.1:9000:8000`).
- Model: `yolo26_classify` (full torch stack).
- Bind mounts: `backend/{data,models,outputs,uploads}` + `./captures`.
- Set `BERTH_API_KEY` in the environment before `up` if you want the API key enforced.

Health check once it's up:

```bash
curl http://127.0.0.1:9000/api/health
```

> The build context is the repo root because the Dockerfile does `COPY backend/` and
> `COPY frontend/`. That is why the compose file sets `build.context: ../..` and you invoke it
> with `-f deploy/docker/docker-compose.yml` from the root rather than `cd`-ing in here.

For Raspberry Pi (arm64) images, see [`../edge/`](../edge/).
