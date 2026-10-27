import { describe, expect, it } from 'vitest';
import {
  buildNoteTrack,
  parseMidi,
  writeMidi,
  type LyricEvent,
  type MidiFile,
  type MidiNote,
} from '../src/midi/smf';
import { analyzeMidi, buildScoreFromMidi, countLyricNotes } from '../src/midi/import';
import { quantizeToBars } from '../src/midi/quantize';
import { scoreToMidiFile } from '../src/midi/export';
import { barBeatLength, isNote } from '../src/core/model';

/** 变长编码（测试里手搓 MIDI 用） */
function varBytes(value: number): number[] {
  const out = [value & 0x7f];
  let v = value >> 7;
  while (v > 0) {
    out.unshift((v & 0x7f) | 0x80);
    v >>= 7;
  }
  return out;
}

function chunk(type: string, payload: number[]): number[] {
  const bytes: number[] = [];
  for (const ch of type) bytes.push(ch.charCodeAt(0));
  const n = payload.length;
  bytes.push((n >> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff, ...payload);
  return bytes;
}

function metaAt(tick: number, metaType: number, textBytes: number[]): number[] {
  return [...varBytes(tick), 0xff, metaType, ...varBytes(textBytes.length), ...textBytes];
}

function utf8(text: string): number[] {
  return Array.from(new TextEncoder().encode(text));
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

const NOTES: MidiNote[] = [
  { midi: 60, channel: 0, start: 0, duration: 480, velocity: 96 },
  { midi: 62, channel: 0, start: 480, duration: 480, velocity: 90 },
  { midi: 64, channel: 0, start: 960, duration: 480, velocity: 88 },
];

const LYRICS: LyricEvent[] = [
  { tick: 0, text: '站' },
  { tick: 480, text: '台' },
  { tick: 960, text: '外' },
];

function midiWithLyrics(lyrics: LyricEvent[]): Uint8Array {
  const file: MidiFile = {
    format: 1,
    division: 480,
    tracks: [buildNoteTrack(NOTES, 'Melody', 0, lyrics)],
  };
  return writeMidi(file);
}

describe('SMF 歌词事件（meta 0x05）', () => {
  it('解析 UTF-8 中文歌词，并保留 tick', () => {
    const parsed = parseMidi(midiWithLyrics(LYRICS));
    expect(parsed.tracks[0].lyrics).toEqual(LYRICS);
  });

  it('GBK 编码的老文件也能解出中文', () => {
    // 「站」的 GBK 字节是 D5 BE，不是合法 UTF-8
    const bytes = new Uint8Array([
      ...chunk('MThd', [0, 1, 0, 1, 0x01, 0xe0]),
      ...chunk('MTrk', [
        ...metaAt(0, 0x05, [0xd5, 0xbe]),
        ...varBytes(0), 0x90, 60, 96,
        ...varBytes(480), 0x80, 60, 64,
        ...varBytes(0), 0xff, 0x2f, 0x00,
      ]),
    ]);
    expect(parseMidi(bytes).tracks[0].lyrics).toEqual([{ tick: 0, text: '站' }]);
  });

  it('空白文本的 lyric 事件不入库', () => {
    const bytes = new Uint8Array([
      ...chunk('MThd', [0, 1, 0, 1, 0x01, 0xe0]),
      ...chunk('MTrk', [
        ...metaAt(0, 0x05, utf8('  ')),
        ...varBytes(0), 0x90, 60, 96,
        ...varBytes(480), 0x80, 60, 64,
        ...varBytes(0), 0xff, 0x2f, 0x00,
      ]),
    ]);
    expect(parseMidi(bytes).tracks[0].lyrics).toEqual([]);
  });

  it('写出的 MIDI 再解析回来歌词不丢（round-trip）', () => {
    const parsed = parseMidi(midiWithLyrics(LYRICS));
    const again = parseMidi(writeMidi({ format: 1, division: 480, tracks: parsed.tracks }));
    expect(again.tracks[0].lyrics).toEqual(LYRICS);
  });

  it('没有歌词的文件解析结果为空数组，不影响原行为', () => {
    const parsed = parseMidi(midiWithLyrics([]));
    expect(parsed.tracks[0].lyrics).toEqual([]);
    expect(parsed.tracks[0].notes.length).toBe(NOTES.length);
  });
});

describe('量化层把歌词落到音符上', () => {
  const base = {
    grid: 0.5,
    minRestBeats: 0.25,
    timeSig: { num: 4, den: 4 },
    tonicBase: 60,
    preferFlat: false,
  };

  /** 谱面上每个事件的歌词（非音符记号记为空串） */
  function lyricsOf(bars: ReturnType<typeof quantizeToBars>): string[] {
    const out: string[] = [];
    for (const bar of bars) {
      for (const ev of bar.events) out.push(isNote(ev) ? ev.lyric : '');
    }
    return out;
  }

  it('音节按 tick 落到对应音符上', () => {
    const bars = quantizeToBars(NOTES, 480, { ...base, lyrics: LYRICS });
    // 4/4 拍：三个四分音符后补一个四分休止
    expect(lyricsOf(bars)).toEqual(['站', '台', '外', '']);
  });

  it('不传 lyrics 时谱面没有歌词', () => {
    const bars = quantizeToBars(NOTES, 480, base);
    expect(lyricsOf(bars).every((l) => l === '')).toBe(true);
  });

  it('长音上的多个音节连写拼接，增时线上不挂歌词', () => {
    // 3 拍长音写成「四分音符 + 两条增时线」，三个音节都落在那个音符上
    const long: MidiNote[] = [{ midi: 60, channel: 0, start: 0, duration: 1440, velocity: 96 }];
    const bars = quantizeToBars(long, 480, {
      ...base,
      lyrics: [
        { tick: 0, text: '春' },
        { tick: 480, text: '花' },
        { tick: 960, text: '秋' },
      ],
    });
    expect(lyricsOf(bars)).toEqual(['春花秋', '', '', '']);
  });

  it('落在休止 / 间隙上的音节（前奏、间奏）丢弃', () => {
    const notes: MidiNote[] = [
      { midi: 60, channel: 0, start: 0, duration: 480, velocity: 96 },
      { midi: 62, channel: 0, start: 1920, duration: 480, velocity: 96 },
    ];
    const bars = quantizeToBars(notes, 480, {
      ...base,
      lyrics: [
        { tick: 0, text: '起' },
        { tick: 1440, text: '空' }, // 落在 1..4 拍的间隙里
        { tick: 1920, text: '来' },
      ],
    });
    expect(lyricsOf(bars).filter((l) => l !== '')).toEqual(['起', '来']);
  });

  it('连字符 / 延音线（- _）不算音节，不落谱面', () => {
    const bars = quantizeToBars(NOTES, 480, {
      ...base,
      lyrics: [
        { tick: 0, text: 'go' },
        { tick: 480, text: '-' },
        { tick: 960, text: '_' },
      ],
    });
    expect(lyricsOf(bars).filter((l) => l !== '')).toEqual(['go']);
  });

  it('跨小节长音：歌词挂在最前面的音符，不挂在小节续接的连音音符', () => {
    const notes: MidiNote[] = [{ midi: 60, channel: 0, start: 0, duration: 1920, velocity: 96 }];
    const bars = quantizeToBars(notes, 480, {
      ...base,
      timeSig: { num: 2, den: 4 },
      lyrics: [{ tick: 0, text: '长' }],
    });
    expect(bars.length).toBeGreaterThan(1);
    expect(lyricsOf(bars).filter((l) => l !== '')).toEqual(['长']);
  });
});

describe('MIDI 导入带歌词', () => {
  const data = toArrayBuffer(midiWithLyrics(LYRICS));
  const options = {
    trackIndexes: [0],
    grid: 0.5,
    minRestBeats: 0.25,
    tonic: 'C',
    timeSig: { num: 4, den: 4 },
    tempo: 100,
    title: 'lyric-test',
  };

  it('analyzeMidi 报出每条轨的歌词音节数', () => {
    expect(analyzeMidi(data).tracks[0].lyricCount).toBe(3);
  });

  it('默认导入歌词，并自动打开「显示歌词」', () => {
    const score = buildScoreFromMidi(data, options);
    expect(countLyricNotes(score.bars)).toBe(3);
    expect(score.meta.showLyrics).toBe(true);
  });

  it('attachLyrics=false 时不导入歌词，「显示歌词」保持关闭', () => {
    const score = buildScoreFromMidi(data, { ...options, attachLyrics: false });
    expect(countLyricNotes(score.bars)).toBe(0);
    expect(score.meta.showLyrics).toBe(false);
  });

  it('导入歌词不改变小节拍数', () => {
    const withLyrics = buildScoreFromMidi(data, options);
    const without = buildScoreFromMidi(data, { ...options, attachLyrics: false });
    expect(withLyrics.bars.map(barBeatLength)).toEqual(without.bars.map(barBeatLength));
  });

  it('导出的 MIDI 把歌词写回（简谱 -> SMF -> 解析）', () => {
    const score = buildScoreFromMidi(data, options);
    const { file } = scoreToMidiFile(score);
    const parsed = parseMidi(toArrayBuffer(writeMidi(file)));
    const texts = parsed.tracks.flatMap((t) => t.lyrics.map((l) => l.text));
    expect([...texts].sort()).toEqual(['外', '台', '站'].sort());
  });
});

/**
 * `下一首歌_fix.mid` 是别的软件把同一首歌「修好」后导出的 MIDI，用来对照我们的零时长音补长规则。
 * 它做的事与 `toBeatNotes` 的补长同源，差别只在长缝要不要留休止（见下面的用例）。
 */