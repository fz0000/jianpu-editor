/**
 * 「休止符合并」：把小节内连续的休止符合并成更少的休止符。
 *
 * 量化导入常把一段长休止摊成一串小休止，例如 4 拍写成「0:4. 0:4. 0:4」三个休止。
 * 简谱里它就是「0:1」一个全休止。这个后处理做这种合并：
 *
 * - 休止符**不能用增时线延长**（增时线只延长音符），所以拼写只用纯时值（allowDashes=false）。
 * - 只在同一小节内合并：跨小节的休止各自属于不同小节，不能合并。
 * - 只有「时值能精确表示 + 休止符数量确实减少」才改写，所以可反复运行（幂等）。
 */
import {
  isRest,
  makeRest,
  restBeats,
  type Bar,
  type RestEvent,
  type ScoreEvent,
} from './model';
import { EPS, representDuration } from './spelling';

/** 默认量化网格：十六分，与连音线合并保持一致 */
export const DEFAULT_REST_GRID = 0.25;

export interface CompactRestOptions {
  /** 量化网格，以四分音符 = 1 拍计：0.5=八分, 0.25=十六分 */
  grid?: number;
}

export interface CompactRestStats {
  /** 被合并掉的休止符数量 */
  restsRemoved: number;
  /** 被移除的事件数量 */
  eventsRemoved: number;
  /** 被改写的小节数 */
  barsChanged: number;
}

function compactBar(bar: Bar, grid: number): { events: ScoreEvent[]; restsRemoved: number; eventsRemoved: number } {
  const out: ScoreEvent[] = [];
  let restsRemoved = 0;
  let eventsRemoved = 0;
  let i = 0;

  while (i < bar.events.length) {
    const head = bar.events[i];
    if (!isRest(head)) {
      out.push(head);
      i += 1;
      continue;
    }

    // 收集这一段连续休止
    let j = i;
    let beats = 0;
    while (j < bar.events.length) {
      const ev = bar.events[j];
      if (!isRest(ev)) break;
      beats += restBeats(ev);
      j += 1;
    }
    const span = j - i;

    const segments = representDuration(beats, grid, false);
    const covered = segments.reduce((acc, s) => acc + s.covered, 0);
    const exact = Math.abs(covered - beats) < EPS;
    // 休止符后不能接增时线：拼写里只要出现增时线就整段放弃
    const clean = exact && segments.every((s) => s.dashes === 0);

    if (span < 2 || !clean || segments.length >= span) {
      for (let k = i; k < j; k += 1) out.push(bar.events[k]);
      i = j;
      continue;
    }

    const first = head as RestEvent;
    const merged = segments.map((seg, idx) => {
      const rest = makeRest(seg.duration, seg.dotted);
      // 段首沿用原 id，撤消后光标定位更稳
      if (idx === 0) rest.id = first.id;
      return rest;
    });
    out.push(...merged);
    restsRemoved += span - merged.length;
    eventsRemoved += span - merged.length;
    i = j;
  }

  return { events: out, restsRemoved, eventsRemoved };
}

/**
 * 全谱合并连续休止符。返回新的小节数组（未改动的小节沿用原对象）与统计。
 * 拍数逐小节守恒，播放计划不变。
 */
export function compactRestRuns(
  bars: Bar[],
  opts: CompactRestOptions = {},
): { bars: Bar[]; stats: CompactRestStats } {
  const grid = opts.grid && opts.grid > 0 ? opts.grid : DEFAULT_REST_GRID;
  const stats: CompactRestStats = { restsRemoved: 0, eventsRemoved: 0, barsChanged: 0 };

  const next = bars.map((bar) => {
    const { events, restsRemoved, eventsRemoved } = compactBar(bar, grid);
    if (restsRemoved === 0) return bar;
    stats.restsRemoved += restsRemoved;
    stats.eventsRemoved += eventsRemoved;
    stats.barsChanged += 1;
    return { ...bar, events };
  });

  return { bars: next, stats };
}
