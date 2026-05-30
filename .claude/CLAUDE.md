# Project Instructions

## Large directories — do NOT read file contents

These directories contain huge numbers of files. Reading individual file contents will exhaust token limits and cause failures.

- `backend/data/` — training image dataset (thousands of photos). You may check if subdirectories (`occupied/`, `vacant/`) exist, but never read or glob individual file contents.
- `frontend/node_modules/` — npm packages. You may run npm commands but never read source files inside here.
- `backend/venv/` (or any virtualenv directory) — Python packages. Use `pip show <pkg>` or `pip list` for package info, never read files inside.

When understanding code structure, rely on imports, `config.py`, and source files under `backend/src/` and `frontend/src/` only.

If access to any of the above directories is genuinely needed, prompt for permission first.
