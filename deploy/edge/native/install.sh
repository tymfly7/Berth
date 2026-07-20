#!/usr/bin/env bash
#
# Berth native (Docker-free) installer for low-RAM Raspberry Pi boards.
# A faithful, idempotent scripting of README.md sections 1-5 (Pi Zero 2 W profile).
# For the Pi 3B (1 GB) memory-cap deltas, see the README section "Pi 3B profile".
#
# Run ON the Pi, as the `edge` user (must have sudo). The backend code must
# already be in ~/berth/backend -- transfer it from the dev machine first
# (README: "Transfer the code"). Ship this whole folder so berth.service sits
# next to this script.
#
# Safe to re-run: it skips completed steps and is meant to be run AGAIN after
# the reboot it asks for (zram + the memory cgroup both need one to take effect).

set -euo pipefail

PROJECT_DIR="${PROJECT_DIR:-$HOME/berth}"
HERE="$(cd "$(dirname "$0")" && pwd)"
UNIT_SRC="$HERE/berth.service"
UNIT_DST="/etc/systemd/system/berth.service"

echo "== Berth native installer =="

# ---- 0. sanity checks ----
[ -d "$PROJECT_DIR/backend" ] || { echo "ERROR: $PROJECT_DIR/backend not found. Transfer the code first (README: Transfer the code)."; exit 1; }
[ -f "$UNIT_SRC" ] || { echo "ERROR: berth.service not found next to this script ($UNIT_SRC)."; exit 1; }
command -v sudo >/dev/null || { echo "ERROR: sudo is required."; exit 1; }
[ "$(id -un)" = "edge" ] || echo "WARNING: berth.service is written for user 'edge' at /home/edge/berth. You are '$(id -un)' -- edit berth.service paths/User= if that is wrong."

# ---- 1. lean OS: packages + RAM trims (section 1) ----
echo "-- [1/5] OS packages + RAM trims"
sudo apt update
sudo apt full-upgrade -y
sudo apt install -y python3-venv python3-pip libgl1 libglib2.0-0

CONFIG_TXT=/boot/firmware/config.txt
grep -q '^gpu_mem=16'          "$CONFIG_TXT" || echo 'gpu_mem=16'          | sudo tee -a "$CONFIG_TXT" >/dev/null
grep -q '^dtoverlay=disable-bt' "$CONFIG_TXT" || echo 'dtoverlay=disable-bt' | sudo tee -a "$CONFIG_TXT" >/dev/null
sudo systemctl disable --now bluetooth triggerhappy ModemManager 2>/dev/null || true
sudo sed -i 's/^#\?Storage=.*/Storage=volatile/' /etc/systemd/journald.conf

# ---- 2. zram swap + earlyoom (section 2) ----
echo "-- [2/5] zram swap + earlyoom"
sudo dphys-swapfile swapoff 2>/dev/null || true
sudo systemctl disable --now dphys-swapfile 2>/dev/null || true
sudo apt install -y zram-tools earlyoom
printf 'ALGO=zstd\nPERCENT=60\n'            | sudo tee /etc/default/zramswap    >/dev/null
printf 'vm.swappiness=100\nvm.page-cluster=0\n' | sudo tee /etc/sysctl.d/99-zram.conf >/dev/null
sudo systemctl enable --now zramswap earlyoom

# ---- 3. enable the memory cgroup controller on the kernel cmdline (section 3) ----
echo "-- [3/5] enable memory cgroup controller"
CMDLINE=/boot/firmware/cmdline.txt
if ! grep -q 'cgroup_enable=memory' "$CMDLINE"; then
  # cmdline.txt MUST stay a SINGLE line -- append the tokens to the end of line 1.
  sudo sed -i '1 s/$/ cgroup_enable=memory cgroup_memory=1/' "$CMDLINE"
  echo "   appended 'cgroup_enable=memory cgroup_memory=1' to $CMDLINE"
fi

# ---- reboot gate: zram + cgroup only take effect after a reboot ----
need_reboot=0
grep -q 'cgroup_enable=memory' /proc/cmdline || need_reboot=1
swapon --show=NAME 2>/dev/null | grep -q '/dev/zram0' || need_reboot=1
if [ "$need_reboot" -eq 1 ]; then
  echo
  echo "== Reboot required to apply zram + the memory cgroup. =="
  echo "     sudo reboot"
  echo "   Then re-run this script to finish (venv + service)."
  exit 0
fi

# ---- 4. python venv (section 4) ----
echo "-- [4/5] python venv (aarch64 wheels, no compiler)"
[ -x "$PROJECT_DIR/venv/bin/python" ] || python3 -m venv "$PROJECT_DIR/venv"
"$PROJECT_DIR/venv/bin/pip" install --no-cache-dir -r "$PROJECT_DIR/backend/requirements.edge.txt"

# ---- 5. systemd service (section 5) ----
echo "-- [5/5] install systemd service"
sudo cp "$UNIT_SRC" "$UNIT_DST"
sudo systemctl daemon-reload
sudo systemctl enable berth.service    # start on boot; NOT started yet -- audit cameras first

cat <<'EOF'

== Install complete. One safety step before starting: ==

  Audit backend/configs/cameras.json. Any camera left "active": true starts
  decoding at launch -- a 1080p stream can eat all RAM before you can log in.
  For first boot set every camera "active": false (and "data_gathering": false).

Then start it:

  sudo systemctl start berth.service
  journalctl -u berth -f
  curl http://127.0.0.1:8001/api/health
EOF
