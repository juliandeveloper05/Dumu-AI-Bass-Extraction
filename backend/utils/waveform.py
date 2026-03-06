# backend/utils/waveform.py
"""
Audio waveform peak extraction for frontend visualization.
Uses RMS-based downsampling to produce a compact array of peak values
suitable for canvas rendering.
"""
import gc
import numpy as np
import librosa


def extract_waveform_peaks(
    audio_path: str,
    num_points: int = 2000,
    sr: int = 22050,
) -> dict:
    """
    Extract waveform peak data from an audio file using RMS-based downsampling.

    The audio is loaded at a low sample rate (22050 Hz mono), segmented into
    `num_points` equal chunks, and the RMS amplitude of each chunk is computed.
    Values are normalized to [0.0, 1.0].

    Args:
        audio_path: Path to the audio file.
        num_points: Number of output peak values (default 2000).
        sr: Sample rate for loading (default 22050 Hz).

    Returns:
        dict with keys:
            peaks: list[float] — normalized RMS peak values (0.0 to 1.0).
            duration: float — total audio duration in seconds.
            sample_rate: int — the sample rate used for loading.
    """
    y, actual_sr = librosa.load(audio_path, sr=sr, mono=True, res_type="kaiser_fast")
    duration = len(y) / actual_sr

    # Segment the audio into num_points equal chunks
    total_samples = len(y)
    if total_samples < num_points:
        num_points = total_samples

    chunk_size = total_samples // num_points
    if chunk_size == 0:
        chunk_size = 1
        num_points = total_samples

    # Truncate to exact multiple of chunk_size for reshape
    usable_samples = chunk_size * num_points
    y_trimmed = y[:usable_samples]

    # Reshape and compute RMS per chunk
    chunks = y_trimmed.reshape(num_points, chunk_size)
    rms = np.sqrt(np.mean(chunks ** 2, axis=1))

    # Normalize to [0, 1]
    max_rms = rms.max()
    if max_rms > 0:
        peaks = (rms / max_rms).tolist()
    else:
        peaks = [0.0] * num_points

    # Cleanup
    del y, y_trimmed, chunks, rms
    gc.collect()

    return {
        "peaks": peaks,
        "duration": round(duration, 3),
        "sample_rate": actual_sr,
    }
