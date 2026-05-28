# ── Stage 1: Build frontend ─────────────────────────────
FROM node:20-slim AS frontend-build
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ── Stage 2: Python backend + static frontend ──────────
FROM python:3.11-slim
WORKDIR /app

# System deps for OpenCV
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1-mesa-glx libglib2.0-0 && \
    rm -rf /var/lib/apt/lists/*

# Python deps
COPY backend/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend code
COPY backend/ ./

# Copy built frontend
COPY --from=frontend-build /app/frontend/dist ./static/

# Create directories
RUN mkdir -p data models outputs uploads

# Expose port
EXPOSE 8000

# Environment
ENV SMARTPARK_HOST=0.0.0.0
ENV SMARTPARK_PORT=8000
ENV SMARTPARK_MODEL=demo

# Run
CMD ["python", "main.py"]
