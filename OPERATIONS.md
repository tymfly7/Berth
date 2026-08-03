# Berth: Operations and Field Notes

Operator-facing tips and hardening notes. The README covers the factual "how to run
and deploy". This file collects the judgment-call advice that does not belong in a
reference.

---

## Camera connection tips

### USB cameras

- OpenCV reads the device server-side, so the camera must be plugged into the host
  running the backend rather than the machine the browser runs on.
- The source is the integer device index: `0` for the first or built-in camera,
  then `1`, `2`, and so on for additional ones.
- If the index is wrong, nothing opens and the camera shows offline. Try the next
  index. Only one application can hold a given camera at a time.

### RTSP / IP cameras

- The `<stream-path>` is vendor-specific, for example Hikvision
  `/Streaming/Channels/101` and Dahua `/cam/realmonitor?channel=1&subtype=0`. Check
  the camera's manual or its ONVIF/app settings.
- Test the URL in VLC first (*Media → Open Network Stream*). If VLC plays it, the
  backend will too, since both use FFmpeg.
- Prefer the camera's lower-resolution sub-stream (e.g. Hikvision `Channels/102`,
  Dahua `subtype=1`). Parking detection does not need full resolution, and the
  sub-stream is far lighter on CPU and bandwidth.
- Keep credentials out of `cameras.json` by setting the source as
  `BERTH_CAM_SOURCE_<CAMERA_ID>` (uppercase, hyphens replaced by underscores). The
  registry uses it at runtime and the on-disk config stays credential-free.

### YouTube live

- Paste a YouTube live URL. The backend resolves it to an HLS stream cached for
  `BERTH_YT_CACHE_TTL` seconds. If a stream starts erroring, the URL may have
  expired, and the cache refreshes on the next resolve.

---

## Anomaly detection in the field

- The detector has no notion of where the lot ends. It reports every vehicle it
  sees, and anything not sitting squarely inside a slot polygon is flagged. On a
  feed that includes a road or a neighbouring property, passing traffic will be
  flagged. This is deliberate, and the admin dismisses what is not a violation.
- Drawing slots over the whole parkable area is the cheapest way to cut false
  flags, because any vehicle outside every polygon reads as `outside`.
- Two reasons share the Misparked bucket. `straddling` fires when at least 35% of
  a vehicle falls inside each of two or more slots. `outside` fires when the best
  single-slot overlap falls below `park_thresh`, which covers both a vehicle half
  out of a slot and one with no slot overlap at all.
- `park_thresh` is the tuning knob, and the code default is 0.60. Raise it to be
  stricter about what counts as properly parked, lower it to tolerate loosely
  drawn slots. Slots drawn generously larger than the vehicles using them push
  overlap down and make `outside` fire more often, so either lower the threshold
  or redraw the slots tighter.
- The anomaly pass runs on its own cadence, set by `BERTH_ANOMALY_FPS`, and is
  independent of the stream and inference rates. At the default of roughly one
  pass every 15 s, a vehicle that pulls in and straightens up between passes can
  be flagged once and clear on the next.

---

## Data gathering captures

- Each camera has a `data_gathering` flag, off by default, toggled per camera from
  the registry or through `POST /api/cameras/{camera_id}/data-gathering`. It exists
  to collect real frames from a deployed lot for labelling and retraining, not as
  a debugging aid.
- When enabled, one frame is written every `BERTH_CAPTURE_INTERVAL` seconds
  (default 600) to `BERTH_CAPTURE_DIR/<camera name>/<DD-MM-YY>/`.
- The frame saved is the raw source frame, captured before the downscale to the
  configured stream size. A 1080p camera therefore writes 1080p JPEGs regardless
  of the deployment's frame settings, so size the disk against the camera rather
  than against the stream.
- Nothing prunes the output. It grows for as long as the flag is left on, and old
  day folders have to be cleared by hand.
- On edge boards these writes land on the SD card, which is both slow and finite.
  Leave the flag off on a Pi Zero 2 W or 3B unless actively collecting, and audit
  `backend/configs/cameras.json` before first boot on a device whose config was
  carried over from a development machine.

---

## Security hardening

Auth is intentionally coarse. There are no per-user identities, roles, or audit
trail. Admin access is a single shared password, and machine-to-machine clients use
a single shared service key.

Before any network-facing deployment:

- Set `BERTH_ADMIN_PASSWORD` to a strong value. Without it, admin login returns
  `503` and the dashboard is unreachable.
- Set `BERTH_AUTH_SECRET` to a long random string so login tokens survive backend
  restarts. Otherwise a fresh secret is generated at each start, which silently
  logs everyone out.
- Set `BERTH_API_KEY` if anything other than the browser reaches the protected API,
  such as edge-to-hub sync. When empty, the static-key path is open and only the
  Bearer session token gates protected routes.
- Serve over TLS via a reverse proxy. The app speaks plain HTTP, so put nginx,
  Caddy, or Traefik in front for TLS termination on anything beyond localhost.
- CORS allows localhost and private LAN ranges by default. Add a public origin
  explicitly with `BERTH_ALLOWED_ORIGIN`.
