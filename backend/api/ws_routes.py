# backend/api/ws_routes.py
"""
WebSocket endpoints for real-time audio processing with progress streaming.

WS /api/ws/process    — Single-stem bass extraction with live progress
WS /api/ws/multi-stem — Multi-stem extraction (bass, drums, vocals, other)

Protocol:
  1. Client sends binary audio data as the first message.
  2. Client sends JSON config as the second message:
     {"filename": "track.mp3", "quantization": "1/16", "onset_threshold": 0.6, ...}
  3. Server streams progress frames: {"type": "progress", "stage": ..., "progress": ..., "message": ...}
  4. Server sends result frame: {"type": "result", ...} or {"type": "error", "message": ...}
  5. Client can send {"type": "cancel"} at any time to abort processing.
"""
import os
import asyncio
import shutil
import gc
from typing import Optional

from fastapi import APIRouter, WebSocket

from services.ws_manager import WebSocketManager
from services.audio_engine import BassExtractor
from services.cancellation import CancellationToken, CancellationError
from services.spectrogram_engine import SpectrogramEngine
from utils.validators import validate_file_extension, validate_file_size, validate_parameters
from utils.waveform import extract_waveform_peaks

ws_router = APIRouter()

# Concurrency limiter — matches the legacy POST endpoint
MAX_CONCURRENT_JOBS = int(os.getenv("MAX_CONCURRENT_JOBS", "1"))
_ws_semaphore = asyncio.Semaphore(MAX_CONCURRENT_JOBS)


async def _listen_for_cancel(
    manager: WebSocketManager,
    token: CancellationToken,
) -> None:
    """
    Background task that listens for cancel messages from the client.
    Runs concurrently with the pipeline.
    """
    while manager.is_connected:
        try:
            msg = await manager.receive_json()
            if msg is None:
                # Client disconnected
                token.cancel()
                return
            if isinstance(msg, dict) and msg.get("type") == "cancel":
                print(f"[WS:{manager.session_id}] Cancel requested by client.")
                token.cancel()
                return
        except Exception:
            return


@ws_router.websocket("/process")
async def ws_process(websocket: WebSocket):
    """
    WebSocket endpoint for single-stem bass extraction with live progress.

    Flow:
      1. Receive binary audio data
      2. Receive JSON config
      3. Run pipeline with progress streaming
      4. Send result or error
    """
    manager = WebSocketManager(websocket)
    await manager.accept()
    cancellation_token = CancellationToken()
    file_path: Optional[str] = None

    try:
        # Step 1: Receive audio binary
        audio_data = await manager.receive_bytes()
        if audio_data is None:
            await manager.send_error("No audio data received.")
            return

        # Step 2: Receive config JSON
        config = await manager.receive_json()
        if config is None:
            config = {}

        filename = config.get("filename", "upload.mp3")

        # Validate file extension
        try:
            ext = validate_file_extension(filename)
        except ValueError as e:
            await manager.send_error(str(e))
            return

        # Validate file size
        try:
            validate_file_size(audio_data)
        except ValueError as e:
            await manager.send_error(str(e))
            return

        # Validate and extract parameters
        try:
            params = validate_parameters(config)
        except ValueError as e:
            await manager.send_error(str(e))
            return

        # Save to temp file
        file_path = os.path.join(manager.temp_dir, f"{manager.session_id}{ext}")
        with open(file_path, "wb") as f:
            f.write(audio_data)

        # Extract pipeline parameters
        quantization = params.get("quantization", config.get("quantization", "1/16"))
        freq_range = params.get("frequency_range", {})

        await manager.send_progress("initializing", 0.0, "Initializing pipeline...")

        # Start cancel listener
        cancel_task = asyncio.create_task(
            _listen_for_cancel(manager, cancellation_token)
        )

        # Create progress callback that sends WS messages from the worker thread
        loop = asyncio.get_running_loop()

        def progress_callback(stage: str, progress: float, message: str):
            """Thread-safe progress callback using loop.call_soon_threadsafe."""
            if not manager.is_connected or cancellation_token.is_cancelled:
                return
            asyncio.run_coroutine_threadsafe(
                manager.send_progress(stage, progress, message),
                loop,
            )

        # Run pipeline in thread pool (blocking I/O)
        async with _ws_semaphore:
            try:
                result = await asyncio.to_thread(
                    _run_ws_pipeline,
                    file_path,
                    cancellation_token,
                    progress_callback,
                    quantization,
                    params,
                )
            except CancellationError:
                await manager.send_error("Processing cancelled by user.")
                return

        # Cancel the listener
        cancel_task.cancel()
        try:
            await cancel_task
        except asyncio.CancelledError:
            pass

        if cancellation_token.is_cancelled:
            await manager.send_error("Processing cancelled by user.")
            return

        # Compute waveform data
        try:
            await manager.send_progress("waveform", 0.96, "Computing waveform data...")
            waveform_data = await asyncio.to_thread(
                extract_waveform_peaks, file_path
            )
        except Exception as e:
            print(f"[WS:{manager.session_id}] Waveform extraction failed: {e}")
            waveform_data = None

        # Compute spectrogram data
        spectrogram_data = None
        bass_path = result.get("_bass_path")
        if bass_path and os.path.exists(bass_path):
            try:
                await manager.send_progress("spectrogram", 0.98, "Computing spectrogram...")
                spec_engine = SpectrogramEngine()
                spectrogram_data = await asyncio.to_thread(
                    spec_engine.compute_pair, file_path, bass_path
                )
            except Exception as e:
                print(f"[WS:{manager.session_id}] Spectrogram computation failed: {e}")

        # Build and send result
        result_data = {
            "bpm": result["bpm"],
            "midi_b64": result["midi_b64"],
            "bass_audio_b64": result.get("bass_audio_b64"),
            "filename": filename,
        }
        if waveform_data:
            result_data["waveform_data"] = waveform_data
        if spectrogram_data:
            result_data["spectrogram_data"] = spectrogram_data

        await manager.send_result(result_data)

    except CancellationError:
        await manager.send_error("Processing cancelled by user.")
    except Exception as e:
        print(f"[WS:{manager.session_id}] Unhandled error: {e}")
        await manager.send_error(f"Processing failed: {str(e)}")
    finally:
        # Cleanup temp directory
        if os.path.exists(manager.temp_dir):
            shutil.rmtree(manager.temp_dir, ignore_errors=True)
        await manager.close()
        gc.collect()


@ws_router.websocket("/multi-stem")
async def ws_multi_stem(websocket: WebSocket):
    """
    WebSocket endpoint for multi-stem extraction.
    Same protocol as /process but returns all 4 Demucs stems.
    """
    manager = WebSocketManager(websocket)
    await manager.accept()
    cancellation_token = CancellationToken()

    try:
        # Step 1: Receive audio binary
        audio_data = await manager.receive_bytes()
        if audio_data is None:
            await manager.send_error("No audio data received.")
            return

        # Step 2: Receive config JSON
        config = await manager.receive_json()
        if config is None:
            config = {}

        filename = config.get("filename", "upload.mp3")

        try:
            ext = validate_file_extension(filename)
        except ValueError as e:
            await manager.send_error(str(e))
            return

        try:
            validate_file_size(audio_data)
        except ValueError as e:
            await manager.send_error(str(e))
            return

        try:
            params = validate_parameters(config)
        except ValueError as e:
            await manager.send_error(str(e))
            return

        file_path = os.path.join(manager.temp_dir, f"{manager.session_id}{ext}")
        with open(file_path, "wb") as f:
            f.write(audio_data)

        quantization = params.get("quantization", config.get("quantization", "1/16"))

        await manager.send_progress("initializing", 0.0, "Initializing multi-stem pipeline...")

        cancel_task = asyncio.create_task(
            _listen_for_cancel(manager, cancellation_token)
        )

        loop = asyncio.get_running_loop()

        def progress_callback(stage: str, progress: float, message: str):
            if not manager.is_connected or cancellation_token.is_cancelled:
                return
            asyncio.run_coroutine_threadsafe(
                manager.send_progress(stage, progress, message),
                loop,
            )

        async with _ws_semaphore:
            try:
                result = await asyncio.to_thread(
                    _run_multi_stem_pipeline,
                    file_path,
                    cancellation_token,
                    progress_callback,
                    quantization,
                    params,
                )
            except CancellationError:
                await manager.send_error("Processing cancelled by user.")
                return

        cancel_task.cancel()
        try:
            await cancel_task
        except asyncio.CancelledError:
            pass

        if cancellation_token.is_cancelled:
            await manager.send_error("Processing cancelled by user.")
            return

        await manager.send_multi_result({
            "bpm": result["bpm"],
            "stems": result["stems"],
            "filename": filename,
        })

    except CancellationError:
        await manager.send_error("Processing cancelled by user.")
    except Exception as e:
        print(f"[WS:{manager.session_id}] Multi-stem error: {e}")
        await manager.send_error(f"Multi-stem processing failed: {str(e)}")
    finally:
        if os.path.exists(manager.temp_dir):
            shutil.rmtree(manager.temp_dir, ignore_errors=True)
        await manager.close()
        gc.collect()


# ── Pipeline runners (blocking, run in thread pool) ──────────────────────────


def _run_ws_pipeline(
    file_path: str,
    cancellation_token: CancellationToken,
    progress_callback,
    quantization: str,
    params: dict,
) -> dict:
    """
    Run the single-stem bass extraction pipeline.
    Called from asyncio.to_thread() — this is blocking code.
    """
    freq_range = params.get("frequency_range", {})

    engine = BassExtractor(
        file_path,
        cancellation_token=cancellation_token,
        onset_threshold=params.get("onset_threshold"),
        frame_threshold=params.get("frame_threshold"),
        minimum_note_length_ms=params.get("minimum_note_length_ms"),
        frequency_range_min=freq_range.get("min_hz"),
        frequency_range_max=freq_range.get("max_hz"),
        pitch_confidence_threshold=params.get("pitch_confidence_threshold"),
    )

    try:
        result = engine.process_pipeline_ws(
            progress_callback=progress_callback,
            quantization=quantization,
        )
        # Include bass_path for spectrogram computation
        result["_bass_path"] = engine.bass_path
        return result
    except CancellationError:
        raise
    except Exception:
        raise
    finally:
        # Don't cleanup the input file — it's needed for waveform/spectrogram
        # The temp_dir cleanup in the WS handler's finally block handles everything
        if os.path.exists(engine.demucs_out_dir):
            # Keep bass.wav alive for spectrogram, cleanup happens in WS finally
            pass


def _run_multi_stem_pipeline(
    file_path: str,
    cancellation_token: CancellationToken,
    progress_callback,
    quantization: str,
    params: dict,
) -> dict:
    """
    Run the multi-stem extraction pipeline.
    Called from asyncio.to_thread() — this is blocking code.
    """
    freq_range = params.get("frequency_range", {})

    engine = BassExtractor(
        file_path,
        cancellation_token=cancellation_token,
        onset_threshold=params.get("onset_threshold"),
        frame_threshold=params.get("frame_threshold"),
        minimum_note_length_ms=params.get("minimum_note_length_ms"),
        frequency_range_min=freq_range.get("min_hz"),
        frequency_range_max=freq_range.get("max_hz"),
        pitch_confidence_threshold=params.get("pitch_confidence_threshold"),
    )

    try:
        return engine.process_multi_stem_pipeline(
            progress_callback=progress_callback,
            quantization=quantization,
        )
    except CancellationError:
        raise
    except Exception:
        raise
