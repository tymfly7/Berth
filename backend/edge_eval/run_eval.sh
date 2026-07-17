#!/usr/bin/env bash
# Eval wrapper for native edge devices (RPi 3B / Zero 2W).
# Stops the berth service so eval gets the full CPU/RAM budget, runs the
# eval CLI with the venv python, and restarts the service on exit (even if
# the eval crashes). All arguments are passed through to eval_edge.py.
#
#   ./run_eval.sh --dataset data/t12lot_subset --model yolo26n_classify
#
# Override the service name with BERTH_SERVICE (default: berth).
set -euo pipefail
cd "$(dirname "$0")/.."

SERVICE="${BERTH_SERVICE:-berth}"
SUDO=""
[ "$(id -u)" -ne 0 ] && SUDO="sudo"

PY="venv/bin/python"
[ -x "$PY" ] || PY="python3"

RESTART=0
if systemctl is-active --quiet "$SERVICE"; then
    RESTART=1
    echo "Stopping $SERVICE for the eval run..."
    $SUDO systemctl stop "$SERVICE"
fi
trap '[ "$RESTART" -eq 1 ] && { echo "Restarting $SERVICE..."; $SUDO systemctl start "$SERVICE"; }' EXIT

BERTH_DEPLOYMENT=edge "$PY" edge_eval/eval_edge.py "$@"
