import {
  inferTonic,
  isFlatKey,
  parseTonic,
  tonicFromSharps,
  tonicMidiBase,
} from '../core/constants';

import {
  isNote,
  makeScore,
  type Bar,
  type Score,
  type TimeSignature,
  type Tonic,
} from '../core/model';
import { compactTieChains } from '../core/tie-compact';
import { compactRestRuns } from '../core/rest-compact';
import { parseMidi, type LyricEvent, type MidiFile, type MidiNote } from './smf';
import { quantizeToBars } from './quantize';

export interface TrackInfo {
  index: number;
  name: string;
  noteCount: number;
  minMidi: number;
  maxMidi: number;
  avgMidi: number;
  beats: number;
  hasNotes: boolean;
  /** 歌词音节数（meta 0x05 事件数）；0 表示这条轨没写歌词 */
  lyricCount: number;
}

export interface ImportAnalysis {
  format: number;
  division: number;
  tempo: number;
  timeSig: TimeSignature;
  tracks: TrackInfo[];
  suggestedTrack: number;
  suggestedTonic: string;
  keySignaturePresent: boolean;
}

export interface ImportOptions {
  trackIndexes: number[];
  grid: number;
  minRestBeats: number;
  tonic: string;
  timeSig: TimeSignature;
  tempo: number;
  title: string;
  /** 是否把 MIDI 里的歌词（meta 0x05）落到音符上；默认 true */
  attachLyrics?: boolean;
}

function collectTempo(file: MidiFile): number {
  for (const track of file.tracks) {
    if (track.tempoChanges.length > 0) {
      const first = [...track.tempoChanges].sort((a, b) => a.tick - b.tick)[0];
      return Math.round(first.bpm * 100) / 100;
    }
  }
  return 120;
}

function collectTimeSig(file: MidiFile): TimeSignature {
  for (const track of file.tracks) {
    if (track.timeSignatures.length > 0) {
      const ts = track.timeSignatures[0];
      if (ts.num > 0 && ts.den > 0) return { num: ts.num, den: ts.den };
    }
  }
  return { num: 4, den: 4 };
}

function collectKeySig(file: MidiFile): { tonic: string; present: boolean } {
  for (const track of file.tracks) {
    if (track.keySignatures.length > 0) {
      const ks = track.keySignatures[0];
      return { tonic: formatTonicString(tonicFromSharps(ks.sharps)), present: true };
    }
  }
  return { tonic: 'C', present: false };
}

function formatTonicString(t: Tonic): string {
  if (t.accidental === 'sharp') return `${t.letter}#`;
  if (t.accidental === 'flat') return `b${t.letter}`;
  return t.letter;
}

export function analyzeMidi(data: ArrayBuffer): ImportAnalysis {
  const file = parseMidi(data);
  const tracks: TrackInfo[] = file.tracks.map((track, index) => {
    const notes = track.notes;
    if (notes.length === 0) {
      return {
        index,
        name: track.name || `轨道 ${index + 1}`,
        noteCount: 0,
        minMidi: 0,
        maxMidi: 0,
        avgMidi: 0,
        beats: 0,
        hasNotes: false,
        lyricCount: track.lyrics.length,
      };
    }
    let min = 128;
    let max = 0;
    let sum = 0;
    let maxTick = 0;
    for (const n of notes) {
      min = Math.min(min, n.midi);
      max = Math.max(max, n.midi);
      sum += n.midi;
      maxTick = Math.max(maxTick, n.start + n.duration);
    }
    return {
      index,
      name: track.name || `轨道 ${index + 1}`,
      noteCount: notes.length,
      minMidi: min,
      maxMidi: max,
      avgMidi: Math.round((sum / notes.length) * 10) / 10,
      beats: Math.round((maxTick / file.division) * 100) / 100,
      hasNotes: true,
      lyricCount: track.lyrics.length,
    };
  });

  const candidates = tracks.filter((t) => t.noteCount >= 4);
  const pool = candidates.length > 0 ? candidates : tracks.filter((t) => t.hasNotes);
  let suggestedTrack = pool.length > 0 ? pool[0].index : 0;
  if (pool.length > 1) {
    // 主旋律启发式：音数足够且平均音高最高
    let best = pool[0];
    for (const t of pool) {
      if (t.avgMidi > best.avgMidi + 0.5) best = t;
    }
    suggestedTrack = best.index;
  }

  const key = collectKeySig(file);
  const suggestedNotes = file.tracks[suggestedTrack]?.notes ?? [];
  const pitches = suggestedNotes.map((n) => n.midi);
  const inferred = pitches.length > 0 ? inferTonic(pitches, key.present && isFlatKey(parseTonic(key.tonic))) : null;
  const suggestedTonic = key.present ? key.tonic : inferred ? formatTonicString(inferred) : 'C';

  return {
    format: file.format,
    division: file.division,
    tempo: collectTempo(file),
    timeSig: collectTimeSig(file),
    tracks,
    suggestedTrack,
    suggestedTonic,
    keySignaturePresent: key.present,
  };
}

/**
 * 导入时给谱面定八度点的基准（调主的 MIDI 音高）。
 *
 * **必须等于 `tonicMidiBase(tonic, 4)`（C4–B4 窗口）**，不能按「让旋律音域居中」另挑一个八度：
 * `Tonic` 只有音名、没有八度字段，导入时挑的基准**不会存进谱面**，而播放（`audio/player.ts`）、
 * 导出 MIDI（`midi/export.ts`）、移调 notes 模式（`core/transpose.ts`）三处一律按 C4–B4 窗口
 * 把八度点重新解读一遍。基准一旦取在别的八度，谱面自己看着是自洽的，播出来 / 导出去却整首差一个八度
 * （实测 `下一首歌_1_YAO.mid` 与 `x.mid`：旋律音域 25 个半音，「音域居中」把基准定到 G3，
 * 播放与导出全部 +12 半音，谱面 62% 的记号顶着一个高点、源曲的众数音 G4 被写成 `1′`）。
 *
 * 顺带一提：「音域居中」连它自己的目标（八度点最少）都达不到——按八度点总数 Σ|octave| 数，
 * 那首歌 G3 是 297、G4 是 178，最省的正是窗口基准本身（居中只看 min/max，不看音高分布）。
 *
 * 代价要说清楚：旋律整体坐在窗口之下的曲子（男声低八度录音），谱面会多出一批低音点。
 * 这是简谱模型没有绝对八度字段的必然结果——想让谱面居中又发声准确，得把基准存进 `meta`。
 */
export function importTonicBase(tonic: Tonic): number {
  return tonicMidiBase(tonic, 4);
}

/** 谱面上带歌词的音符数（决定要不要打开「显示歌词」开关） */
export function countLyricNotes(bars: Bar[]): number {
  let total = 0;
  for (const bar of bars) {
    for (const ev of bar.events) {
      if (isNote(ev) && ev.lyric) total += 1;
    }
  }
  return total;
}

export function buildScoreFromMidi(data: ArrayBuffer, opts: ImportOptions): Score {
  const file = parseMidi(data);
  const merged: MidiNote[] = [];
  const lyrics: LyricEvent[] = [];
  const wantLyrics = opts.attachLyrics !== false;
  for (const idx of opts.trackIndexes) {
    const track = file.tracks[idx];
    if (!track) continue;
    merged.push(...track.notes);
    if (wantLyrics) lyrics.push(...track.lyrics);
  }
  lyrics.sort((a, b) => a.tick - b.tick);

  const tonic = parseTonic(opts.tonic);
  // 八度基准与播放 / 导出 / 移调共用同一个窗口，见 importTonicBase 的说明
  const base = importTonicBase(tonic);

  const quantized = quantizeToBars(merged, file.division, {
    grid: opts.grid,
    minRestBeats: opts.minRestBeats,
    timeSig: opts.timeSig,
    tonicBase: base,
    preferFlat: isFlatKey(tonic),
    lyrics,
  });

  // 量化按小节游程编码，长音已尽量写成「数字 + 增时线」；
  // 这里再收两遍尾：跨网格边界的碎链（如六个连音八分）合并成更长时值，
  // 小节内连续的小休止合并成更少的休止符，谱面更干净。
  const { bars: tiedBars } = compactTieChains(quantized, { grid: opts.grid });
  const { bars } = compactRestRuns(tiedBars, { grid: opts.grid });

  return makeScore(
    {
      title: opts.title,
      tonic,
      timeSig: opts.timeSig,
      tempo: opts.tempo,
      // 导入了歌词就默认显示；没歌词（或用户关掉勾选）保持关闭，谱面不会多出空行
      showLyrics: countLyricNotes(bars) > 0,
    },
    bars,
  );
}

