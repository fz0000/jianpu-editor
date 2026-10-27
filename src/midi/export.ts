import { keySignatureSharps, mappingToMidi, tonicMidiBase } from '../core/constants';
import {
  durationBeats,
  noteBeats,
  restBeats,
  type Duration,
  type Score,
} from '../core/model';
import {
  buildNoteTrack,
  writeMidi,
  type LyricEvent,
  type MidiFile,
  type MidiNote,
  type MidiTrack,
} from './smf';


const DIVISION = 96;

export interface MidiExportResult {
  file: MidiFile;
  bytes: Uint8Array;
  noteCount: number;
}

/** 简谱 -> SMF Format 1（轨道 0 为速度/拍号/调号，轨道 1 为旋律） */
export function scoreToMidiFile(score: Score): { file: MidiFile; notes: MidiNote[] } {
  const tonicBase = tonicMidiBase(score.meta.tonic, 4);
  const notes: MidiNote[] = [];
  const lyrics: LyricEvent[] = [];


  let beat = 0;
  let lastNote: MidiNote | null = null;
  let lastDuration: Duration | null = null;

  for (const bar of score.bars) {
    for (const ev of bar.events) {
      if (ev.kind === 'note') {
        const beats = noteBeats(ev);
        const midi = mappingToMidi(
          { degree: ev.degree, accidental: ev.accidental, octave: ev.octave },
          tonicBase,
        );
        const startTick = Math.round(beat * DIVISION);
        // 歌词按 SMF meta 0x05 写回，落在该音符起始 tick；连音续接音符上本来就没有歌词
        if (ev.lyric) lyrics.push({ tick: startTick, text: ev.lyric });
        const durTicks = Math.max(1, Math.round(beats * DIVISION));
        const contiguous =
          lastNote !== null &&
          lastNote.midi === midi &&
          Math.abs((lastNote.start + lastNote.duration) / DIVISION - beat) < 1e-6;

        if (ev.tie && contiguous && lastNote) {
          lastNote.duration += durTicks;
        } else {
          lastNote = {
            midi,
            channel: 0,
            start: startTick,
            duration: durTicks,
            velocity: ev.velocity || 96,
          };
          notes.push(lastNote);
        }
        lastDuration = ev.duration;
        beat += beats;
      } else if (ev.kind === 'rest') {
        beat += restBeats(ev);
        lastNote = null;
        lastDuration = null;
      } else {
        const base = lastDuration ? durationBeats(lastDuration) : 1;
        if (lastNote) {
          lastNote.duration += Math.max(1, Math.round(base * DIVISION));
        }
        beat += base;
      }
    }
  }

  const tempoTrack: MidiTrack = {
    name: 'Tempo',
    notes: [],
    tempoChanges: [{ tick: 0, bpm: score.meta.tempo }],
    timeSignatures: [{ tick: 0, num: score.meta.timeSig.num, den: score.meta.timeSig.den }],
    keySignatures: [{ tick: 0, sharps: keySignatureSharps(score.meta.tonic), minor: false }],
    lyrics: [],
    programs: [],
  };

  const melodyTrack = buildNoteTrack(notes, score.meta.title || 'Melody', 0, lyrics);

  return {
    file: { format: 1, division: DIVISION, tracks: [tempoTrack, melodyTrack] },
    notes,
  };
}

export function exportScoreToMidi(score: Score): MidiExportResult {
  const { file, notes } = scoreToMidiFile(score);
  return { file, bytes: writeMidi(file), noteCount: notes.length };
}

