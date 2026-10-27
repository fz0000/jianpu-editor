import { describe, expect, it } from 'vitest';
import {
  buildNoteTrack,
  parseMidi,
  writeMidi,
  type MidiFile,
  type MidiNote,
} from '../src/midi/smf';

const NOTES: MidiNote[] = [
  { midi: 60, channel: 0, start: 0, duration: 480, velocity: 96 },
  { midi: 62, channel: 0, start: 480, duration: 480, velocity: 90 },
  { midi: 64, channel: 0, start: 960, duration: 960, velocity: 72 },
  { midi: 67, channel: 1, start: 1920, duration: 480, velocity: 110 },
];

function sampleFile(): MidiFile {
  return {
    format: 1,
    division: 480,
    tracks: [
      {
        name: 'Tempo',
        notes: [],
        tempoChanges: [{ tick: 0, bpm: 100 }],
        timeSignatures: [{ tick: 0, num: 3, den: 4 }],
        keySignatures: [{ tick: 0, sharps: 2, minor: false }],
        lyrics: [],
        programs: [],
      },
      buildNoteTrack(NOTES, 'Melody', 73),
    ],
  };
}

describe('SMF 读写', () => {
  it('writeMidi 产出合法的 MThd 头', () => {
    const bytes = writeMidi(sampleFile());
    expect(bytes.length).toBeGreaterThan(14);
    expect(String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3])).toBe('MThd');
    // 头块长度固定为 6
    expect([bytes[4], bytes[5], bytes[6], bytes[7]]).toEqual([0, 0, 0, 6]);
    // format = 1
    expect([(bytes[8] << 8) | bytes[9]]).toEqual([1]);
    // 轨道数 = 2
    expect([(bytes[10] << 8) | bytes[11]]).toEqual([2]);
    // division = 480 ticks/四分
    expect([(bytes[12] << 8) | bytes[13]]).toEqual([480]);
    expect(String.fromCharCode(bytes[14], bytes[15], bytes[16], bytes[17])).toBe('MTrk');
  });

  it('parseMidi(writeMidi(x)) 往返一致', () => {
    const parsed = parseMidi(writeMidi(sampleFile()));

    expect(parsed.format).toBe(1);
    expect(parsed.division).toBe(480);
    expect(parsed.tracks.length).toBe(2);

    expect(parsed.tracks[0].tempoChanges).toEqual([{ tick: 0, bpm: 100 }]);
    expect(parsed.tracks[0].timeSignatures).toEqual([{ tick: 0, num: 3, den: 4 }]);
    expect(parsed.tracks[0].keySignatures[0].sharps).toBe(2);
    expect(parsed.tracks[0].keySignatures[0].minor).toBe(false);

    expect(parsed.tracks[1].name).toBe('Melody');
    expect(parsed.tracks[1].programs).toContain(73);
    expect(parsed.tracks[1].notes).toEqual(NOTES);
  });

  it('音符按起始 tick 升序返回', () => {
    const shuffled: MidiNote[] = [NOTES[3], NOTES[1], NOTES[0], NOTES[2]];
    const parsed = parseMidi(
      writeMidi({
        format: 1,
        division: 96,
        tracks: [buildNoteTrack(shuffled, 'Sorted', 0)],
      }),
    );
    const starts = parsed.tracks[0].notes.map((n) => n.start);
    expect(starts).toEqual([...starts].sort((a, b) => a - b));
  });

  it('拒绝非 MIDI 数据', () => {
    const bogus = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(() => parseMidi(bogus)).toThrow();
  });
});
