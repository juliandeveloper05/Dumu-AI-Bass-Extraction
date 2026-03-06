# backend/api/health.py
"""
Health check endpoint with system resource metrics.
Monitors memory and CPU usage for deployment alerting.
"""
import psutil
from fastapi import APIRouter

health_router = APIRouter()


@health_router.get("/health")
async def health():
    """
    Enhanced health endpoint with memory and CPU metrics.
    Use this to set up alerts when memory_percent > 85% in production.
    """
    try:
        mem = psutil.virtual_memory()
        process = psutil.Process()
        process_mem = process.memory_info()

        return {
            "status": "ok",
            "memory": {
                "system": {
                    "total_mb": round(mem.total / 1024 / 1024),
                    "available_mb": round(mem.available / 1024 / 1024),
                    "used_mb": round(mem.used / 1024 / 1024),
                    "percent": round(mem.percent, 1),
                },
                "process": {
                    "rss_mb": round(process_mem.rss / 1024 / 1024),
                    "vms_mb": round(process_mem.vms / 1024 / 1024),
                },
            },
            "cpu": {
                "percent": round(process.cpu_percent(interval=0.1), 1),
                "num_threads": process.num_threads(),
            },
        }
    except Exception as e:
        return {"status": "ok", "error": str(e)}
