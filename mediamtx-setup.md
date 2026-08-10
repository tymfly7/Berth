# MediaMTX (host-side) setup for the RTSP camera on a Raspeberry Device

> **Scope:** this is **outside** the berth Docker container. MediaMTX runs on the
> Raspberry Pi host and publishes the CSI camera over RTSP; the berth container is
> just a *reader* of that stream (`rtsp://<pi-ip>:8554/cam`). Add this to the dev
> README's host/provisioning steps — it is not part of the image build.

## What it is / why

The Pi's ov5647 CSI camera is **not** accessible from inside the container as an
RTSP source on its own. MediaMTX uses its built-in `rpiCamera` source to drive
libcamera and the Pi hardware H.264 encoder, then serves the result over RTSP on
port `8554`. berth connects to that URL (configured per camera in the app, e.g.
`rtsp://192.168.0.195:8554/cam`).

```
ov5647 CSI ──libcamera──▶ MediaMTX rpiCamera (HW H264 encode) ──RTSP :8554──▶ berth container (reader)
        [ host ]                                                              [ docker ]
```

## Install (host)

```bash
# 1) MediaMTX binary + config in the user's home (matches current Pi layout)
#    download the linux arm64 build from github.com/bluenviron/mediamtx/releases
tar -xzf mediamtx_*_linux_arm64.tar.gz -C ~/        # -> ~/mediamtx, ~/mediamtx.yml

# 2) run as a systemd service so it starts on boot
sudo tee /etc/systemd/system/mediamtx.service >/dev/null <<'EOF'
[Unit]
Description=MediaMTX RTSP server (Pi camera for berth)
After=network-online.target
Wants=network-online.target

[Service]
ExecStart=/home/darkwall/mediamtx /home/darkwall/mediamtx.yml
Restart=on-failure
User=darkwall

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now mediamtx
```

Requires the camera enabled at the OS level (`libcamera-hello --list-cameras`
should show the ov5647). MediaMTX's `rpiCamera` source talks to libcamera directly.

## Camera path config (`~/mediamtx.yml`)

Under `paths:` define the `cam` path. These values are tuned so the berth reader
can keep up — see "Why these values" below.

```yaml
paths:
  # Raspberry Pi CSI camera (ov5647) served over RTSP for berth.
  cam:
    source: rpiCamera
    rpiCameraWidth: 1280
    rpiCameraHeight: 720
    rpiCameraFPS: 10            # berth can't decode 15fps under inference load -> frame drops -> corruption
    rpiCameraIDRPeriod: 10      # keyframe ~every 1s (global default is 60 = ~4s); any glitch self-heals fast
    rpiCameraBitrate: 2500000   # 2.5 Mbit is plenty for 720p10; lower = less for the reader to move/decode
```

Apply with:

```bash
sudo systemctl restart mediamtx
```

### Why these values (important — this was the cause of the pixelation bug)

The Pi host *is* the RTSP server, so the berth→MediaMTX hop is essentially
lossless. The macroblock corruption / pixelation berth showed was **not** a
network or transport problem — it was MediaMTX dropping frames because the reader
couldn't keep up:

```
WAR [RTSP] [session …] reader is too slow, discarding NNN frames
```

When MediaMTX drops queued frames to a slow reader, berth's H.264 decoder receives
a stream with gaps (missing reference frames) and renders corrupted macroblocks
until the next keyframe. So:

- **Lower fps + bitrate** → less data per second → the reader keeps up → MediaMTX
  stops discarding frames (the root fix).
- **Short `rpiCameraIDRPeriod`** → if any gap still happens, it self-heals within
  ~1 s instead of lingering ~4 s.

> If occupancy detection later needs 15 fps, you can raise `rpiCameraFPS` back to
> 15 but keep `rpiCameraIDRPeriod: 15` and the reduced bitrate, and watch the
> journal for "reader is too slow".

## Reader side (TCP)

berth opens the stream with `rtsp_transport;tcp` (forced in
`video_processor.py`), so MediaMTX must allow RTSP over TCP — it does by default
(`rtspTransports` includes `tcp`). No MediaMTX change needed for that; just don't
disable TCP transport.

## Verify

```bash
# camera detected by the OS
libcamera-hello --list-cameras

# MediaMTX up, no "too slow" spam in steady state
systemctl status mediamtx
journalctl -u mediamtx.service -f | grep -i "too slow"   # expect none/rare

# stream readable from the host
ffprobe rtsp://127.0.0.1:8554/cam        # or: ffplay rtsp://127.0.0.1:8554/cam
```

## Networking note for the container

The berth container reaches MediaMTX over the LAN IP (`192.168.0.195:8554`) /
host networking, not via `localhost` inside the container. If you switch the
container to a bridge network without host access, point the camera source at the
host's reachable IP (or run the container with `--network host`, or add
`host.docker.internal`). Ensure host firewall allows `8554/tcp` from the
container's network.
