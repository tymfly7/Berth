# 🅿️ Smart Parking Lot Detection System

> AI-powered parking space detection using Computer Vision and Deep Learning.
> Detects available and occupied parking spaces in real-time and displays
> results through a modern dashboard.

![Python](https://img.shields.io/badge/Python-3.10+-blue?logo=python)
![PyTorch](https://img.shields.io/badge/PyTorch-2.0+-red?logo=pytorch)
![FastAPI](https://img.shields.io/badge/FastAPI-0.110+-teal?logo=fastapi)
![React](https://img.shields.io/badge/React-18-blue?logo=react)

---

## 📋 Table of Contents

- [Features](#-features)
- [Architecture](#-architecture)
- [Quick Start](#-quick-start)
- [Dataset Setup](#-dataset-setup)
- [Training Models](#-training-models)
- [API Reference](#-api-reference)
- [Docker Deployment](#-docker-deployment)
- [Cloud Deployment](#-cloud-deployment)
- [Project Structure](#-project-structure)
- [Model Comparison](#-model-comparison)
- [Common Errors & Fixes](#-common-errors--fixes)
- [Future Improvements](#-future-improvements)

---

## ✨ Features

| Feature | Description |
|---------|-------------|
| 🧠 **3 Model Architectures** | CNN from scratch, ResNet18, MobileNetV2 |
| 📊 **Model Comparison** | Train all models and compare accuracy, F1, speed |
| 📹 **Real-Time Detection** | Webcam / video input with frame-by-frame prediction |
| 🎯 **Confidence Scores** | Every prediction includes confidence percentage |
| 🔥 **Usage Heatmap** | Per-slot occupancy frequency visualization |
| 🟢🔴 **Color-Coded Slots** | Green = Available, Red = Occupied |
| 📈 **Live Analytics** | Occupancy trend chart updated in real-time |
| 🎮 **Demo Mode** | Works without model/camera for testing |
| 🔐 **API Key Auth** | Optional authentication for production |
| 🐳 **Docker Ready** | One-command deployment |

---

## 🏗️ Architecture

```
┌─────────────┐     WebSocket      ┌──────────────┐
│   React UI  │ ◄────────────────► │  FastAPI      │
│   (Vite)    │     REST API       │  Backend      │
│   Port 5173 │ ◄────────────────► │  Port 8000    │
└─────────────┘                    └──────┬───────┘
                                          │
                               ┌──────────┴─────────┐
                               │                     │
                        ┌──────▼──────┐    ┌────────▼────────┐
                        │  Slot       │    │  Video          │
                        │  Detector   │    │  Processor      │
                        └──────┬──────┘    └────────┬────────┘
                               │                     │
                        ┌──────▼──────┐    ┌────────▼────────┐
                        │  CNN/ResNet │    │  OpenCV          │
                        │  Classifier │    │  VideoCapture    │
                        └─────────────┘    └─────────────────┘
```

---

## 🚀 Quick Start

### Prerequisites
- Python 3.10+
- Node.js 18+
- (Optional) NVIDIA GPU with CUDA for faster training

### 1. Clone & Setup Backend

```bash
cd parking_ai/backend

# Create virtual environment
python -m venv venv

# Activate (Windows)
venv\Scripts\activate

# Activate (Linux/macOS)
# source venv/bin/activate

# Install dependencies
pip install -r requirements.txt
```

### 2. GPU Setup (Optional)

```bash
# Check CUDA version
nvidia-smi

# Install PyTorch with CUDA 12.1
pip install torch torchvision --index-url https://download.pytorch.org/whl/cu121

# Or CPU-only (default, ~10-20x slower for training)
pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu
```

### 3. Setup Frontend

```bash
cd parking_ai/frontend
npm install
```

### 4. Run the Application

**Terminal 1 — Backend:**
```bash
cd parking_ai/backend
python main.py
# Server starts at http://localhost:8000
```

**Terminal 2 — Frontend:**
```bash
cd parking_ai/frontend
npm run dev
# Dashboard opens at http://localhost:5173
```

---

## 📦 Dataset Setup

### Option A: PKLot Dataset (Recommended)

1. Download from [Kaggle](https://www.kaggle.com/datasets/blanderbuss/parking-lot-dataset)
2. Extract to a folder (e.g., `D:\datasets\PKLotSegmented`)
3. Organize:

```bash
cd parking_ai/backend
python -m src.data_prep.downloader --source "D:\datasets\PKLotSegmented"
```

### Option B: Generate Sample Data (Quick Testing)

```bash
cd parking_ai/backend
python -m src.data_prep.downloader --generate-sample --sample-count 500
```

### Option C: Via API

```bash
# Generate sample data
curl -X POST http://localhost:8000/api/dataset/prepare?generate_sample=true

# Organize PKLot
curl -X POST "http://localhost:8000/api/dataset/prepare?source=D:/datasets/PKLotSegmented"
```

---

## 🏋️ Training Models

### Train a Single Model

```bash
# Via API
curl -X POST "http://localhost:8000/api/train/start?model_name=cnn_scratch"
curl -X POST "http://localhost:8000/api/train/start?model_name=resnet18"
curl -X POST "http://localhost:8000/api/train/start?model_name=mobilenetv2"

# Check progress
curl http://localhost:8000/api/train/status
```

### Compare All Models

```bash
curl -X POST "http://localhost:8000/api/train/start?model_name=cnn_scratch&compare_all=true"
```

### Training Outputs (saved to `backend/outputs/`)
- `curves_*.png` — Loss & accuracy curves
- `history_*.json` — Epoch-level training logs
- `model_comparison.png` — Side-by-side comparison chart
- `model_comparison.json` — Comparison metrics

### Environment Variables for Training

```bash
SMARTPARK_EPOCHS=30          # Max epochs
SMARTPARK_BATCH_SIZE=64      # Batch size
SMARTPARK_LR=0.001           # Learning rate
SMARTPARK_SUBSET=50000       # Use subset (0 = full dataset)
SMARTPARK_WORKERS=4          # DataLoader workers
```

---

## 📡 API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/` | Service info |
| GET | `/api/health` | Health check |
| POST | `/api/predict` | Upload image → slot-wise results |
| GET | `/api/metrics` | Current parking metrics |
| GET | `/api/heatmap` | Usage heatmap data |
| GET | `/api/history` | Historical occupancy |
| POST | `/api/upload-video` | Upload video for processing |
| POST | `/api/use-camera` | Switch to webcam |
| POST | `/api/use-demo` | Switch to demo mode |
| POST | `/api/use-model/{name}` | Switch model |
| GET | `/api/model/info` | Model & dataset info |
| POST | `/api/train/start` | Start training |
| GET | `/api/train/status` | Training progress |
| POST | `/api/dataset/prepare` | Organize dataset |
| WS | `/ws/video` | Real-time video stream |

### Example: Predict on Image

```bash
curl -X POST http://localhost:8000/api/predict \
  -F "file=@parking_lot.jpg"
```

Response:
```json
{
  "slots": [
    {"id": 1, "status": "vacant", "confidence": 0.95, "bbox": [50, 60, 120, 120]},
    {"id": 2, "status": "occupied", "confidence": 0.88, "bbox": [185, 60, 120, 120]}
  ],
  "total": 18,
  "available": 7,
  "occupied": 11,
  "occupancy_percent": 61.1,
  "avg_confidence": 0.92
}
```

---

## 🐳 Docker Deployment

```bash
# Build
docker build -t smartpark-ai .

# Run
docker run -p 8000:8000 smartpark-ai

# With docker-compose
docker-compose up -d

# With API key
docker run -p 8000:8000 -e SMARTPARK_API_KEY=your-secret smartpark-ai
```

---

## ☁️ Cloud Deployment

### Render

1. Push to GitHub
2. Create new Web Service on [Render](https://render.com)
3. Connect your repo
4. Set build command: `docker build -t app .`
5. Set environment variables

### AWS (ECS)

```bash
# Push to ECR
aws ecr create-repository --repository-name smartpark-ai
docker tag smartpark-ai:latest <account>.dkr.ecr.<region>.amazonaws.com/smartpark-ai
docker push <account>.dkr.ecr.<region>.amazonaws.com/smartpark-ai

# Deploy to ECS with Fargate
```

### GCP (Cloud Run)

```bash
gcloud builds submit --tag gcr.io/PROJECT-ID/smartpark-ai
gcloud run deploy smartpark-ai --image gcr.io/PROJECT-ID/smartpark-ai --port 8000
```

---

## 📁 Project Structure

```
parking_ai/
├── backend/
│   ├── main.py                      # FastAPI entry point
│   ├── config.py                    # Centralized configuration
│   ├── requirements.txt             # Python dependencies
│   ├── spots_config.json            # Parking slot coordinates
│   ├── src/
│   │   ├── data_prep/
│   │   │   ├── dataset.py           # PyTorch Dataset + augmentation
│   │   │   ├── preprocessor.py      # Split + DataLoaders
│   │   │   └── downloader.py        # PKLot download/organize
│   │   ├── models/
│   │   │   ├── cnn_scratch.py       # Custom CNN architecture
│   │   │   ├── cnn_transfer.py      # ResNet18 + MobileNetV2
│   │   │   └── model_factory.py     # Model creation factory
│   │   ├── train/
│   │   │   ├── trainer.py           # Training loop + early stopping
│   │   │   └── train_manager.py     # Background training management
│   │   ├── eval/
│   │   │   ├── evaluator.py         # Metrics computation
│   │   │   └── visualizer.py        # Plots and visualizations
│   │   ├── inference/
│   │   │   ├── classifier.py        # Single-image classifier
│   │   │   ├── slot_detector.py     # Multi-slot detection
│   │   │   ├── video_processor.py   # Real-time video processing
│   │   │   └── demo_processor.py    # Demo mode
│   │   └── utils/
│   │       └── helpers.py           # Shared utilities
│   ├── models/                      # Saved model weights
│   ├── data/                        # Dataset (occupied/vacant)
│   ├── outputs/                     # Training logs, plots
│   └── uploads/                     # User uploaded files
├── frontend/
│   ├── src/
│   │   ├── App.jsx                  # Main app + WebSocket
│   │   ├── index.css                # Design system
│   │   └── components/
│   │       ├── Header.jsx
│   │       ├── VideoFeed.jsx
│   │       ├── MetricCards.jsx
│   │       ├── ControlPanel.jsx
│   │       ├── HeatmapView.jsx
│   │       ├── AnalyticsChart.jsx
│   │       ├── ConfidenceGauge.jsx
│   │       ├── TrainingPanel.jsx
│   │       ├── ModelStatus.jsx
│   │       └── AlertBanner.jsx
│   └── vite.config.js
├── configs/
│   └── model_configs.yaml
├── Dockerfile
├── docker-compose.yml
└── README.md
```

---

## 📊 Model Comparison

| Model | Parameters | Trainable | Accuracy* | Training Speed |
|-------|-----------|-----------|----------|----------------|
| **CNN (Scratch)** | ~1.5M | ~1.5M | ~94% | Medium |
| **ResNet18** | ~11.7M | ~131K | ~97% | Fast |
| **MobileNetV2** | ~3.5M | ~328K | ~96% | Fastest |

*Expected accuracy on PKLot dataset. Actual results depend on dataset size and hardware.

---

## ❌ Common Errors & Fixes

| Error | Fix |
|-------|-----|
| `torch` import error | Ensure Python 3.10+ in venv |
| `cv2` import error | `pip install opencv-python` |
| CUDA out of memory | Reduce `SMARTPARK_BATCH_SIZE` or use CPU |
| No images found | Run dataset preparation first |
| WebSocket won't connect | Start backend before frontend |
| Rate limit exceeded | Wait 1 minute or adjust `UPLOAD_RATE_LIMIT` |

---

## 🔮 Future Improvements

1. **YOLO Integration** — Add YOLOv8 for automatic slot detection (no predefined coordinates)
2. **License Plate Recognition** — Identify specific vehicles
3. **Mobile App** — React Native companion app
4. **Cloud ML Pipeline** — Train on AWS SageMaker / GCP Vertex AI
5. **Multi-Camera Support** — Monitor multiple parking lots simultaneously
6. **Notification System** — Push alerts when parking availability changes
7. **Time-Series Prediction** — Predict future availability using historical data
8. **Edge Deployment** — Run on Raspberry Pi / NVIDIA Jetson

---

## 📜 License

This project is for educational and portfolio purposes.
PKLot dataset: [Creative Commons Attribution 4.0](https://creativecommons.org/licenses/by/4.0/)
