# backend/services/spectrogram_engine.py
"""
Mel spectrogram computation service for audio visualization.

Computes mel spectrograms of both the original audio and the isolated bass
stem, returning compact 2D arrays suitable for frontend heatmap rendering.
"""
import gc
import numpy as np
import librosa


class SpectrogramEngine:
    """
    Compute mel spectrograms from audio files for frontend visualization.

    The spectrogram is computed using librosa's mel filterbank, converted
    to dB scale, and downsampled along the time axis to keep the payload
    compact for WebSocket transmission.
    """

    def __init__(self, n_mels: int = 128, sr: int = 22050):
        """
        Args:
            n_mels: Number of mel frequency bands.
            sr: Sample rate to load audio at.
        """
        self.n_mels = n_mels
        self.sr = sr

    def compute(
        self,
        audio_path: str,
        fmax: int = 8000,
        max_time_frames: int = 500,
    ) -> dict:
        """
        Compute a mel spectrogram from an audio file.

        Args:
            audio_path: Path to the audio file.
            fmax: Maximum frequency for the mel filterbank (Hz).
                  Use 8000 for full-range audio, 500 for bass-only.
            max_time_frames: Maximum number of time frames in the output.
                             The spectrogram is downsampled if it exceeds this.

        Returns:
            dict with keys:
                data: list[list[float]] — 2D mel spectrogram in dB
                      (shape: [n_mels, time_frames]).
                sr: int — sample rate used.
                hop_length: int — hop length used for STFT.
                fmax: int — maximum frequency.
                n_mels: int — number of mel bands.
                duration: float — audio duration in seconds.
        """
        # Load audio
        y, sr = librosa.load(audio_path, sr=self.sr, mono=True, res_type="kaiser_fast")
        duration = len(y) / sr

        # Compute mel spectrogram
        hop_length = 512
        S = librosa.feature.melspectrogram(
            y=y,
            sr=sr,
            n_mels=self.n_mels,
            fmax=fmax,
            hop_length=hop_length,
            n_fft=2048,
        )

        # Convert to dB scale
        S_db = librosa.power_to_db(S, ref=np.max)

        # Downsample time axis if needed
        n_time = S_db.shape[1]
        if n_time > max_time_frames:
            # Use simple column-stride downsampling
            stride = n_time // max_time_frames
            S_db = S_db[:, ::stride][:, :max_time_frames]

        # Convert to Python lists for JSON serialization
        # Normalize to [0, 1] range for frontend colormap
        s_min = S_db.min()
        s_max = S_db.max()
        if s_max > s_min:
            S_norm = ((S_db - s_min) / (s_max - s_min)).tolist()
        else:
            S_norm = np.zeros_like(S_db).tolist()

        # Round values to reduce JSON payload size
        data = [[round(v, 3) for v in row] for row in S_norm]

        # Cleanup
        del y, S, S_db
        gc.collect()

        return {
            "data": data,
            "sr": sr,
            "hop_length": hop_length,
            "fmax": fmax,
            "n_mels": self.n_mels,
            "duration": round(duration, 3),
        }

    def compute_pair(
        self,
        original_path: str,
        bass_path: str,
        max_time_frames: int = 500,
    ) -> dict:
        """
        Compute spectrograms for both original and bass-isolated audio.

        Args:
            original_path: Path to the original audio file.
            bass_path: Path to the isolated bass stem.
            max_time_frames: Maximum time frames per spectrogram.

        Returns:
            dict with keys:
                original: dict — spectrogram of original (fmax=8000).
                bass: dict — spectrogram of bass stem (fmax=500).
        """
        original_spec = self.compute(
            original_path, fmax=8000, max_time_frames=max_time_frames
        )
        bass_spec = self.compute(
            bass_path, fmax=500, max_time_frames=max_time_frames
        )

        return {
            "original": original_spec,
            "bass": bass_spec,
        }
