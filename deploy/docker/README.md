# Docker: standard x86 / cloud

Reproducible container for a normal x86-64 server or the cloud. Build files live here
(`deploy/docker/Dockerfile`, `deploy/docker/docker-compose.yml`). The build context is the
repo root, so run from there:

```bash
docker compose -f deploy/docker/docker-compose.yml up -d --build   # from the repo root
```

- Image: `berth:1.0`, container `berth`.
- Host port **9000** → container 8000 (`127.0.0.1:9000:8000`).
- Model: `yolo26s_classify` (full torch stack, CPU-only wheels).
- Bind mounts: `backend/{data,models,outputs,uploads}` + `./captures`.
- Set `BERTH_API_KEY` in the environment before `up` to enforce the API key.

Health check once it is up:

```bash
curl http://127.0.0.1:9000/api/health
```

## Rebuilding after a code change

The build runs in two stages. Node compiles the frontend. The Python image copies that bundle
into `/app/static` and FastAPI serves it. Backend code and the frontend bundle both sit inside
the image.

Compose builds only when `berth:1.0` is absent. A later `up -d` starts the image that already
exists, without the newer code. `--build` rebuilds it:

```bash
docker compose -f deploy/docker/docker-compose.yml up -d --build
```

Files under the bind mounts stay live. Those paths are `backend/data`, `backend/models`,
`backend/outputs`, `backend/uploads` and `captures`. New weights placed in `backend/models`
are visible inside the container immediately.

The container runs uvicorn without `--reload`. Backend edits take effect at the next build. A
native backend gives a faster development loop.

For Raspberry Pi (arm64) images, see [`../edge/`](../edge/).
