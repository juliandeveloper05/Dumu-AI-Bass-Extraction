FROM python:3.11-slim

# ── Python optimization flags ─────────────────────────────────────────────────
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV PIP_NO_CACHE_DIR=1
ENV PIP_DISABLE_PIP_VERSION_CHECK=1

# ── Memory & CPU optimization flags ───────────────────────────────────────────
# Disable CUDA to prevent GPU initialization overhead
ENV CUDA_VISIBLE_DEVICES=-1
ENV TF_FORCE_GPU_ALLOW_GROWTH=true

# Limit thread pools to prevent CPU oversubscription
ENV OMP_NUM_THREADS=2
ENV MKL_NUM_THREADS=2
ENV OPENBLAS_NUM_THREADS=2

# Enable Python's malloc debug hooks (helps catch memory leaks in dev)
# ENV PYTHONMALLOC=debug  # Uncomment for debugging only

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    libsndfile1 \
    git \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*

WORKDIR /app

# Torch CPU mínimo
RUN pip install --no-cache-dir \
    torch==2.1.2+cpu \
    torchaudio==2.1.2+cpu \
    --index-url https://download.pytorch.org/whl/cpu \
    && find /usr/local/lib -name "*.pyc" -delete \
    && find /usr/local/lib -name "__pycache__" -type d -exec rm -rf {} + 2>/dev/null || true

COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt \
    && find /usr/local/lib -name "*.pyc" -delete \
    && find /usr/local/lib -name "__pycache__" -type d -exec rm -rf {} + 2>/dev/null || true

COPY backend/ .
RUN mkdir -p temp

# Pre-download Demucs model at build time (avoids ~80MB download on each cold start)
RUN python -c "from demucs.pretrained import get_model; get_model('htdemucs')" 2>/dev/null || true

EXPOSE 7860

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "7860", "--timeout-keep-alive", "300"]
