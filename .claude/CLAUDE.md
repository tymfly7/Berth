# Project Instructions

## Workflow Requirements.
Always log implementation work to the requested phase log file as a standard step at the END of every feature/bug-fix task, without needing to be reminded.

## Logging Conventions
When logging work, ALWAYS confirm the exact target log file (e.g., log_phaseN.md) before writing, and write only to the file the user named.


## Frontend / JavaScript
After any frontend change (removing imports, refactoring components), verify there are no orphaned references or missing dependencies (e.g., useNavigate, react-router-dom) by checking imports and running the dev build before declaring done.

## ML / Training Conventions
Do not start coding until you have confirmed the correct data source and run a quick verification.


## Performance / Exploration section.
Do not read large directories or run polling commands; respect directory restrictions and prefer targeted Glob/Grep instead of broad reads.

## Large directories — do NOT read file contents

These directories contain huge numbers of files. Reading individual file contents will exhaust token limits and cause failures.

- `backend/data/` — training image dataset (thousands of photos). You may check if subdirectories (`occupied/`, `vacant/`) exist, but never read or glob individual file contents.
- `frontend/node_modules/` — npm packages. You may run npm commands but never read source files inside here.
- `backend/venv/` (or any virtualenv directory) — Python packages. Use `pip show <pkg>` or `pip list` for package info, never read files inside.

When understanding code structure, rely on imports, `config.py`, and source files under `backend/src/` and `frontend/src/` only.

If access to any of the above directories is genuinely needed, prompt for permission first.