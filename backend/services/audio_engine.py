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
from collections import defaultdict
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

# ── MIDI post-processing defaults (Phase 1) ──────────────────────────────────
# Velocity below this floor (MIDI 0-127 scale) is treated as ghost-note / noise
# and discarded. Empirically ~35 catches most sympathetic-ringing artefacts
# without sacrificing soft fingerstyle dynamics.
DEFAULT_VELOCITY_FLOOR = 35

# Two notes at the same pitch within this window are merged. Basic Pitch
# sometimes splits a single sustained note into 2-3 fragments at pick / slap
# attacks because the transient briefly drops below the frame threshold.
DEFAULT_NEIGHBOR_MERGE_WINDOW_MS = 40.0

# When a note appears within this window of a note exactly one octave below,
# the upper note is treated as a harmonic of the lower fundamental and dropped.
DEFAULT_OCTAVE_DEDUP_WINDOW_MS = 20.0

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
        # ── MIDI post-processing (Phase 1) ────────────────────────────────
        velocity_floor: Optional[int] = None,
        neighbor_merge_window_ms: Optional[float] = None,
        octave_dedup_window_ms: Optional[float] = None,
        enforce_monophonic: Optional[bool] = None,
        enable_post_processing: Optional[bool] = None,
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

        # MIDI post-processing knobs
        self.velocity_floor = (
            int(velocity_floor) if velocity_floor is not None else DEFAULT_VELOCITY_FLOOR
        )
        self.neighbor_merge_window_ms = (
            float(neighbor_merge_window_ms)
            if neighbor_merge_window_ms is not None
            else DEFAULT_NEIGHBOR_MERGE_WINDOW_MS
        )
        self.octave_dedup_window_ms = (
            float(octave_dedup_window_ms)
            if octave_dedup_window_ms is not None
            else DEFAULT_OCTAVE_DEDUP_WINDOW_MS
        )
        self.enforce_monophonic = (
            bool(enforce_monophonic) if enforce_monophonic is not None else True
        )
        self.enable_post_processing = (
            bool(enable_post_processing) if enable_post_processing is not None else True
        )

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

    # ── MIDI post-processing helpers (Phase 1) ───────────────────────────────

    @staticmethod
    def _apply_velocity_floor(notes: list, floor: int) -> list:
        """
        Drop notes whose velocity is below the configured floor.

        Ghost notes from sympathetic ringing and bleed are almost always low
        velocity. Removing them is the cheapest, safest first pass.
        """
        return [n for n in notes if n.velocity >= floor]

    @staticmethod
    def _merge_neighbor_notes(notes: list, window_s: float) -> list:
        """
        Merge same-pitch notes whose gap is <= window_s seconds.

        Basic Pitch frequently splits a single sustained bass note into 2-3
        fragments when the frame confidence dips briefly (typical at pick /
        slap re-attacks). Merging keeps the earliest start, the latest end,
        and the loudest velocity.
        """
        if not notes:
            return notes

        by_pitch: dict[int, list] = defaultdict(list)
        for n in notes:
            by_pitch[n.pitch].append(n)

        merged: list = []
        for _pitch, group in by_pitch.items():
            group.sort(key=lambda n: n.start)
            current = group[0]
            for nxt in group[1:]:
                gap = nxt.start - current.end
                if gap <= window_s:
                    current.end = max(current.end, nxt.end)
                    current.velocity = max(current.velocity, nxt.velocity)
                else:
                    merged.append(current)
                    current = nxt
            merged.append(current)
        return merged

    @staticmethod
    def _octave_dedup(notes: list, window_s: float) -> list:
        """
        Drop note N if there is another note at pitch (N - 12) onset-aligned
        within window_s. The upper note is almost always a harmonic of the
        lower fundamental, not a real played note.
        """
        if not notes:
            return notes

        notes_sorted = sorted(notes, key=lambda n: n.start)
        keep = [True] * len(notes_sorted)

        for i, n in enumerate(notes_sorted):
            if not keep[i]:
                continue
            for j, other in enumerate(notes_sorted):
                if i == j or not keep[j]:
                    continue
                if abs(other.start - n.start) > window_s:
                    continue
                # `other` is exactly one octave below `n` → drop `n` (harmonic)
                if other.pitch == n.pitch - 12:
                    keep[i] = False
                    break

        return [n for n, k in zip(notes_sorted, keep) if k]

    @staticmethod
    def _enforce_monophonic(notes: list) -> list:
        """
        Force monophonic playback: when two notes overlap in time, keep the
        lower pitch and either drop the higher one or truncate the older note
        so the new (lower) note wins the playback slot.

        Bass guitar is monophonic in ~95% of real playing — overlapping notes
        are almost always harmonic ghosts.
        """
        if not notes:
            return notes

        notes_sorted = sorted(notes, key=lambda n: n.start)
        kept: list = []
        for n in notes_sorted:
            drop_n = False
            for k in kept:
                overlaps = k.end > n.start and k.start < n.end
                if overlaps and k.pitch <= n.pitch:
                    # Already-kept note is lower (or equal) → n is the ghost
                    drop_n = True
                    break
            if drop_n:
                continue
            # n wins; truncate any kept (higher) notes that bleed into n.start
            for k in kept:
                if k.start < n.start < k.end:
                    k.end = n.start
            kept.append(n)

        # Truncation can produce zero / negative duration notes — filter them
        return [n for n in kept if n.end > n.start]

    def post_process_midi(self) -> None:
        """
        Apply the Phase 1 ghost-note cleanup chain to the MIDI produced by
        Basic Pitch. Re-encodes self.midi_data_b64 in place.

        Pipeline order is deliberate:
          1. Velocity floor — cheapest, removes the noisiest ghosts first
          2. Neighbor merge — consolidate fragments before counting overlaps
          3. Octave dedup    — drop harmonic doublings
          4. Mono-enforce    — final pass to remove residual polyphony

        Each stage is a no-op when its window is 0 or when the previous stage
        already removed everything it would have caught.
        """
        if not self.enable_post_processing:
            print("[BassExtractor] Skipping MIDI post-processing (disabled).")
            return
        if not self.midi_data_b64:
            print("[BassExtractor] No MIDI data to post-process; skipping.")
            return

        print("[BassExtractor] Post-processing MIDI (ghost-note cleanup)...")

        # Decode current MIDI to a temp file (pretty_midi loads from disk)
        midi_tmp = os.path.join(
            self.demucs_out_dir, f"postproc_{self.session_id}.mid"
        )
        os.makedirs(os.path.dirname(midi_tmp), exist_ok=True)
        with open(midi_tmp, "wb") as f:
            f.write(base64.b64decode(self.midi_data_b64))

        pm = pretty_midi.PrettyMIDI(midi_tmp)

        merge_window_s = self.neighbor_merge_window_ms / 1000.0
        octave_window_s = self.octave_dedup_window_ms / 1000.0

        total_before = 0
        total_after = 0

        for instrument in pm.instruments:
            notes = list(instrument.notes)
            total_before += len(notes)

            notes = self._apply_velocity_floor(notes, self.velocity_floor)
            notes = self._merge_neighbor_notes(notes, merge_window_s)
            notes = self._octave_dedup(notes, octave_window_s)
            if self.enforce_monophonic:
                notes = self._enforce_monophonic(notes)

            instrument.notes = notes
            total_after += len(notes)

        pm.write(midi_tmp)

        with open(midi_tmp, "rb") as f:
            self.midi_data_b64 = base64.b64encode(f.read()).decode("utf-8")

        dropped = total_before - total_after
        pct = (dropped / total_before * 100.0) if total_before else 0.0
        print(
            f"[BassExtractor] Post-processing done: "
            f"{total_before} → {total_after} notes "
            f"({dropped} removed, {pct:.1f}%)."
        )
        gc.collect()

    def stamp_midi_tempo(self) -> None:
        """
        Inject the detected BPM as the MIDI's initial tempo meta-event so DAWs
        (Ableton Live, Logic, FL Studio) interpret the note timings at the
        correct tempo when the file is imported.

        Basic Pitch writes its MIDI output at the default 120 BPM regardless
        of the source material. Without this fix, dragging the MIDI into an
        Ableton project at any other tempo rescales every note's start time,
        breaking alignment with the original audio.

        Re-encodes self.midi_data_b64 in place.
        """
        if not self.midi_data_b64 or not self.bpm:
            print("[BassExtractor] No MIDI/BPM to stamp; skipping tempo injection.")
            return

        print(f"[BassExtractor] Stamping MIDI with detected tempo: {self.bpm} BPM")

        tmp_path = os.path.join(
            self.demucs_out_dir, f"tempo_{self.session_id}.mid"
        )
        os.makedirs(os.path.dirname(tmp_path), exist_ok=True)
        with open(tmp_path, "wb") as f:
            f.write(base64.b64decode(self.midi_data_b64))

        # Build a fresh PrettyMIDI carrying the detected tempo, then copy
        # instruments/notes verbatim. Note start/end times are absolute
        # seconds — pretty_midi will encode them as ticks relative to the
        # new tempo, but the playback timing remains identical.
        src = pretty_midi.PrettyMIDI(tmp_path)
        dst = pretty_midi.PrettyMIDI(initial_tempo=float(self.bpm))
        for instrument in src.instruments:
            dst.instruments.append(instrument)

        dst.write(tmp_path)
        with open(tmp_path, "rb") as f:
            self.midi_data_b64 = base64.b64encode(f.read()).decode("utf-8")

    @staticmethod
    def _inject_acid_chunk_into_wav(wav_path: str, bpm: float, n_beats: int) -> None:
        """
        Inject an ACID metadata chunk into a RIFF/WAVE file so loop-aware DAWs
        (Ableton, FL Studio, Reason, Sony Acid) auto-warp the file to project
        tempo on import. The chunk advertises the original BPM, beat count,
        and time signature.

        ACID chunk layout (32 bytes total: 8 header + 24 body):
            'acid' (4B)         magic id
            chunk_size (4B u32) = 24
            flags (4B u32)      bit0=one-shot, bit1=root set, bit2=stretch,
                                bit4=ACIDized
            root_note (2B u16)  MIDI note (unused when stretch on, set to 60)
            unknown1 (2B u16)   0x8000
            unknown2 (4B f32)   0.0
            n_beats (4B u32)    beat count of the loop
            meter_denom (2B u16) = 4
            meter_num (2B u16)   = 4
            tempo (4B f32)       BPM
        """
        import struct

        with open(wav_path, "rb") as f:
            data = f.read()

        if data[:4] != b"RIFF" or data[8:12] != b"WAVE":
            raise ValueError(f"Not a valid WAVE file: {wav_path}")

        riff_size = struct.unpack("<I", data[4:8])[0]

        # ACID flags: ACIDized | stretch-on | root-note-set | loop (not one-shot)
        # 0x1E = 0b00011110
        acid_flags = 0x1E
        acid_body = struct.pack(
            "<IHHfIHHf",
            acid_flags,
            60,             # root note (C4) — conventional value; ignored when stretching
            0x8000,         # unknown1 (conventional)
            0.0,            # unknown2 (conventional)
            int(n_beats),   # number of beats in the loop
            4,              # meter denominator
            4,              # meter numerator
            float(bpm),     # tempo in BPM
        )
        assert len(acid_body) == 24, f"ACID body length wrong: {len(acid_body)}"
        acid_chunk = b"acid" + struct.pack("<I", 24) + acid_body
        assert len(acid_chunk) == 32

        # Walk the chunk list to find the 'data' chunk — we insert acid
        # immediately before it, so the structural fmt → acid → data order
        # matches what Ableton expects.
        pos = 12  # skip RIFF header
        while pos < len(data) - 8:
            chunk_id = data[pos:pos + 4]
            chunk_size = struct.unpack("<I", data[pos + 4:pos + 8])[0]
            if chunk_id == b"data":
                break
            # Move past this chunk (8B header + payload, padded to even bytes)
            pos += 8 + chunk_size + (chunk_size & 1)
        else:
            raise ValueError(f"'data' chunk not found in WAV: {wav_path}")

        # Splice ACID chunk in
        new_data = data[:pos] + acid_chunk + data[pos:]

        # Update RIFF master size (add 32 bytes for the inserted chunk)
        new_riff_size = riff_size + 32
        new_data = b"RIFF" + struct.pack("<I", new_riff_size) + b"WAVE" + new_data[12:]

        with open(wav_path, "wb") as f:
            f.write(new_data)

    def stamp_bass_wav_with_acid(self) -> None:
        """
        Inject ACID metadata into the isolated bass.wav so Ableton (and other
        loop-aware DAWs) auto-warp the file to the project tempo on import.

        Computes the beat count from the audio duration and detected BPM.
        No-op if bass_path or bpm is missing.
        """
        if not self.bass_path or not os.path.exists(self.bass_path) or not self.bpm:
            print("[BassExtractor] No bass.wav/BPM to stamp; skipping ACID injection.")
            return

        try:
            info = sf.info(self.bass_path)
            duration_s = info.duration
            n_beats = max(1, int(round(duration_s * self.bpm / 60.0)))
            print(
                f"[BassExtractor] Stamping bass.wav with ACID metadata: "
                f"{self.bpm} BPM, {n_beats} beats, {duration_s:.2f}s"
            )
            self._inject_acid_chunk_into_wav(self.bass_path, float(self.bpm), n_beats)
        except Exception as e:
            # ACID metadata is optional — don't break the pipeline on failure
            print(f"[BassExtractor] Warning: ACID injection failed: {e}")

    def get_original_audio_b64(self) -> Optional[str]:
        """
        Base64-encode the original (pre-separation) audio file so the frontend
        can offer it alongside the MIDI and bass stem as part of a download
        bundle for Ableton.

        Returns None if the source file was already cleaned up.
        """
        if not self.file_path or not os.path.exists(self.file_path):
            return None
        with open(self.file_path, "rb") as f:
            return base64.b64encode(f.read()).decode("utf-8")

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
            self.stamp_bass_wav_with_acid()
            self._check_cancelled()

            _emit("midi_conversion", 85, "🎹 Converting to MIDI with Basic Pitch...")
            self.convert_to_midi()
            self._check_cancelled()

            _emit("post_processing", 92, "🧹 Cleaning up ghost notes...")
            self.post_process_midi()
            self._check_cancelled()

            q_label = "Sin cuantizar" if quantization == "none" else f"Cuantizando a {quantization}..."
            _emit("quantization", 95, f"📐 {q_label}")
            self.quantize_midi(quantization)

            # Stamp the detected BPM as MIDI tempo so Ableton imports at the
            # right tempo. Must run AFTER quantization so the tempo isn't
            # overwritten by the quantize_midi() write.
            self.stamp_midi_tempo()

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
            self.stamp_bass_wav_with_acid()
            self._check_cancelled()

            _emit("midi_conversion", 0.75, "Converting bass to MIDI notes...")
            self.convert_to_midi()
            self._check_cancelled()

            _emit("post_processing", 0.85, "Cleaning up ghost notes...")
            self.post_process_midi()
            self._check_cancelled()

            q_label = "No quantization" if quantization == "none" else f"Quantizing to {quantization}..."
            _emit("quantization", 0.90, q_label)
            self.quantize_midi(quantization)

            # Stamp the detected BPM as the MIDI tempo (post-quantization)
            self.stamp_midi_tempo()

            _emit("encoding", 0.95, "Encoding audio data...")
            bass_audio_b64 = self.get_bass_audio_b64()
            original_audio_b64 = self.get_original_audio_b64()

            _emit("complete", 1.0, "Processing complete.")
            return {
                "bpm": self.bpm,
                "midi_b64": self.midi_data_b64,
                "bass_audio_b64": bass_audio_b64,
                "original_audio_b64": original_audio_b64,
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
            # ACID-stamp bass.wav and refresh its base64 since isolate_all_stems
            # encoded it before the metadata was injected.
            self.stamp_bass_wav_with_acid()
            if "bass" in stems_b64:
                refreshed_bass = self.get_bass_audio_b64()
                if refreshed_bass:
                    stems_b64["bass"] = refreshed_bass
            self._check_cancelled()

            _emit("midi_conversion", 0.70, "Converting bass to MIDI notes...")
            if self.bass_path and os.path.exists(self.bass_path):
                self.convert_to_midi()
                self._check_cancelled()

                _emit("post_processing", 0.80, "Cleaning up ghost notes...")
                self.post_process_midi()
                self._check_cancelled()

                q_label = "No quantization" if quantization == "none" else f"Quantizing to {quantization}..."
                _emit("quantization", 0.88, q_label)
                self.quantize_midi(quantization)

                # Stamp BPM as MIDI tempo for Ableton-aligned import
                self.stamp_midi_tempo()

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
