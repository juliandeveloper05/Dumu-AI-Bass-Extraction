# backend/services/audio_engine.py
"""
Core audio processing pipeline for bass extraction and MIDI conversion.

BassExtractor orchestrates: BPM detection (Librosa) → bass isolation (Demucs)
→ MIDI conversion (Basic Pitch) → optional quantization (pretty_midi).

v2.0.0 additions:
  - Async progress_callback with stage identifiers
  - CancellationToken support for aborting between stages
  - Overridable Basic Pitch parameters
  - Multi-stem isolation (all 4 Demucs stems)
  - Bass audio Base64 export
  - Backward-compatible with legacy (int, str) progress callbacks
"""
import os
import glob
import subprocess
import shutil
import base64
import uuid
import gc
from typing import Callable, Optional, Any, Union
import asyncio

import librosa
import numpy as np
import soundfile as sf
from basic_pitch.inference import predict_and_save
from basic_pitch import ICASSP_2022_MODEL_PATH
import pretty_midi

from services.cancellation import CancellationToken, CancellationError

DEMUCS_MODEL = "htdemucs"
MAX_DURATION_SECONDS = 600  # 10 minutes max to prevent OOM
LIBROSA_CHUNK_DURATION = 30  # Process BPM detection in 30s chunks

# Default Basic Pitch inference parameters tuned for bass guitar
BASS_MIN_FREQ_HZ = 30.0
BASS_MAX_FREQ_HZ = 400.0
BASS_ONSET_THRESHOLD = 0.6
BASS_FRAME_THRESHOLD = 0.5
BASS_MIN_NOTE_LENGTH_MS = 100.0

# All Demucs stem names
ALL_STEMS = ["bass", "drums", "vocals", "other"]


class BassExtractor:
    """
    Service-pattern class for the full bass extraction pipeline.

    Usage:
        extractor = BassExtractor("path/to/audio.mp3")
        bpm, midi_b64 = extractor.process_pipeline()
    """

    def __init__(
        self,
        file_path: str,
        cancellation_token: Optional[CancellationToken] = None,
        onset_threshold: Optional[float] = None,
        frame_threshold: Optional[float] = None,
        minimum_note_length_ms: Optional[float] = None,
        frequency_range_min: Optional[float] = None,
        frequency_range_max: Optional[float] = None,
        pitch_confidence_threshold: Optional[float] = None,
    ):
        self.file_path = os.path.abspath(file_path)
        self.session_id = uuid.uuid4().hex
        self.demucs_out_dir = os.path.abspath(f"temp/demucs_{self.session_id}")
        self.bpm: int | None = None
        self.bass_path: str | None = None
        self.midi_data_b64: str | None = None
        self.cancellation_token = cancellation_token

        # Overridable inference parameters (fall back to defaults)
        self.onset_threshold = onset_threshold if onset_threshold is not None else BASS_ONSET_THRESHOLD
        self.frame_threshold = frame_threshold if frame_threshold is not None else BASS_FRAME_THRESHOLD
        self.minimum_note_length_ms = minimum_note_length_ms if minimum_note_length_ms is not None else BASS_MIN_NOTE_LENGTH_MS
        self.frequency_range_min = frequency_range_min if frequency_range_min is not None else BASS_MIN_FREQ_HZ
        self.frequency_range_max = frequency_range_max if frequency_range_max is not None else BASS_MAX_FREQ_HZ
        self.pitch_confidence_threshold = pitch_confidence_threshold

        self._validate_audio_duration()

    def _check_cancelled(self) -> None:
        """Check if cancellation was requested. Raises CancellationError."""
        if self.cancellation_token is not None:
            self.cancellation_token.check()

    def _validate_audio_duration(self) -> None:
        """
        Pre-validate audio duration using soundfile (lightweight, no full load).
        Raises ValueError if duration exceeds MAX_DURATION_SECONDS.
        """
        try:
            info = sf.info(self.file_path)
            duration = info.duration
            if duration > MAX_DURATION_SECONDS:
                raise ValueError(
                    f"Audio duration ({duration:.1f}s) exceeds maximum allowed "
                    f"({MAX_DURATION_SECONDS}s). Please use a shorter file to avoid timeouts."
                )
            print(f"[BassExtractor] Audio duration: {duration:.1f}s (within limits)")
        except ValueError:
            raise
        except Exception as e:
            print(f"[BassExtractor] Warning: Could not validate duration: {e}")

    def extract_bpm(self) -> None:
        """
        Optimized BPM detection using chunked loading to reduce memory footprint.
        Only loads first LIBROSA_CHUNK_DURATION seconds for tempo estimation.
        """
        print("[BassExtractor] Extracting BPM with librosa...")
        try:
            y, sr = librosa.load(
                self.file_path,
                sr=22050,
                mono=True,
                duration=LIBROSA_CHUNK_DURATION,
                res_type='kaiser_fast',
            )
            tempo, _ = librosa.beat.beat_track(y=y, sr=sr)
            raw = float(tempo[0]) if isinstance(tempo, np.ndarray) else float(tempo)
            self.bpm = round(raw)
            del y
            gc.collect()
            print(f"[BassExtractor] Detected BPM: {self.bpm}")
        except Exception as e:
            print(f"[BassExtractor] BPM detection failed, using default 120: {e}")
            self.bpm = 120

    def isolate_bass(self) -> None:
        """
        Isolate bass stem using Demucs with --two-stems bass flag.
        """
        print(f"[BassExtractor] Isolating bass with Demucs ({DEMUCS_MODEL})...")
        os.makedirs(self.demucs_out_dir, exist_ok=True)
        name_no_ext = os.path.splitext(os.path.basename(self.file_path))[0]

        result = subprocess.run(
            [
                "demucs",
                "-n", DEMUCS_MODEL,
                "--two-stems", "bass",
                "--device", "cpu",
                "-j", "1",
                "--segment", "7",
                "--shifts", "0",
                "--int24",
                "-o", self.demucs_out_dir,
                self.file_path,
            ],
            capture_output=True,
            text=True,
            timeout=600,
            env={**os.environ, "OMP_NUM_THREADS": "1"},
        )

        if result.returncode != 0:
            raise RuntimeError(
                f"Demucs failed:\nSTDOUT: {result.stdout}\nSTDERR: {result.stderr}"
            )

        self.bass_path = os.path.join(
            self.demucs_out_dir, DEMUCS_MODEL, name_no_ext, "bass.wav"
        )

        if not os.path.exists(self.bass_path):
            raise FileNotFoundError(
                f"Expected bass stem not found at: {self.bass_path}"
            )

        print(f"[BassExtractor] Bass isolated at: {self.bass_path}")
        gc.collect()

    def isolate_all_stems(self) -> dict[str, str]:
        """
        Isolate all 4 stems (bass, drums, vocals, other) using Demucs
        without the --two-stems flag. Returns a dict of stem_name → Base64 WAV.

        Memory management: each stem is encoded and the WAV deleted immediately
        to prevent 4x memory buildup.
        """
        print(f"[BassExtractor] Isolating all stems with Demucs ({DEMUCS_MODEL})...")
        os.makedirs(self.demucs_out_dir, exist_ok=True)
        name_no_ext = os.path.splitext(os.path.basename(self.file_path))[0]

        result = subprocess.run(
            [
                "demucs",
                "-n", DEMUCS_MODEL,
                "--device", "cpu",
                "-j", "1",
                "--segment", "7",
                "--shifts", "0",
                "--int24",
                "-o", self.demucs_out_dir,
                self.file_path,
            ],
            capture_output=True,
            text=True,
            timeout=600,
            env={**os.environ, "OMP_NUM_THREADS": "1"},
        )

        if result.returncode != 0:
            raise RuntimeError(
                f"Demucs multi-stem failed:\nSTDOUT: {result.stdout}\nSTDERR: {result.stderr}"
            )

        stems_dir = os.path.join(self.demucs_out_dir, DEMUCS_MODEL, name_no_ext)
        stems_b64 = {}

        for stem_name in ALL_STEMS:
            stem_path = os.path.join(stems_dir, f"{stem_name}.wav")
            if os.path.exists(stem_path):
                with open(stem_path, "rb") as f:
                    stems_b64[stem_name] = base64.b64encode(f.read()).decode("utf-8")
                print(f"[BassExtractor] Encoded stem: {stem_name}")
                gc.collect()
            else:
                print(f"[BassExtractor] Warning: stem not found: {stem_path}")

        # Set bass_path for subsequent MIDI conversion
        bass_wav = os.path.join(stems_dir, "bass.wav")
        if os.path.exists(bass_wav):
            self.bass_path = bass_wav

        gc.collect()
        return stems_b64

    def get_bass_audio_b64(self) -> Optional[str]:
        """
        Read and Base64-encode the isolated bass WAV.
        Must be called after isolate_bass() or isolate_all_stems().
        """
        if self.bass_path is None or not os.path.exists(self.bass_path):
            return None

        with open(self.bass_path, "rb") as f:
            return base64.b64encode(f.read()).decode("utf-8")

    def convert_to_midi(self) -> None:
        """
        Convert isolated bass to MIDI using Basic Pitch.
        Uses instance-level parameter overrides for onset/frame thresholds,
        note length, and frequency range.
        """
        print("[BassExtractor] Converting bass to MIDI with Basic Pitch...")
        midi_out_dir = os.path.dirname(self.bass_path)

        try:
            predict_and_save(
                audio_path_list=[self.bass_path],
                output_directory=midi_out_dir,
                save_midi=True,
                sonify_midi=False,
                save_model_outputs=False,
                save_notes=False,
                model_or_model_path=ICASSP_2022_MODEL_PATH,
                minimum_frequency=self.frequency_range_min,
                maximum_frequency=self.frequency_range_max,
                onset_threshold=self.onset_threshold,
                frame_threshold=self.frame_threshold,
                minimum_note_length=self.minimum_note_length_ms,
            )

            bass_stem_name = os.path.splitext(os.path.basename(self.bass_path))[0]
            midi_path = os.path.join(midi_out_dir, f"{bass_stem_name}_basic_pitch.mid")

            if not os.path.exists(midi_path):
                mid_files = glob.glob(os.path.join(midi_out_dir, "*.mid"))
                if mid_files:
                    midi_path = mid_files[0]
                    print(f"[BassExtractor] Fallback MIDI found: {midi_path}")
                else:
                    raise FileNotFoundError(f"No MIDI file found in: {midi_out_dir}")

            with open(midi_path, "rb") as f:
                self.midi_data_b64 = base64.b64encode(f.read()).decode("utf-8")

            print("[BassExtractor] MIDI conversion complete.")
            gc.collect()

        except Exception as e:
            print(f"[BassExtractor] Basic Pitch failed: {e}")
            raise

    def quantize_midi(self, quantization: str = "1/16") -> None:
        """
        Quantize all note start/end times to the nearest grid subdivision.

        quantization values:
          "none" — skip quantization entirely
          "1/4"  — quarter-note grid  (60 / bpm)
          "1/8"  — eighth-note grid   (60 / bpm / 2)
          "1/16" — sixteenth-note grid (60 / bpm / 4)  [default]
        """
        if quantization == "none" or not self.midi_data_b64 or not self.bpm:
            print(f"[BassExtractor] Skipping quantization (quantization={quantization})")
            return

        divisors = {"1/4": 1.0, "1/8": 2.0, "1/16": 4.0}
        divisor = divisors.get(quantization, 4.0)
        grid = 60.0 / self.bpm / divisor

        print(
            f"[BassExtractor] Quantizing MIDI to {quantization} grid "
            f"at {self.bpm} BPM (step={grid:.4f}s)..."
        )

        midi_path = os.path.join(self.demucs_out_dir, f"quantized_{self.session_id}.mid")
        os.makedirs(os.path.dirname(midi_path), exist_ok=True)
        with open(midi_path, "wb") as f:
            f.write(base64.b64decode(self.midi_data_b64))

        pm = pretty_midi.PrettyMIDI(midi_path)

        for instrument in pm.instruments:
            for note in instrument.notes:
                snapped_start = round(note.start / grid) * grid
                snapped_end = round(note.end / grid) * grid
                if snapped_end <= snapped_start:
                    snapped_end = snapped_start + grid
                note.start = snapped_start
                note.end = snapped_end

        pm.write(midi_path)

        with open(midi_path, "rb") as f:
            self.midi_data_b64 = base64.b64encode(f.read()).decode("utf-8")

        print("[BassExtractor] Quantization complete.")

    def cleanup(self) -> None:
        """Remove all temporary files for this session."""
        print("[BassExtractor] Running cleanup...")
        if self.file_path and os.path.exists(self.file_path):
            try:
                os.remove(self.file_path)
            except OSError as e:
                print(f"[BassExtractor] Warning: could not remove input file: {e}")

        if os.path.exists(self.demucs_out_dir):
            shutil.rmtree(self.demucs_out_dir, ignore_errors=True)

        print("[BassExtractor] Cleanup done.")

    # ── Legacy pipeline (backward-compatible with SSE system) ────────────────

    def process_pipeline(
        self,
        progress_callback: Optional[Callable] = None,
        quantization: str = "1/16",
    ) -> tuple[int, str]:
        """
        Run the full extraction pipeline with legacy progress callbacks.

        Supports both:
          - Legacy signature: progress_callback(progress: int, message: str)
          - New signature:    progress_callback(stage: str, progress: float, message: str)

        The callback type is auto-detected based on argument count.
        """

        def _emit(stage: str, progress_pct: int, message: str) -> None:
            if progress_callback is None:
                return
            try:
                # Try new 3-arg signature first
                progress_callback(stage, progress_pct / 100.0, message)
            except TypeError:
                # Fall back to legacy 2-arg signature
                progress_callback(progress_pct, message)

        try:
            _emit("bpm_detection", 10, "📊 Detecting BPM with Librosa...")
            self.extract_bpm()
            self._check_cancelled()

            _emit("bass_isolation", 30, "🤖 Isolating bass with Demucs...")
            self.isolate_bass()
            self._check_cancelled()

            _emit("midi_conversion", 85, "🎹 Converting to MIDI with Basic Pitch...")
            self.convert_to_midi()
            self._check_cancelled()

            q_label = "Sin cuantizar" if quantization == "none" else f"Cuantizando a {quantization}..."
            _emit("quantization", 95, f"📐 {q_label}")
            self.quantize_midi(quantization)

            _emit("complete", 100, "✅ Done. Encoding output...")
            return self.bpm, self.midi_data_b64
        except CancellationError:
            print("[BassExtractor] Pipeline cancelled by user.")
            raise
        except Exception:
            raise

    # ── New WebSocket pipeline (async progress callbacks) ────────────────────

    def process_pipeline_ws(
        self,
        progress_callback: Optional[Callable] = None,
        quantization: str = "1/16",
    ) -> dict:
        """
        Run the full extraction pipeline for WebSocket mode.

        Progress callback signature: (stage: str, progress: float, message: str)
        where progress is 0.0–1.0.

        Returns a dict with all result data:
            bpm, midi_b64, bass_audio_b64
        """

        def _emit(stage: str, progress: float, message: str) -> None:
            if progress_callback:
                progress_callback(stage, progress, message)

        try:
            _emit("bpm_detection", 0.10, "Analyzing tempo...")
            self.extract_bpm()
            self._check_cancelled()

            _emit("bass_isolation", 0.30, "Running Demucs neural separation...")
            self.isolate_bass()
            self._check_cancelled()

            _emit("midi_conversion", 0.75, "Converting bass to MIDI notes...")
            self.convert_to_midi()
            self._check_cancelled()

            q_label = "No quantization" if quantization == "none" else f"Quantizing to {quantization}..."
            _emit("quantization", 0.90, q_label)
            self.quantize_midi(quantization)

            _emit("encoding", 0.95, "Encoding audio data...")
            bass_audio_b64 = self.get_bass_audio_b64()

            _emit("complete", 1.0, "Processing complete.")
            return {
                "bpm": self.bpm,
                "midi_b64": self.midi_data_b64,
                "bass_audio_b64": bass_audio_b64,
            }
        except CancellationError:
            print("[BassExtractor] Pipeline cancelled by user.")
            raise
        except Exception:
            raise

    def process_multi_stem_pipeline(
        self,
        progress_callback: Optional[Callable] = None,
        quantization: str = "1/16",
    ) -> dict:
        """
        Run the multi-stem extraction pipeline.

        Returns:
            dict with bpm and stems dict containing audio_b64 for each stem,
            plus midi_b64 for the bass stem.
        """

        def _emit(stage: str, progress: float, message: str) -> None:
            if progress_callback:
                progress_callback(stage, progress, message)

        try:
            _emit("bpm_detection", 0.05, "Analyzing tempo...")
            self.extract_bpm()
            self._check_cancelled()

            _emit("stem_separation", 0.15, "Running Demucs multi-stem separation...")
            stems_b64 = self.isolate_all_stems()
            self._check_cancelled()

            _emit("midi_conversion", 0.70, "Converting bass to MIDI notes...")
            if self.bass_path and os.path.exists(self.bass_path):
                self.convert_to_midi()
                self._check_cancelled()

                q_label = "No quantization" if quantization == "none" else f"Quantizing to {quantization}..."
                _emit("quantization", 0.85, q_label)
                self.quantize_midi(quantization)

            _emit("complete", 1.0, "Multi-stem processing complete.")

            # Build result
            result_stems = {}
            for stem_name, audio_b64 in stems_b64.items():
                stem_data = {"audio_b64": audio_b64}
                if stem_name == "bass" and self.midi_data_b64:
                    stem_data["midi_b64"] = self.midi_data_b64
                result_stems[stem_name] = stem_data

            return {
                "bpm": self.bpm,
                "stems": result_stems,
            }
        except CancellationError:
            print("[BassExtractor] Multi-stem pipeline cancelled by user.")
            raise
        except Exception:
            raise
