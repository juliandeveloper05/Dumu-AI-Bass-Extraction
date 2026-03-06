// frontend/src/utils/midiParser.js
/**
 * MIDI parsing wrapper around @tonejs/midi.
 * Converts Base64 MIDI into structured note data for piano roll rendering
 * and Tone.js playback scheduling.
 */
import { Midi } from '@tonejs/midi'

/**
 * Parse a Base64-encoded MIDI file.
 * @param {string} midiB64 — Base64-encoded .mid file
 * @returns {{ notes: Array, duration: number, tracks: number, name: string }}
 */
export function parseMidiBase64(midiB64) {
  const binary = atob(midiB64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return parseMidiBytes(bytes)
}

/**
 * Parse MIDI from a Uint8Array.
 * @param {Uint8Array} bytes — Raw MIDI bytes
 * @returns {{ notes: Array, duration: number, tracks: number, name: string, pitchRange: {min: number, max: number} }}
 */
export function parseMidiBytes(bytes) {
  const midi = new Midi(bytes)

  // Collect all notes from all tracks
  const allNotes = []
  let minPitch = 127
  let maxPitch = 0

  for (const track of midi.tracks) {
    for (const note of track.notes) {
      const noteData = {
        midi: note.midi,
        name: note.name,
        time: note.time,
        duration: note.duration,
        velocity: note.velocity,
        ticks: note.ticks,
        durationTicks: note.durationTicks,
      }
      allNotes.push(noteData)
      if (note.midi < minPitch) minPitch = note.midi
      if (note.midi > maxPitch) maxPitch = note.midi
    }
  }

  // Sort by time
  allNotes.sort((a, b) => a.time - b.time)

  // Calculate total duration
  const duration =
    allNotes.length > 0
      ? Math.max(...allNotes.map((n) => n.time + n.duration))
      : 0

  return {
    notes: allNotes,
    duration,
    tracks: midi.tracks.length,
    name: midi.name || 'Untitled',
    pitchRange: {
      min: allNotes.length > 0 ? minPitch : 0,
      max: allNotes.length > 0 ? maxPitch : 127,
    },
    bpm: midi.header.tempos.length > 0 ? midi.header.tempos[0].bpm : null,
    timeSignature:
      midi.header.timeSignatures.length > 0
        ? midi.header.timeSignatures[0]
        : null,
  }
}

/**
 * Convert a MIDI note number to a frequency in Hz.
 * @param {number} midi — MIDI note number (0-127)
 * @returns {number} — Frequency in Hz
 */
export function midiToFrequency(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12)
}

/**
 * Convert a MIDI note number to a note name (e.g., "C4", "F#2").
 * @param {number} midi
 * @returns {string}
 */
export function midiToNoteName(midi) {
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
  const octave = Math.floor(midi / 12) - 1
  const note = names[midi % 12]
  return `${note}${octave}`
}
