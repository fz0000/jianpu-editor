/**
 * 全曲移调：以半音为单位的整谱音高平移。
 *
 * 简谱是首调记谱，同一个「听感上的移调」有两种写法，音高变化完全相同：
 * - `'key'`（默认）：只平移调号（1=C → 1=D），谱面数字一个都不动 —— 标准简谱移调，谱面干净；
 * - `'notes'`：调号不动，逐音符改写 (音级, 升降号, 八度点) —— 谱面会出现大量 `#` `b`。
 *
 * 八度点受记法限制只能 ±2 个（见 core/model.ts 的注释与 io/json.ts 的钳制），
 * 越界的音符会被压回 ±2 并计入 `clamped`：此时它的实际音高会差一个八度，必须提示用户。
 *
 * 纯计算，不碰 DOM，可直接在 node 环境的测试里跑。
 */

import { DEGREE_PC, isFlatKey, mappingToMidi, pitchToMapping, tonicMidiBase, type PitchMapping } from './constants';
import { isNote, type Bar, type NoteEvent, type Tonic } from './model';

export type TransposeMode = 'key' | 'notes';

/** 八度点上下限（与 core/model.ts、io/json.ts 的钳制保持一致） */
export const MAX_OCTAVE_DOT = 2;

export interface TransposeStats {
  /** 音高被改写的音符个数（`'key'` 模式恒为 0：谱面数字不动） */
  notesChanged: number;
  /** 八度点越出 ±2 被压回的音符个数（这些音符的实际音高会差一个八度） */
  clamped: number;
}

/** 音程名（按半音数），用于 UI 文案 */
const INTERVAL_NAMES = [
  '纯一度',
  '小二度',
  '大二度',
  '小三度',
  '大三度',
  '纯四度',
  '增四度',
  '纯五度',
  '小六度',
  '大六度',
  '小七度',
  '大七度',
  '纯八度',
];

/** 半音数 -> 音程名：12 → 纯八度，13 → 纯八度 + 小二度，24 → 2 个八度 */
export function intervalName(semitones: number): string {
  const n = Math.abs(Math.round(semitones));
  const octaves = Math.floor(n / 12);
  const rest = n % 12;
  if (octaves === 0) return INTERVAL_NAMES[n];
  const octavePart = octaves === 1 ? '纯八度' : `${octaves} 个八度`;
  return rest === 0 ? octavePart : `${octavePart} + ${INTERVAL_NAMES[rest]}`;
}

/** 简谱音高写法：`#4` / `b7` / `1'` / `2,,`（与 core/jianpu-text.ts 的记法一致） */
export function formatPitch(m: PitchMapping): string {
  const acc = m.accidental === 'sharp' ? '#' : m.accidental === 'flat' ? 'b' : '';
  const dots = m.octave > 0 ? "'".repeat(m.octave) : m.octave < 0 ? ','.repeat(-m.octave) : '';
  return `${acc}${m.degree}${dots}`;
}

/**
 * 单个音符移 semitones 个半音后的记法。
 *
 * 拼写走 constants.ts 的 `pitchToMapping`（`CHROMATIC_TABLE`：相对调主的半音数 → 音级 + 升降号），
 * 与 MIDI 导入用的是同一套约定，所以「导入 → 移调 → 导出」不会写出两种升降号写法。
 * 八度由 `pitchToMapping` 按调主窗口（C4–B4，见 `tonicMidiBase`）算出：移调跨过窗口边界就多 / 少一个八度点。
 * 八度点钳制到 ±MAX_OCTAVE_DOT，被压回的记入 clamped（这些音符的实际音高会差一个八度）。
 */
function mapNote(
  ev: NoteEvent,
  base: number,
  semitones: number,
  preferFlat: boolean,
): { mapping: PitchMapping; clamped: boolean } {
  const midi = mappingToMidi({ degree: ev.degree, accidental: ev.accidental, octave: ev.octave }, base);
  const next = pitchToMapping(midi + semitones, base, preferFlat);
  const octave = Math.max(-MAX_OCTAVE_DOT, Math.min(MAX_OCTAVE_DOT, next.octave));
  return { mapping: { degree: next.degree, accidental: next.accidental, octave }, clamped: octave !== next.octave };
}

/** 遍历全曲音符改写音高；write = false 时只统计（供对话框实时预览，不改谱面） */
function walkNotes(bars: Bar[], tonic: Tonic, semitones: number, write: boolean): TransposeStats {
  const base = tonicMidiBase(tonic);
  const preferFlat = isFlatKey(tonic);
  const stats: TransposeStats = { notesChanged: 0, clamped: 0 };
  for (const bar of bars) {
    for (const ev of bar.events) {
      // 音级不在 1..7 表里 = 旧工程文件里写成音符的休止（degree 0），没有音高可移
      if (!isNote(ev) || DEGREE_PC[ev.degree] === undefined) continue;
      const { mapping, clamped } = mapNote(ev, base, semitones, preferFlat);
      if (clamped) stats.clamped += 1;
      if (mapping.degree !== ev.degree || mapping.accidental !== ev.accidental || mapping.octave !== ev.octave) {
        stats.notesChanged += 1;
      }
      if (write) {
        ev.degree = mapping.degree;
        ev.accidental = mapping.accidental;
        ev.octave = mapping.octave;
      }
    }
  }
  return stats;
}

/** 逐音符改写音高（就地修改 bars），调号保持不变 */
export function transposeNotesInPlace(bars: Bar[], tonic: Tonic, semitones: number): TransposeStats {
  return walkNotes(bars, tonic, semitones, true);
}

/** 不移调、只统计「会改写多少音符 / 多少个八度点越界」，供对话框预览警告 */
export function transposeStatsFor(bars: Bar[], tonic: Tonic, semitones: number): TransposeStats {
  return walkNotes(bars, tonic, semitones, false);
}

/**
 * 按模式移调。`'key'` 模式不动 bars（调号由调用方改），`'notes'` 模式就地改写音符。
 * 返回的统计只针对音符改写，所以 `'key'` 模式恒为 0。
 */
export function transposeBars(
  bars: Bar[],
  tonic: Tonic,
  semitones: number,
  mode: TransposeMode,
): TransposeStats {
  if (mode === 'key') return { notesChanged: 0, clamped: 0 };
  return walkNotes(bars, tonic, semitones, true);
}

/**
 * 改调号之后**实际发声**的半音变化。
 *
 * 调主在模型里只有音名（`Tonic` 没有八度字段），发声时一律落在 C4–B4 这个窗口
 * （`tonicMidiBase` 的 octave 固定为 4）。所以「降低 5 个半音」把 1=C 改成 1=G 之后，
 * G 调主落在 G4，发声反而升高 7 个半音：音级关系完全正确，差的是一整个八度，
 * 而简谱的八度位置本来就由调号所在八度决定。UI 用这个函数把真实变化讲清楚。
 */
export function effectiveKeyShift(from: Tonic, to: Tonic): number {
  return tonicMidiBase(to) - tonicMidiBase(from);
}

export interface PitchPreview {
  before: string[];
  after: string[];
}

/**
 * 取全曲前 limit 个音符，给出移调前后的简谱写法，供对话框预览。
 * `'key'` 模式前后相同（数字不变，只是调号变了），此时调用方应说明「数字不变」。
 */
export function previewNotes(
  bars: Bar[],
  tonic: Tonic,
  semitones: number,
  mode: TransposeMode,
  limit = 8,
): PitchPreview {
  const base = tonicMidiBase(tonic);
  const preferFlat = isFlatKey(tonic);
  const before: string[] = [];
  const after: string[] = [];
  for (const bar of bars) {
    for (const ev of bar.events) {
      if (!isNote(ev) || DEGREE_PC[ev.degree] === undefined) continue;
      if (before.length >= limit) return { before, after };
      before.push(formatPitch(ev));
      // 'key' 模式数字不变（只是调号换了），预览原样给出
      after.push(mode === 'key' ? formatPitch(ev) : formatPitch(mapNote(ev, base, semitones, preferFlat).mapping));
    }
  }
  return { before, after };
}