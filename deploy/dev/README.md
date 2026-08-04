# Dev: run from source

Fast local iteration on any laptop. No container, no edge tuning.

```bash
cd backend
python3 -m venv venv
venv/bin/pip install -r requirements.txt      # Windows: venv\Scripts\pip install -r requirements.txt
venv/bin/python main.py                        # Windows: venv\Scripts\python main.py
```

The backend serves on `http://0.0.0.0:8001` by default. Override with `BERTH_HOST` /
`BERTH_PORT`. Configuration comes from `backend/.env` (see the keys used across the compose
files: `BERTH_API_KEY`, `BERTH_ADMIN_PASSWORD`, `BERTH_MODEL`, …).

For the web UI during dev, run the Vite dev server in [`frontend/`](../../frontend/)
(`npm install && npm run dev`) and point it at the backend via `frontend/.env.local`
(`VITE_API_BASE=http://localhost:8001`).

Torch is available, every model loads, and no memory caps apply. For the constrained profiles
see [`../docker/`](../docker/) and [`../edge/`](../edge/).
