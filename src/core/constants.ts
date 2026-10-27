import type { Accidental, Degree, Duration, Tonic } from './model';

export const LETTER_PC: Record<string, number> = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11,
};

/** 大调音阶中各音级相对调主的半音数 */
export const DEGREE_PC: Record<Degree, number> = { 1: 0, 2: 2, 3: 4, 4: 5, 5: 7, 6: 9, 7: 11 };

export const DURATIONS: Duration[] = [1, 2, 4, 8, 16, 32];

export const DURATION_LABELS: Record<Duration, string> = {
  1: '全音符',
  2: '二分音符',
  4: '四分音符',
  8: '八分音符',
  16: '十六分音符',
  32: '三十二分音符',
};

/** 升号调顺序（sharps 0..7） */
export const SHARP_KEYS = ['C', 'G', 'D', 'A', 'E', 'B', 'F#'];
/** 降号调顺序（flats 0..7，用负数表示） */
export const FLAT_KEYS = ['C', 'F', 'Bb', 'Eb', 'Ab', 'Db', 'Gb'];

/**
 * 全部常用调，用于 UI 下拉。升号调在前、降号调在后（五度圈顺序）。
 * 必须覆盖 `shiftTonic` 能产出的每一个调名，否则「乐曲信息」/「导入 MIDI」的下拉
 * 显示不出当前调（全曲移调可以走到 `1=D#` 这类偏门调）。
 */
export const ALL_TONICS: string[] = [
  'C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#', 'G#', 'D#', 'A#',
  'F', 'bB', 'bE', 'bA', 'bD', 'bG',
];

export function accidentalOffset(a: Accidental): number {
  return a === 'sharp' ? 1 : a === 'flat' ? -1 : 0;
}

/**
 * 解析调名，两种写法都认：升降号在前（`bB` / `#F`，`formatTonic` 与 `ALL_TONICS` 用的格式）、
 * 升降号在后（`Bb` / `F#`，`SHARP_KEYS` / `FLAT_KEYS` 用的格式）。
 * 只认单个升降号；认不出音名就退回 C。
 */
export function parseTonic(raw: string): Tonic {
  const s = String(raw).trim();
  let accidental: Accidental = 'natural';
  let i = 0;
  while (i < s.length && (s[i] === '#' || s[i] === 'b')) {
    accidental = s[i] === '#' ? 'sharp' : 'flat';
    i += 1;
  }
  const letter = (s[i] ?? '').toUpperCase() as Tonic['letter'];
  // 注意用 undefined 判断，不能用 !LETTER_PC[letter]：C 的音级类是 0，取反会把 C# 的升降号一起吃掉
  if (LETTER_PC[letter] === undefined) return { letter: 'C', accidental: 'natural' };
  // 后缀写法：'F#' / 'Bb'（只认紧跟音名的那一个，'F##' 之类不当作合法调名）
  const tail = s.slice(i + 1);
  if (tail === '#') accidental = 'sharp';
  else if (tail === 'b') accidental = 'flat';
  return { letter, accidental };
}

export function formatTonic(t: Tonic): string {
  if (t.accidental === 'sharp') return `${t.letter}#`;
  if (t.accidental === 'flat') return `b${t.letter}`;
  return t.letter;
}

/** 调主在 MIDI 音高上的位置，octave=4 时 C -> 60 (C4) */
export function tonicMidiBase(t: Tonic, octave = 4): number {
  return 12 * (octave + 1) + LETTER_PC[t.letter] + accidentalOffset(t.accidental);
}

/** 调主的音级类（0=C, 1=C#/Db, …, 11=B）；音名里的升降号都算进去 */
export function tonicPc(letter: Tonic['letter'], accidental: Accidental): number {
  const pc = LETTER_PC[letter] + accidentalOffset(accidental);
  return ((pc % 12) + 12) % 12;
}

/**
 * 把调主按半音数平移（正 = 升高），得到移调后的新调。
 * 升降偏好沿用原调：降号调继续写降号（F → bG），升号调继续写升号（D → D#）；
 * C 调按移动方向选（向下用降号 1=bB，向上用升号 1=C#）。
 */
export function shiftTonic(t: Tonic, semitones: number, preferFlat?: boolean): Tonic {
  const useFlat = preferFlat ?? (isFlatKey(t) || (semitones < 0 && keySignatureSharps(t) === 0));
  return tonicFromPc(tonicMidiBase(t) + semitones, useFlat);
}

export function isFlatKey(t: Tonic): boolean {
  return t.accidental === 'flat' || ['F', 'Bb', 'Eb', 'Ab', 'Db', 'Gb'].includes(t.letter);
}

/** 调号对应的升降数量（正=升号数，负=降号数） */
export function keySignatureSharps(t: Tonic): number {
  const label = formatTonic(t);
  const flatIdx = FLAT_KEYS.findIndex((k) => normalizeKeyLabel(k) === label);
  if (flatIdx > 0) return -flatIdx;
  const sharpIdx = SHARP_KEYS.findIndex((k) => normalizeKeyLabel(k) === label);
  if (sharpIdx > 0) return sharpIdx;
  // 表外的调（`A#` / `C#` 这类移调走出来的异名调）按音级类取升降号最少的写法：A# 记 2 个降号
  return PC_SHARPS_FALLBACK[tonicPc(t.letter, t.accidental)];
}

/** 音级类 -> 调号数；表外调的兜底，取异名同音里记号最少的那个（pc 6 = F# 记 6 个升号） */
const PC_SHARPS_FALLBACK = [0, -5, 2, -3, 4, -1, 6, 1, -4, 3, -2, 5];

/** 'Bb' → 'bB'：调号表写「字母 + 升降号」，formatTonic 写「升降号 + 字母」，比较前统一成后者 */
function normalizeKeyLabel(name: string): string {
  const letter = name[0];
  if (name[1] === 'b') return `b${letter}`;
  if (name[1] === '#') return `${letter}#`;
  return letter;
}

export function tonicFromSharps(sharps: number): Tonic {
  if (sharps >= 0) return parseTonic(SHARP_KEYS[Math.min(sharps, 7)]);
  return parseTonic(FLAT_KEYS[Math.min(-sharps, 7)]);
}

export interface DegreeHit {
  degree: Degree;
  accidental: Accidental;
}

/** 相对调主的半音数 -> (音级, 升降号) 候选表 */
const CHROMATIC_TABLE: DegreeHit[][] = [
  [{ degree: 1, accidental: 'natural' }],
  [{ degree: 1, accidental: 'sharp' }, { degree: 2, accidental: 'flat' }],
  [{ degree: 2, accidental: 'natural' }],
  [{ degree: 2, accidental: 'sharp' }, { degree: 3, accidental: 'flat' }],
  [{ degree: 3, accidental: 'natural' }],
  [{ degree: 4, accidental: 'natural' }],
  [{ degree: 4, accidental: 'sharp' }, { degree: 5, accidental: 'flat' }],
  [{ degree: 5, accidental: 'natural' }],
  [{ degree: 5, accidental: 'sharp' }, { degree: 6, accidental: 'flat' }],
  [{ degree: 6, accidental: 'natural' }],
  [{ degree: 6, accidental: 'sharp' }, { degree: 7, accidental: 'flat' }],
  [{ degree: 7, accidental: 'natural' }],
];

export interface PitchMapping {
  degree: Degree;
  accidental: Accidental;
  octave: number;
}

/** 把 MIDI 音高映射为简谱的 (音级, 升降号, 八度) */
export function pitchToMapping(pitch: number, tonicBase: number, preferFlat: boolean): PitchMapping {
  const rel = pitch - tonicBase;
  const octave = Math.floor(rel / 12);
  const pc = ((rel % 12) + 12) % 12;
  const candidates = CHROMATIC_TABLE[pc];
  const hit = preferFlat ? candidates[candidates.length - 1] : candidates[0];
  return { degree: hit.degree, accidental: hit.accidental, octave };
}

export function mappingToMidi(m: PitchMapping, tonicBase: number): number {
  return tonicBase + 12 * m.octave + DEGREE_PC[m.degree] + accidentalOffset(m.accidental);
}

/** 统计一组 MIDI 音高，推断最可能的调主（大调） */
export function inferTonic(pitches: number[], preferFlatHint = false): Tonic {
  if (pitches.length === 0) return { letter: 'C', accidental: 'natural' };
  const counts = new Array(12).fill(0);
  for (const p of pitches) counts[((p % 12) + 12) % 12] += 1;

  let best: { tonic: Tonic; score: number } | null = null;
  for (let root = 0; root < 12; root += 1) {
    const scale = new Set<number>();
    for (const pc of Object.values(DEGREE_PC)) scale.add((root + pc) % 12);
    let inScale = 0;
    let total = 0;
    for (let pc = 0; pc < 12; pc += 1) {
      total += counts[pc];
      if (scale.has(pc)) inScale += counts[pc];
    }
    if (total === 0) break;
    // 命中率为主，调主本身出现次数作为加分（主音通常最频繁）
    const score = inScale / total + (counts[root] / total) * 0.35;
    if (!best || score > best.score + 1e-9) {
      const useFlat = preferFlatHint ? root > 6 : root >= 6;
      best = { tonic: tonicFromPc(root, useFlat), score };
    }
  }
  return best ? best.tonic : { letter: 'C', accidental: 'natural' };
}

const PC_TO_TONIC_SHARP: string[] = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const PC_TO_TONIC_FLAT: string[] = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

/**
 * 「字母 + 升降号」的音级名（'C#' / 'Db'）-> 调主。
 * 表里已经按「升号调用升号、降号调用降号」选好异名同音的写法，这里只做机械拆分，
 * 不走 parseTonic（它认不出来的输入会悄悄退回 C）。
 */
function tonicFromName(name: string): Tonic {
  const letter = name[0].toUpperCase() as Tonic['letter'];
  const accidental: Accidental = name[1] === '#' ? 'sharp' : name[1] === 'b' ? 'flat' : 'natural';
  return { letter, accidental };
}

export function tonicFromPc(pc: number, preferFlat: boolean): Tonic {
  const norm = ((pc % 12) + 12) % 12;
  return tonicFromName(preferFlat ? PC_TO_TONIC_FLAT[norm] : PC_TO_TONIC_SHARP[norm]);
}

export function midiToNoteName(pitch: number): string {
  const octave = Math.floor(pitch / 12) - 1;
  return `${PC_TO_TONIC_SHARP[pitch % 12]}${octave}`;
}
