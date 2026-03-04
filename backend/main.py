import os
import gc
import psutil
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from api.routes import router as api_router

# ── Memory optimization settings ──────────────────────────────────────────────
# Enable aggressive garbage collection to prevent memory buildup
gc.set_threshold(700, 10, 10)  # More frequent GC (default is 700, 10, 10)

# Set TensorFlow/PyTorch memory growth to avoid pre-allocating GPU memory
# (even though we're on CPU, these env vars prevent accidental CUDA fallback)
os.environ.setdefault("TF_FORCE_GPU_ALLOW_GROWTH", "true")
os.environ.setdefault("CUDA_VISIBLE_DEVICES", "-1")  # Disable CUDA entirely

# Limit OpenMP threads to prevent CPU oversubscription
os.environ.setdefault("OMP_NUM_THREADS", "2")  # Max 2 threads for NumPy/librosa
os.environ.setdefault("MKL_NUM_THREADS", "2")  # Intel MKL (if present)
os.environ.setdefault("OPENBLAS_NUM_THREADS", "2")  # OpenBLAS (if present)

# Ensure temp directory exists at startup
os.makedirs("temp", exist_ok=True)

app = FastAPI(title="Bass Trap API")

# Setup CORS — tighten ALLOWED_ORIGINS via env var in production
origins = os.getenv("ALLOWED_ORIGINS", "*").split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router, prefix="/api")

@app.get("/")
def read_root():
    return {"message": "Bass Trap API is running"}

@app.get("/health")
def health():
    """
    Enhanced health endpoint with memory metrics for monitoring and alerting.
    Use this to set up alerts when memory_percent > 85% in production.
    """
    try:
        # System-wide memory stats
        mem = psutil.virtual_memory()

        # Process-specific memory stats
        process = psutil.Process()
        process_mem = process.memory_info()

        return {
            "status": "ok",
            "memory": {
                "system": {
                    "total_mb": round(mem.total / 1024 / 1024),
                    "available_mb": round(mem.available / 1024 / 1024),
                    "used_mb": round(mem.used / 1024 / 1024),
                    "percent": round(mem.percent, 1)
                },
                "process": {
                    "rss_mb": round(process_mem.rss / 1024 / 1024),  # Resident Set Size
                    "vms_mb": round(process_mem.vms / 1024 / 1024),  # Virtual Memory Size
                }
            },
            "cpu": {
                "percent": round(process.cpu_percent(interval=0.1), 1),
                "num_threads": process.num_threads()
            }
        }
    except Exception as e:
        # Fallback if psutil fails (shouldn't happen, but be defensive)
        return {"status": "ok", "error": str(e)}