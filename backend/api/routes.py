import os
import uuid
import asyncio
import subprocess
from pathlib import Path
from fastapi import APIRouter, UploadFile, File, HTTPException
from fastapi.responses import StreamingResponse

from services.audio_engine import BassExtractor
from services import job_store

router = APIRouter()

ALLOWED_EXTENSIONS = {".mp3", ".wav", ".flac", ".ogg"}
MAX_FILE_SIZE_MB = 50  # Reduced from 100MB to prevent OOM on free-tier hosting

# ── Concurrency Control ──────────────────────────────────────────────────────
# Limit concurrent jobs to prevent memory thrashing on CPU-only hosting.
# Free-tier environments (HF Spaces, Railway) can only handle 1-2 jobs at a time.
MAX_CONCURRENT_JOBS = int(os.getenv("MAX_CONCURRENT_JOBS", "1"))
job_semaphore = asyncio.Semaphore(MAX_CONCURRENT_JOBS)


def _convert_to_mp3_if_needed(file_path: str) -> str:
    """
    Convert WAV/FLAC to MP3 using ffmpeg to reduce memory footprint.
    WAV/FLAC files are 5-10x larger than MP3 for the same audio.

    Returns: Path to MP3 file (original or converted)
    """
    ext = Path(file_path).suffix.lower()

    # Only convert lossless formats (WAV, FLAC)
    if ext not in {".wav", ".flac"}:
        return file_path

    print(f"[Routes] Converting {ext} to MP3 for faster processing...")
    mp3_path = file_path.replace(ext, ".mp3")

    try:
        result = subprocess.run(
            [
                "ffmpeg",
                "-i", file_path,
                "-b:a", "192k",  # 192 kbps CBR (good quality, smaller than VBR)
                "-ar", "44100",  # 44.1 kHz sample rate
                "-ac", "2",      # Stereo
                "-y",            # Overwrite without asking
                mp3_path
            ],
            capture_output=True,
            text=True,
            timeout=60  # Max 60s for conversion
        )

        if result.returncode != 0:
            print(f"[Routes] FFmpeg conversion failed: {result.stderr}")
            return file_path  # Fall back to original file

        # Remove original file to save disk space
        try:
            os.remove(file_path)
        except OSError:
            pass

        print(f"[Routes] Converted to MP3: {os.path.getsize(mp3_path) / 1024 / 1024:.1f} MB")
        return mp3_path

    except Exception as e:
        print(f"[Routes] Conversion error: {e}")
        return file_path  # Fall back to original


def _run_pipeline(file_path: str, job_id: str, original_filename: str) -> None:
    """
    Blocking pipeline call.
    Runs inside a thread via asyncio.to_thread() so the event loop
    stays free to respond to health checks during long Demucs jobs.
    Pushes progress events to the job store.
    """
    # Pre-convert large lossless files to MP3
    file_path = _convert_to_mp3_if_needed(file_path)

    engine = BassExtractor(file_path)
    try:
        bpm, midi_b64 = engine.process_pipeline(
            progress_callback=lambda pct, msg: job_store.push_event(job_id, pct, msg)
        )
        job_store.store_result(job_id, {
            "bpm": bpm,
            "midi_b64": midi_b64,
            "filename": original_filename,
        })
    except Exception as e:
        error_msg = f"Processing failed: {str(e)}"
        job_store.store_error(job_id, error_msg)
        job_store.push_event(job_id, -1, f"❌ {error_msg}")
    finally:
        engine.cleanup()


@router.post("/process")
async def process(audio_file: UploadFile = File(...)):
    # ── Validate extension ───────────────────────────────────────────────────
    ext = os.path.splitext(audio_file.filename)[-1].lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type: '{ext}'. Allowed: {sorted(ALLOWED_EXTENSIONS)}"
        )

    # ── Safe, collision-proof filename (prevents path-traversal attacks) ─────
    job_id = uuid.uuid4().hex
    safe_filename = f"{job_id}{ext}"
    os.makedirs("temp", exist_ok=True)
    file_path = os.path.join("temp", safe_filename)

    # ── Read and enforce size cap before touching disk ───────────────────────
    content = await audio_file.read()
    if len(content) > MAX_FILE_SIZE_MB * 1024 * 1024:
        raise HTTPException(
            status_code=413,
            detail=f"File too large. Maximum allowed size is {MAX_FILE_SIZE_MB}MB."
        )

    with open(file_path, "wb") as f:
        f.write(content)

    # ── Create job queue and launch background task ──────────────────────────
    job_store.create_job(job_id)

    # Wrap pipeline in semaphore-protected task to limit concurrency
    async def _protected_pipeline():
        async with job_semaphore:
            await asyncio.to_thread(_run_pipeline, file_path, job_id, audio_file.filename)

    asyncio.create_task(_protected_pipeline())

    return {"job_id": job_id}


@router.get("/progress/{job_id}")
async def stream_progress(job_id: str):
    """SSE endpoint — streams real progress events from the pipeline."""
    return StreamingResponse(
        job_store.iter_events(job_id),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",  # critical for nginx/reverse proxies
        },
    )


@router.get("/result/{job_id}")
async def get_result(job_id: str):
    """Fetch the final result after the pipeline completes."""
    error = job_store.get_error(job_id)
    if error:
        job_store.remove_job(job_id)
        raise HTTPException(status_code=500, detail=error)

    result = job_store.get_result(job_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Result not ready or job not found")

    job_store.remove_job(job_id)
    return result