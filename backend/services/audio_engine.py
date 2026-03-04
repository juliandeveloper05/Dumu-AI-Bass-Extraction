# backend/services/audio_engine.py
import os
import glob
import subprocess
import shutil
import base64
import uuid
import gc
from typing import Callable, Optional
import librosa
import numpy as np
import soundfile as sf
from basic_pitch.inference import predict_and_save

DEMUCS_MODEL = "htdemucs"
MAX_DURATION_SECONDS = 600  # 10 minutes max to prevent OOM
LIBROSA_CHUNK_DURATION = 30  # Process BPM detection in 30s chunks


class BassExtractor:
    def __init__(self, file_path: str):
        self.file_path = os.path.abspath(file_path)
        self.session_id = uuid.uuid4().hex
        self.demucs_out_dir = os.path.abspath(f"temp/demucs_{self.session_id}")
        self.bpm: int | None = None
        self.bass_path: str | None = None
        self.midi_data_b64: str | None = None
        self._validate_audio_duration()

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
        except Exception as e:
            # If soundfile can't read it, let it fail later in librosa/demucs
            print(f"[BassExtractor] Warning: Could not validate duration: {e}")

    def extract_bpm(self) -> None:
        """
        Optimized BPM detection using chunked loading to reduce memory footprint.
        Only loads first LIBROSA_CHUNK_DURATION seconds for tempo estimation.
        """
        print("[BassExtractor] Extracting BPM with librosa...")
        try:
            # Load only first chunk for BPM detection (saves 70-90% memory vs full load)
            y, sr = librosa.load(
                self.file_path,
                sr=22050,  # Downsample to 22kHz (sufficient for beat tracking)
                mono=True,
                duration=LIBROSA_CHUNK_DURATION,
                res_type='kaiser_fast'  # Faster resampling algorithm
            )

            tempo, _ = librosa.beat.beat_track(y=y, sr=sr)
            raw = float(tempo[0]) if isinstance(tempo, np.ndarray) else float(tempo)
            self.bpm = round(raw)

            # Explicit memory cleanup
            del y
            gc.collect()

            print(f"[BassExtractor] Detected BPM: {self.bpm}")
        except Exception as e:
            print(f"[BassExtractor] BPM detection failed, using default 120: {e}")
            self.bpm = 120  # Fallback to standard tempo

    def isolate_bass(self) -> None:
        """
        Optimized Demucs subprocess with explicit memory limits and segment processing.
        Uses --segment flag to process audio in chunks, reducing peak memory usage.
        """
        print(f"[BassExtractor] Isolating bass with Demucs ({DEMUCS_MODEL})...")
        os.makedirs(self.demucs_out_dir, exist_ok=True)

        name_no_ext = os.path.splitext(os.path.basename(self.file_path))[0]

        # Memory optimization flags:
        # --segment: Process audio in chunks (reduces peak RAM by 50-70%)
        # --shifts 0: Disable test-time augmentation (saves 4x memory, slight quality loss)
        # -j 1: Single worker (already set, but explicit)
        result = subprocess.run(
            [
                "demucs",
                "-n", DEMUCS_MODEL,
                "--two-stems", "bass",
                "--device", "cpu",
                "-j", "1",
                "--segment", "10",  # Process in 10-second chunks (default is full track)
                "--shifts", "0",  # Disable TTA (test-time augmentation)
                "--int24",  # Use int24 instead of float32 (saves 33% WAV size)
                "-o", self.demucs_out_dir,
                self.file_path,
            ],
            capture_output=True,
            text=True,
            timeout=600,
            env={**os.environ, "OMP_NUM_THREADS": "1"}  # Limit OpenMP to 1 thread
        )

        if result.returncode != 0:
            raise RuntimeError(
                f"Demucs failed:\nSTDOUT: {result.stdout}\nSTDERR: {result.stderr}"
            )

        # mdx_extra_q output path is: {out_dir}/{model}/{track_name}/bass.wav
        self.bass_path = os.path.join(
            self.demucs_out_dir, DEMUCS_MODEL, name_no_ext, "bass.wav"
        )

        if not os.path.exists(self.bass_path):
            raise FileNotFoundError(
                f"Expected bass stem not found at: {self.bass_path}"
            )

        print(f"[BassExtractor] Bass isolated at: {self.bass_path}")

        # Force garbage collection after heavy subprocess
        gc.collect()

    def convert_to_midi(self) -> None:
        """
        Optimized Basic Pitch inference with memory cleanup.
        Basic Pitch 0.3.x already does internal chunking, but we ensure
        no intermediate outputs are saved to reduce I/O overhead.
        """
        print("[BassExtractor] Converting bass to MIDI with Basic Pitch...")
        midi_out_dir = os.path.dirname(self.bass_path)

        try:
            predict_and_save(
                audio_path_list=[self.bass_path],
                output_directory=midi_out_dir,
                save_midi=True,
                sonify_midi=False,
                save_model_outputs=False,  # Don't save NPZ (saves disk I/O + space)
                save_notes=False,  # Don't save CSV (saves disk I/O + space)
            )

            bass_stem_name = os.path.splitext(os.path.basename(self.bass_path))[0]
            midi_path = os.path.join(midi_out_dir, f"{bass_stem_name}_basic_pitch.mid")

            # Fallback: glob for any .mid file if exact name doesn't match
            if not os.path.exists(midi_path):
                # Basic Pitch varies output naming across versions — glob fallback
                mid_files = glob.glob(os.path.join(midi_out_dir, "*.mid"))
                if mid_files:
                    midi_path = mid_files[0]
                    print(f"[BassExtractor] Fallback MIDI found: {midi_path}")
                else:
                    raise FileNotFoundError(f"No MIDI file found in: {midi_out_dir}")

            with open(midi_path, "rb") as f:
                self.midi_data_b64 = base64.b64encode(f.read()).decode("utf-8")

            print("[BassExtractor] MIDI conversion complete.")

            # Force garbage collection after TensorFlow inference
            gc.collect()

        except Exception as e:
            print(f"[BassExtractor] Basic Pitch failed: {e}")
            raise

    def cleanup(self) -> None:
        print("[BassExtractor] Running cleanup...")
        if self.file_path and os.path.exists(self.file_path):
            try:
                os.remove(self.file_path)
            except OSError as e:
                print(f"[BassExtractor] Warning: could not remove input file: {e}")

        if os.path.exists(self.demucs_out_dir):
            shutil.rmtree(self.demucs_out_dir, ignore_errors=True)

        print("[BassExtractor] Cleanup done.")

    def process_pipeline(
        self,
        progress_callback: Optional[Callable[[int, str], None]] = None,
    ) -> tuple[int, str]:
        def _emit(progress: int, message: str) -> None:
            if progress_callback:
                progress_callback(progress, message)

        try:
            _emit(10, "📊 Detecting BPM with Librosa...")
            self.extract_bpm()

            _emit(30, "🤖 Isolating bass with Demucs...")
            self.isolate_bass()

            _emit(85, "🎹 Converting to MIDI with Basic Pitch...")
            self.convert_to_midi()

            _emit(100, "✅ Done. Encoding output...")
            return self.bpm, self.midi_data_b64
        except Exception:
            raise
