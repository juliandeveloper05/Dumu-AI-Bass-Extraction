# backend/utils/validators.py
"""
Validation utilities for file uploads and Basic Pitch inference parameters.
Used by both the legacy POST endpoint and the new WebSocket endpoints.
"""
import os
from typing import Any


ALLOWED_EXTENSIONS = {".mp3", ".wav", ".flac", ".ogg"}
MAX_FILE_SIZE_MB = 50


def validate_file_extension(filename: str) -> str:
    """
    Validate that the file has an allowed audio extension.

    Args:
        filename: Original filename from the upload.

    Returns:
        Lowercased extension string (e.g., ".mp3").

    Raises:
        ValueError: If the extension is not in ALLOWED_EXTENSIONS.
    """
    ext = os.path.splitext(filename)[-1].lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise ValueError(
            f"Unsupported file type: '{ext}'. "
            f"Allowed: {sorted(ALLOWED_EXTENSIONS)}"
        )
    return ext


def validate_file_size(content: bytes, max_mb: int = MAX_FILE_SIZE_MB) -> None:
    """
    Validate that file content does not exceed the maximum size.

    Args:
        content: Raw bytes of the uploaded file.
        max_mb: Maximum allowed size in megabytes.

    Raises:
        ValueError: If content exceeds max_mb.
    """
    size_mb = len(content) / (1024 * 1024)
    if size_mb > max_mb:
        raise ValueError(
            f"File too large ({size_mb:.1f}MB). Maximum allowed: {max_mb}MB."
        )


def validate_parameters(params: dict[str, Any]) -> dict[str, Any]:
    """
    Validate and clamp Basic Pitch inference parameters to safe ranges.

    Accepted keys (all optional):
        onset_threshold:         float [0.1, 0.9]
        frame_threshold:         float [0.1, 0.9]
        minimum_note_length_ms:  float [10, 500]
        pitch_confidence_threshold: float [0.1, 0.99]
        frequency_range:         dict with min_hz [20, 2000] and max_hz [20, 2000]
        quantization:            str in {"none", "1/4", "1/8", "1/16"}

    Args:
        params: Raw parameter dict from the client.

    Returns:
        Validated and clamped parameter dict.

    Raises:
        ValueError: If quantization value is invalid.
    """
    validated = {}

    # Float parameters with [min, max] ranges
    float_ranges = {
        "onset_threshold": (0.1, 0.9),
        "frame_threshold": (0.1, 0.9),
        "minimum_note_length_ms": (10.0, 500.0),
        "pitch_confidence_threshold": (0.1, 0.99),
    }

    for key, (lo, hi) in float_ranges.items():
        if key in params and params[key] is not None:
            try:
                val = float(params[key])
                validated[key] = max(lo, min(hi, val))
            except (TypeError, ValueError):
                pass  # Skip invalid values, use defaults

    # Frequency range
    if "frequency_range" in params and isinstance(params["frequency_range"], dict):
        freq = params["frequency_range"]
        fr_validated = {}
        if "min_hz" in freq:
            try:
                fr_validated["min_hz"] = max(20.0, min(2000.0, float(freq["min_hz"])))
            except (TypeError, ValueError):
                pass
        if "max_hz" in freq:
            try:
                fr_validated["max_hz"] = max(20.0, min(2000.0, float(freq["max_hz"])))
            except (TypeError, ValueError):
                pass
        # Ensure min < max
        if "min_hz" in fr_validated and "max_hz" in fr_validated:
            if fr_validated["min_hz"] >= fr_validated["max_hz"]:
                fr_validated["min_hz"], fr_validated["max_hz"] = (
                    fr_validated["max_hz"],
                    fr_validated["min_hz"],
                )
        if fr_validated:
            validated["frequency_range"] = fr_validated

    # Quantization
    valid_quantizations = {"none", "1/4", "1/8", "1/16"}
    if "quantization" in params:
        q = str(params["quantization"])
        if q not in valid_quantizations:
            raise ValueError(
                f"Invalid quantization: '{q}'. "
                f"Allowed: {sorted(valid_quantizations)}"
            )
        validated["quantization"] = q

    return validated
