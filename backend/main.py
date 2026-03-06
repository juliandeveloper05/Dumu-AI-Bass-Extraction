import os
import gc
import psutil
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from api.routes import router as api_router
from api.ws_routes import ws_router
from api.health import health_router

# ── Memory optimization settings ──────────────────────────────────────────────
gc.set_threshold(700, 10, 10)

os.environ.setdefault("TF_FORCE_GPU_ALLOW_GROWTH", "true")
os.environ.setdefault("CUDA_VISIBLE_DEVICES", "-1")
os.environ.setdefault("OMP_NUM_THREADS", "2")
os.environ.setdefault("MKL_NUM_THREADS", "2")
os.environ.setdefault("OPENBLAS_NUM_THREADS", "2")

# Ensure temp directory exists at startup
os.makedirs("temp", exist_ok=True)

app = FastAPI(title="Bass Trap API", version="2.0.0")

# Setup CORS
origins = os.getenv("ALLOWED_ORIGINS", "*").split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Route registration ────────────────────────────────────────────────────────
# Legacy SSE-based endpoints (POST /api/process, GET /api/progress/{id}, GET /api/result/{id})
app.include_router(api_router, prefix="/api")

# New WebSocket endpoints (WS /api/ws/process, WS /api/ws/multi-stem)
app.include_router(ws_router, prefix="/api/ws")

# Health endpoint (GET /api/health)
app.include_router(health_router, prefix="/api")


@app.get("/")
def read_root():
    return {"message": "Bass Trap API is running", "version": "2.0.0"}