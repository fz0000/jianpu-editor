import {
  makeBar,
  makeDash,
  makeNote,
  makeRest,
  measureBeats,
  type Bar,
  type NoteEvent,
  type TimeSignature,
} from '../core/model';
import { pitchToMapping } from '../core/constants';
import { EPS, representDuration } from '../core/spelling';
import type { LyricEvent, MidiNote } from './smf';

export { representDuration, type Segment } from '../core/spelling';

export interface QuantizeOptions {
  /** 量化网格，以四分音符 = 1 拍计：0.5=八分, 0.25=十六分, 0.125=三十二分 */
  grid: number;
  /** 小于该拍数的间隙并入前一个音符，不写休止符 */
  minRestBeats: number;
  timeSig: TimeSignature;
  /** 调主的 MIDI 音高（决定 1=X） */
  tonicBase: number;
  preferFlat: boolean;
  /** 歌词事件（绝对 tick）；量化后按 tick 挂到对应音符上，不传即不写歌词 */
  lyrics?: LyricEvent[];
}

export interface BeatNote {
  start: number;
  end: number;
  midi: number;
  velocity: number;
}

export function snapToGrid(value: number, grid: number): number {
  return Math.round(value / grid) * grid;
}

/**
 * 零时长音补长的上限（拍）。一个全音符 = 4 拍，是简谱单个记号能写出的最长时值；
 * 超过就留间隙给休止符——乐句末尾的音节后面常跟着整段间奏，不能补成跨十几拍的长音。
 */
export const SHORT_NOTE_MAX_FILL_BEATS = 4;

/** tick -> 拍，并做网格对齐与间隙平滑 */
export function toBeatNotes(notes: MidiNote[], division: number, opts: QuantizeOptions): BeatNote[] {
  const sorted = notes
    .map((n) => ({
      start: Math.max(0, n.start / division),
      end: Math.max(0, (n.start + n.duration) / division),
      midi: n.midi,
      velocity: n.velocity,
    }))
    .sort((a, b) => a.start - b.start || a.end - b.end);

  const snapped: BeatNote[] = [];
  /** 原始时值短于一个网格的音（零时长记号），时值由补长规则决定，不是由吸附决定 */
  const zeroLength: boolean[] = [];
  for (const n of sorted) {
    const start = snapToGrid(n.start, opts.grid);
    let end = snapToGrid(n.end, opts.grid);
    if (end <= start + EPS) end = start + opts.grid;
    snapped.push({ start, end, midi: n.midi, velocity: n.velocity });
    zeroLength.push(n.end - n.start < opts.grid - EPS);
  }

  // 零时长音（SMF 里 note-off 与 note-on 落在同一 tick，导出器写成 1 tick）在网格上写不出来：
  // 吸附后会被吹成一整个网格，紧跟的缝再落成碎休止符——「4// 0./」这种谱面就是这么来的。
  // 这类音几乎都带歌词音节，是「音节起点」记号，唱到下一个音为止，所以补长到下一个音的起点
  // （上限 SHORT_NOTE_MAX_FILL_BEATS）；补不到的那截仍按间隙处理，该写休止符就写休止符。
  for (let i = 0; i < snapped.length - 1; i += 1) {
    if (!zeroLength[i]) continue;
    const cur = snapped[i];
    const limit = Math.min(snapped[i + 1].start, cur.start + SHORT_NOTE_MAX_FILL_BEATS);
    if (limit > cur.end + EPS) cur.end = limit;
  }

  for (let i = 1; i < snapped.length; i += 1) {
    const prev = snapped[i - 1];
    const cur = snapped[i];
    const gap = cur.start - prev.end;
    if (gap > EPS && gap < opts.minRestBeats - EPS) prev.end = cur.start;
  }
  return snapped;
}

/**
 * 把 MIDI 音符量化并切分成简谱小节。
 * 策略：网格占位 + 按小节游程编码，天然处理跨小节音符（自动加连音线）。
 */
export function quantizeToBars(notes: MidiNote[], division: number, opts: QuantizeOptions): Bar[] {
  const snapped = toBeatNotes(notes, division, opts);
  const barBeats = measureBeats(opts.timeSig);
  // 拍号 / 网格坏掉时下面全变成 NaN 索引，最后崩在 `bars[0].left` 的英文 TypeError 上（用户看不懂），
  // 所以在这里按项目约定抛中文错误，交给 UI 层 toast 显示。
  if (!Number.isFinite(barBeats) || barBeats <= 0) {
    throw new Error(`拍号不合法：${opts.timeSig.num}/${opts.timeSig.den}`);
  }
  if (!Number.isFinite(opts.grid) || opts.grid <= 0) throw new Error('量化网格不合法');
  const unitsPerBar = Math.max(1, Math.round(barBeats / opts.grid));

  if (snapped.length === 0) {
    const bar = makeBar([]);
    bar.right = 'final';
    return [bar];
  }

  const maxEnd = snapped.reduce((acc, n) => Math.max(acc, n.end), 0);
  const totalUnits = Math.max(unitsPerBar, Math.ceil(maxEnd / opts.grid - EPS));
  const nBars = Math.max(1, Math.ceil(totalUnits / unitsPerBar));
  const cellCount = nBars * unitsPerBar;

  const cells = new Int32Array(cellCount).fill(-1);
  for (let i = 0; i < snapped.length; i += 1) {
    const n = snapped[i];
    const s = Math.max(0, Math.round(n.start / opts.grid));
    const e = Math.min(cellCount, Math.round(n.end / opts.grid));
    for (let u = s; u < e; u += 1) cells[u] = i;
  }

  const bars: Bar[] = [];
  let lastRunOfPrevBar = -2;
  /** 每个音符游程在谱面上的第一个记号：歌词只挂在这里 */
  const runHead = new Map<number, NoteEvent>();

  for (let b = 0; b < nBars; b += 1) {
    const bar = makeBar([]);
    const base = b * unitsPerBar;
    let lastRunOfThisBar = -2;
    let u = 0;

    while (u < unitsPerBar) {
      const value = cells[base + u];
      let len = 1;
      while (u + len < unitsPerBar && cells[base + u + len] === value) len += 1;
      const beats = len * opts.grid;

      if (value === -1) {
        if (beats >= barBeats - EPS && u === 0) {
          bar.events.push(makeRest(1));
        } else {
          for (const seg of representDuration(beats, opts.grid, false)) {
            bar.events.push(makeRest(seg.duration, seg.dotted));
          }
        }
        lastRunOfThisBar = -1;
      } else {
        const src = snapped[value];
        const mapping = pitchToMapping(src.midi, opts.tonicBase, opts.preferFlat);
        const continues = u === 0 && lastRunOfPrevBar === value;
        const segments = representDuration(beats, opts.grid, true);
        segments.forEach((seg, i) => {
          const note = makeNote(mapping.degree, seg.duration, {
            octave: mapping.octave,
            accidental: mapping.accidental,
            dotted: seg.dotted,
            velocity: Math.max(1, Math.min(127, Math.round(src.velocity))),
            tie: (continues && i === 0) || i > 0,
          });
          // 游程首记号（跨小节时是最前面那个，不是续接的连音音符）留给歌词
          if (i === 0 && !runHead.has(value)) runHead.set(value, note);
          bar.events.push(note);
          if (seg.dotted && seg.dashes > 0) {
            for (let d = 0; d < seg.dashes; d += 1) {
              bar.events.push(
                makeNote(mapping.degree, seg.duration, {
                  octave: mapping.octave,
                  accidental: mapping.accidental,
                  tie: true,
                  velocity: Math.max(1, Math.min(127, Math.round(src.velocity))),
                }),
              );
            }
          } else {
            for (let d = 0; d < seg.dashes; d += 1) bar.events.push(makeDash());
          }
        });
        lastRunOfThisBar = value;
      }
      u += len;
    }

    bars.push(bar);
    lastRunOfPrevBar = lastRunOfThisBar;
  }

  bars[0].left = 'normal';
  bars[bars.length - 1].right = 'final';

  if (opts.lyrics && opts.lyrics.length > 0) {
    attachLyrics(opts.lyrics, cells, runHead, division, opts.grid);
  }
  return bars;
}

/**
 * 把歌词音节挂到音符上：tick -> 拍 -> 网格单元 -> 该单元所属音符游程的首记号。
 *
 * - 落在休止 / 间隙上的音节（前奏、间奏里的 lyric 事件）直接丢弃，谱面上没有对应的音。
 * - 纯连字符 / 延音线（SMF 惯例：'-' 连字、'_' 延音）不是音节，丢掉——
 *   解析层（midi/smf.ts）忠实保留全部 lyric 事件，这里只决定谱面上写什么。
 * - 同一个音符上的多个音节（长音上写了多条 lyric）连写拼接，中文歌词正好连成词。
 * - 只挂首记号：增时线与连音续接音符不挂，这样后续「简化连音线」合并时不会被吞
 *   （core/tie-compact.ts 遇到带歌词的音符就停链，歌词原样保留）。
 */
function attachLyrics(
  lyrics: LyricEvent[],
  cells: Int32Array,
  runHead: Map<number, NoteEvent>,
  division: number,
  grid: number,
): void {
  for (const ly of lyrics) {
    if (/^[-–—_~\s\u3000]+$/.test(ly.text)) continue;
    const unit = Math.round(ly.tick / division / grid);
    if (!Number.isFinite(unit) || unit < 0 || unit >= cells.length) continue;
    const head = runHead.get(cells[unit]);
    if (!head) continue;
    head.lyric += ly.text;
  }
}