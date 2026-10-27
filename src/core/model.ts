/**
 * 简谱乐谱数据模型。
 *
 * 逻辑上只存 bar（小节）序列，视觉行（system）由 layout 引擎按容器宽度实时计算。
 */

import { DEFAULT_FONT_SIZE } from './metrics';

export type Accidental = 'natural' | 'sharp' | 'flat';
/** 时值用分母表示：1=全音符 2=二分 4=四分 8=八分 16=十六分 32=三十二分 */
export type Duration = 1 | 2 | 4 | 8 | 16 | 32;
export type Degree = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export type InstrumentPreset =
  | 'piano'
  | 'flute'
  | 'violin'
  | 'organ'
  | 'guitar'
  | 'clarinet'
  | 'musicbox';

export const INSTRUMENT_LABELS: Record<InstrumentPreset, string> = {
  piano: '钢琴',
  flute: '长笛',
  violin: '小提琴',
  organ: '风琴',
  guitar: '吉他',
  clarinet: '单簧管',
  musicbox: '八音盒',
};

export interface Tonic {
  letter: 'C' | 'D' | 'E' | 'F' | 'G' | 'A' | 'B';
  accidental: Accidental;
}

export interface NoteEvent {
  kind: 'note';
  id: string;
  degree: Degree;
  /** 相对调主的八度：-2..2，对应简谱数字下方/上方的圆点 */
  octave: number;
  accidental: Accidental;
  duration: Duration;
  dotted: boolean;
  /** 与前一个音符构成连音线（tie） */
  tie: boolean;
  /** 与前一个音符构成圆滑线（slur） */
  slur: boolean;
  triplet: boolean;
  lyric: string;
  velocity: number;
}

export interface RestEvent {
  kind: 'rest';
  id: string;
  duration: Duration;
  dotted: boolean;
}

/** 延长记号 "-"，时值继承其前面那个音符的（不带附点的）基础时值 */
export interface DashEvent {
  kind: 'dash';
  id: string;
}

export type ScoreEvent = NoteEvent | RestEvent | DashEvent;

export type BarlineKind = 'none' | 'normal' | 'repeat-start' | 'repeat-end' | 'final';

export interface Bar {
  id: string;
  events: ScoreEvent[];
  left: BarlineKind;
  right: BarlineKind;
}

export interface TimeSignature {
  num: number;
  den: number;
}

export interface Meta {
  /** 谱面字号（SVG 用户单位）：整张谱面按 fontSize / FONT_SIZE 等比缩放，见 core/metrics.ts */
  fontSize: number;
  title: string;
  subtitle: string;
  /** 演唱 / 演奏者（页眉标题下方居中显示，见 core/layout.ts layoutHeader） */
  singer: string;
  composer: string;
  lyricist: string;
  tonic: Tonic;
  timeSig: TimeSignature;
  tempo: number;
  instrument: InstrumentPreset;
  showLyrics: boolean;
  showBarNumbers: boolean;
  barsPerLine: number;
}

export interface Score {
  version: 1;
  meta: Meta;
  bars: Bar[];
}

let idCounter = 0;
export function nextId(prefix = 'e'): string {
  idCounter += 1;
  const rand = Math.random().toString(36).slice(2, 7);
  return `${prefix}${idCounter.toString(36)}${rand}`;
}

export function durationBeats(d: Duration): number {
  return 4 / d;
}

export function noteBeats(n: NoteEvent): number {
  const base = durationBeats(n.duration);
  return n.dotted ? base * 1.5 : base;
}

export function restBeats(r: RestEvent): number {
  const base = durationBeats(r.duration);
  return r.dotted ? base * 1.5 : base;
}

/** 一个小节的实际拍数（延长线继承前一个音符的基础时值） */
export function barBeatLength(bar: Bar): number {
  let total = 0;
  let lastNote: NoteEvent | null = null;
  for (const e of bar.events) {
    if (e.kind === 'note') {
      total += noteBeats(e);
      lastNote = e;
    } else if (e.kind === 'rest') {
      total += restBeats(e);
      lastNote = null;
    } else {
      total += lastNote ? durationBeats(lastNote.duration) : 1;
    }
  }
  return total;
}

/** 拍号决定一小节的理论拍数（以四分音符为一拍） */
export function measureBeats(ts: TimeSignature): number {
  return (ts.num * 4) / ts.den;
}

export function makeNote(
  degree: Degree,
  duration: Duration = 4,
  extra: Partial<Omit<NoteEvent, 'kind' | 'id' | 'degree' | 'duration'>> = {},
): NoteEvent {
  return {
    kind: 'note',
    id: nextId('n'),
    degree,
    octave: 0,
    accidental: 'natural',
    duration,
    dotted: false,
    tie: false,
    slur: false,
    triplet: false,
    lyric: '',
    velocity: 96,
    ...extra,
  };
}

export function makeRest(duration: Duration = 4, dotted = false): RestEvent {
  return { kind: 'rest', id: nextId('r'), duration, dotted };
}

export function makeDash(): DashEvent {
  return { kind: 'dash', id: nextId('d') };
}

export function makeBar(events: ScoreEvent[] = [], left: BarlineKind = 'normal', right: BarlineKind = 'normal'): Bar {
  return { id: nextId('b'), events, left, right };
}

export function defaultMeta(): Meta {
  return {
    fontSize: DEFAULT_FONT_SIZE,
    title: '',
    subtitle: '',
    singer: '',
    composer: '',
    lyricist: '',
    tonic: { letter: 'C', accidental: 'natural' },
    timeSig: { num: 4, den: 4 },
    tempo: 100,
    instrument: 'piano',
    showLyrics: true,
    showBarNumbers: true,
    barsPerLine: 0,
  };
}

export function makeScore(meta: Partial<Meta> = {}, bars: Bar[] = []): Score {
  return { version: 1, meta: { ...defaultMeta(), ...meta }, bars };
}

export function cloneScore(score: Score): Score {
  return {
    version: 1,
    meta: { ...score.meta, tonic: { ...score.meta.tonic }, timeSig: { ...score.meta.timeSig } },
    bars: score.bars.map((bar) => ({
      id: bar.id,
      left: bar.left,
      right: bar.right,
      events: bar.events.map((e) => ({ ...e })),
    })),
  };
}

export function isNote(e: ScoreEvent): e is NoteEvent {
  return e.kind === 'note';
}
export function isRest(e: ScoreEvent): e is RestEvent {
  return e.kind === 'rest';
}
export function isDash(e: ScoreEvent): e is DashEvent {
  return e.kind === 'dash';
}