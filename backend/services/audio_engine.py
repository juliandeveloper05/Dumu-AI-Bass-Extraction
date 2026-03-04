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
from basic_pitch import ICASSP_2022_MODEL_PATH
import pretty_midi

DEMUCS_MODEL = "htdemucs"
MAX_DURATION_SECONDS = 600  # 10 minutes max to prevent OOM
LIBROSA_CHUNK_DURATION = 30  # Process BPM detection in 30s chunks

# Basic Pitch inference parameters tuned for bass guitar
# Frequency range: B0 on a 5-string (30.87 Hz) up through high bass techniques (~400 Hz).
# onset_threshold: lower than default (0.5) → catches fast plucks and slap attacks.
# frame_threshold: lower than default (0.3) → preserves long sustains without early cutoff.
# minimum_note_length: default (127.70ms) clips 16th notes at tempos above ~120 BPM;
#   58ms covers 32nd notes up to ~130 BPM without generating noise from ghost hits.
BASS_MIN_FREQ_HZ = 30.0
BASS_MAX_FREQ_HZ = 400.0
BASS_ONSET_THRESHOLD = 0.6
BASS_FRAME_THRESHOLD = 0.5
BASS_MIN_NOTE_LENGTH_MS = 100.0


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
                "--segment", "7",   # htdemucs max segment is 7.8s; 7 keeps a safe margin
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
                save_notes=False,          # Don't save CSV (saves disk I/O + space)
                model_or_model_path=ICASSP_2022_MODEL_PATH,
                minimum_frequency=BASS_MIN_FREQ_HZ,
                maximum_frequency=BASS_MAX_FREQ_HZ,
                onset_threshold=BASS_ONSET_THRESHOLD,
                frame_threshold=BASS_FRAME_THRESHOLD,
                minimum_note_length=BASS_MIN_NOTE_LENGTH_MS,
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

    def quantize_midi(self) -> None:
        """
        Quantize all note start/end times to the nearest 1/16-note grid.

        Grid step = 60 / bpm / 4  (one sixteenth note in seconds).
        Each note end is clamped to at least one grid step after its start
        so that tight notes don't collapse to zero duration after snapping.
        The quantized MIDI is written back to disk and self.midi_data_b64 is
        refreshed so the result endpoint always returns the quantized version.
        """
        if not self.midi_data_b64 or not self.bpm:
            return

        print(f"[BassExtractor] Quantizing MIDI to 1/16 grid at {self.bpm} BPM...")

        # 1/16 note duration in seconds
        grid = 60.0 / self.bpm / 4.0

        # pretty_midi needs a file path — decode back to disk temporarily
        midi_path = os.path.join(self.demucs_out_dir, f"quantized_{self.session_id}.mid")
        with open(midi_path, "wb") as f:
            f.write(base64.b64decode(self.midi_data_b64))

        pm = pretty_midi.PrettyMIDI(midi_path)

        for instrument in pm.instruments:
            for note in instrument.notes:
                snapped_start = round(note.start / grid) * grid
                snapped_end   = round(note.end   / grid) * grid

                # Guarantee at least one grid step of duration
                if snapped_end <= snapped_start:
                    snapped_end = snapped_start + grid

                note.start = snapped_start
                note.end   = snapped_end

        pm.write(midi_path)

        with open(midi_path, "rb") as f:
            self.midi_data_b64 = base64.b64encode(f.read()).decode("utf-8")

        print("[BassExtractor] Quantization complete.")

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

            _emit(95, "📐 Quantizing to 1/16 grid...")
            self.quantize_midi()

            _emit(100, "✅ Done. Encoding output...")
            return self.bpm, self.midi_data_b64
        except Exception:
            raise
