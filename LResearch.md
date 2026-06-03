# Live Feed Inference — How It Works

## Overview

When a camera is active, three background threads run simultaneously on the server for that camera. They work as a pipeline: one reads frames, one classifies them, one sends them to the browser.

---

## Thread 1 — Source (reads video)

The source thread continuously reads raw video frames from wherever the camera points:

- **USB webcam** — reads as fast as the camera delivers frames (typically 24–30 fps)
- **RTSP stream** — same, reads as fast as the stream sends them
- **YouTube/HLS** — reads HLS segments as they arrive in bursts every few seconds

Each frame gets stored in two places:
1. `_latest_raw` — always overwritten with the newest frame (used by the display thread)
2. `_jitter_buffer` — a short queue only used for YouTube to smooth out burst delivery

---

## Thread 2 — Inference (runs the AI model)

The inference thread wakes up whenever a new frame is available. It does not try to process every single frame — it always grabs the newest available frame so it never falls behind.

Steps for each inference cycle:

### Step 1 — Load the ROI polygons
The system looks up the parking slot shapes (ROIs) that the admin drew for this camera. Each ROI is a polygon stored as normalized coordinates (0.0–1.0 relative to frame size).

### Step 2 — Crop each slot
For each ROI polygon, the thread finds its bounding box, scales it to pixel coordinates, and cuts that rectangle out of the full frame. This gives one small image per parking slot.

### Step 3 — Classify each crop (the actual AI)
All the crops are sent to the classifier in one batch call. Depending on which model is active:

- **CNN Scratch / ResNet-50 / MobileNetV4** — the crop is resized to 224×224 pixels, converted to a tensor, normalized using ImageNet mean/std values, then fed through the neural network. The network outputs a single number (a logit). Applying sigmoid to it gives a probability. Above 0.5 → occupied; below 0.5 → vacant. Confidence is how far from 0.5 it is.
- **YOLO26 Classify** — the crop is fed directly to a YOLO classification model (Ultralytics). It outputs probabilities for each class. Class 0 = occupied, Class 1 = vacant.
- **YOLO26 Detect** — runs object detection on the crop. If a vehicle is found → occupied; otherwise → vacant.

### Step 4 — Cache the results
The per-slot results (`{slot_id: "occupied" | "vacant"}`) are written to a shared cache (`_cached_status_map`). The display thread reads from this cache when drawing overlays.

The metrics (total slots, available count, occupancy %) are also updated here and written to the database once per minute.

---

## Thread 3 — Display (sends frames to the browser)

The display thread runs at a fixed 20 fps regardless of how fast inference or the source is. Each tick it:

1. Grabs the newest raw frame from `_latest_raw` (or for YouTube, pops one from the jitter buffer)
2. Resizes it to 1280×720
3. Loads the latest cached slot statuses
4. Draws colored polygon outlines over the frame:
   - **Green** = vacant
   - **Blue** = occupied
   - **Grey** = unknown (no result yet)
5. If anomaly detection is on, draws orange boxes around any misparked vehicles
6. JPEG-encodes the annotated frame at quality 92
7. Stores the JPEG (as base64) and increments a sequence counter

---

## WebSocket — delivery to the browser

A separate async loop runs for each connected browser tab. Every 50ms it checks if the sequence counter changed (meaning a new frame is ready). If yes, it sends a JSON message containing:
- The base64-encoded JPEG frame
- The current metrics (slot counts, FPS, occupancy %)

The frontend React app receives the message, calls `setFrame(data.frame)`, and React re-renders the `<img>` element with the new JPEG. Metrics are throttled to update at most every 500ms so the numbers stay readable.

---

## Why inference and display are on separate threads

The AI model is slow — on CPU it might take 50–200ms per batch. If inference ran on the same thread as display, the video would stutter every time the model ran. By decoupling them:

- The display always runs at smooth 20 fps using the *last known* classification result as the overlay color
- Inference runs as fast as the hardware allows in the background and updates the overlay cache when it finishes
- The video never freezes waiting for the model

---

## Data flow summary

```
Camera/file
    |
    v  (source thread, raw frames)
_latest_raw ──────────────────────────────> inference thread
                                                |
                                                |  crops each ROI
                                                |  runs classifier
                                                |
                                                v
                                        _cached_status_map
                                                |
_latest_raw ──> display thread <───────────────┘
                    |  draws colored overlays
                    |  JPEG-encodes frame
                    v
              _frame_b64 + _frame_seq
                    |
                    v  (WebSocket, every 50ms)
              Browser -> React renders <img>
```

---

# Why Models Perform Poorly on Camera 3 (KromC)

## The Setup

All three cameras point at the same physical location: the main square in Kroměříž, Czech Republic. Cameras 1 and 2 (krom, Krom B) share the same YouTube feed. Camera 3 (KromC) is a different recording from the same square.

## What the Cameras Actually Show

**Cameras 1 & 2 — normal day:**
- Bright sunny day, clear blue sky
- Strong sunlight casts hard shadows under each vehicle
- High contrast between dark car tops and pale cobblestone ground
- White parking line markings clearly visible
- Square is mostly empty; only a couple of pedestrians visible far away
- Each slot crop is a clean image: either a car roof or bare cobblestones

**Camera 3 — market day:**
- Overcast sky, flat gray light with no strong shadows
- A street market is taking place across the entire square
- Colorful tents and stalls fill the upper two-thirds of the frame
- Hundreds of people walking around, including through the parking area itself
- Parking slots are in the lower portion of the frame but surrounded by visual chaos
- Ground texture looks different under the gray light

## The Core Problem: Domain Shift

The models were trained on the PKLot dataset — clean aerial parking lot photos taken under normal conditions. They learned patterns like:

- "A car top looks like a dark rectangle with hard edges and a strong shadow on cobblestone"
- "An empty slot looks like a uniform pale patch of ground with white line markings"
- "The background is quiet — no market crowds, no tents"

Camera 3 breaks every one of those assumptions.

### Reason 1 — Lighting changes the appearance of everything

Overcast light removes shadows. On a sunny day, a parked car casts a clear dark shadow that helps define its edges and anchor it to the ground. Under flat gray light, cars look flatter and blend more with the ground. The model expected brightness and contrast patterns from training that simply do not exist in camera 3.

### Reason 2 — Pedestrians in and around the slots

During the market, people walk through the parking area. A slot occupied by a car might have someone standing in front of it, partially covering it. A vacant slot might have someone walking across it mid-frame. Either case confuses a classifier that was only ever trained to see "car roof" or "empty ground."

### Reason 3 — Market colours contaminate the context

The bright tent colours (orange, yellow, blue, green) fill the upper part of the frame directly above the parking slots. Even though ROI crops are cut from just the slot areas, CNN classifiers pick up on global image statistics alongside the local crop content. The unusually vivid and busy background shifts those statistics far from anything in the training set.

### Reason 4 — The model has simply never seen this

Neither the PKLot dataset nor any footage from cameras 1 or 2 includes market-day conditions. The model cannot generalise to a scene it has never been exposed to. It is not broken — it is out of distribution.

## Why YOLO Handles It Slightly Better

YOLO detect explicitly looks for vehicle shapes as objects rather than classifying the texture of a slot region. It is asking "is there a car-shaped thing in this crop?" which generalises better across lighting changes than a whole-image classifier. However, YOLO still struggles with heavy pedestrian occlusion (someone standing in front of a parked car) and with vehicles partially hidden under market stall canopies.

## How to Fix It

The only reliable fix is to collect training samples specifically from camera 3 under market-day conditions — labelled images of occupied and vacant slots with overcast lighting and pedestrian activity present. Adding 100–200 such examples per class and fine-tuning would dramatically close the gap. Data augmentation during training (random brightness reduction, crowd overlay, shadow removal) would also improve robustness without needing entirely new real images.
