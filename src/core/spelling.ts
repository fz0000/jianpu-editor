/**
 * 时值拼写：把「拍数」翻译成简谱记号序列（音符 + 增时线 / 附点）。
 *
 * 原来住在 midi/quantize.ts 里，现在抽到 core，供两处共用：
 * - MIDI 导入量化（一个长音写成什么记号）
 * - 「简化连音线」后处理（一串同音连音线改写成多长的一串记号）
 */
import type { Duration } from './model';

export const EPS = 1e-9;

export const DURATION_ORDER: Duration[] = [1, 2, 4, 8, 16, 32];

export function isMultiple(value: number, grid: number): boolean {
  const ratio = value / grid;
  return Math.abs(ratio - Math.round(ratio)) < 1e-6;
}

/**
 * 增时线数量上限：简谱里「四分音符 + 3 条增时线」就是全音符，再多就不成谱了。
 *
 * 这条上限还顺带挡住一类坏选择：附点音符后面不能接增时线，那几条线会被
 * 展开成同音高的连音音符，于是一段就膨胀成一长串连音线——
 * 例如 3.25 拍若选成「附点八分 + 5 条增时线」，谱面就成了 6 个八分音符加 5 条连音线。
 */
export const MAX_DASHES = 3;

/** 「附点 + 增时线」会展开成连音线链，比「普通时值 + 增时线」更费谱面 */
export function dashPenalty(dotted: boolean, dashes: number): number {
  return dotted && dashes > 0 ? 1 : 0;
}

export interface Segment {
  duration: Duration;
  dotted: boolean;
  dashes: number;
  covered: number;
}

/** 在不超过 remaining 的前提下，选出覆盖最长的一段（音符 + 若干延长线） */
export function pickSegment(remaining: number, grid: number, allowDashes: boolean): Segment | null {
  let best: Segment | null = null;

  const consider = (duration: Duration, dotted: boolean, dashes: number, covered: number) => {
    if (covered <= 0) return;
    const cur = best;
    if (!cur) {
      best = { duration, dotted, dashes, covered };
      return;
    }
    if (covered > cur.covered + EPS) {
      best = { duration, dotted, dashes, covered };
      return;
    }
    if (Math.abs(covered - cur.covered) < EPS) {
      const penalty = dashPenalty(dotted, dashes);
      const curPenalty = dashPenalty(cur.dotted, cur.dashes);
      if (penalty < curPenalty) best = { duration, dotted, dashes, covered };
      else if (penalty === curPenalty && dashes < cur.dashes) best = { duration, dotted, dashes, covered };
      else if (penalty === curPenalty && dashes === cur.dashes && !dotted && cur.dotted) {
        best = { duration, dotted, dashes, covered };
      }
    }
  };

  for (const d of DURATION_ORDER) {
    const base = 4 / d;
    if (base > remaining + EPS) continue;
    if (!isMultiple(base, grid)) continue;

    const dashCount = allowDashes
      ? Math.min(MAX_DASHES, Math.floor((remaining - base) / base + EPS))
      : 0;
    consider(d, false, dashCount, base * (dashCount + 1));

    if (d > 2) {
      const dottedCovered = base * 1.5;
      if (dottedCovered <= remaining + EPS && isMultiple(dottedCovered, grid)) {
        const dc = allowDashes
          ? Math.min(MAX_DASHES, Math.floor((remaining - dottedCovered) / base + EPS))
          : 0;
        consider(d, true, dc, dottedCovered + dc * base);
      }
    }
  }
  return best;
}

export function representDuration(beats: number, grid: number, allowDashes = true): Segment[] {
  const segments: Segment[] = [];
  let remaining = beats;
  let guard = 0;
  while (remaining > EPS && guard < 64) {
    guard += 1;
    const seg = pickSegment(remaining, grid, allowDashes);
    if (!seg) break;
    segments.push(seg);
    remaining -= seg.covered;
  }
  return segments;
}

/** 一段记号占多少个事件：数字本身 + 每根增时线（附点段的增时线只能写成连音音符） */
export function segmentEventCount(seg: Segment): number {
  return 1 + seg.dashes;
}

/** 一段记号里有多少条连音线：附点段的增时线要写成同音连音音符，段首除外 */
export function segmentTieCount(seg: Segment, isFirst: boolean): number {
  return seg.dotted ? seg.dashes + (isFirst ? 0 : 1) : isFirst ? 0 : 1;
}

/**
 * 最优拼写：在所有「精确覆盖 beats」的写法里，选**连音线最少、其次记号最少**的一串段。
 *
 * 贪心的 `representDuration` 只追求「每段覆盖最长」，会错过更省连音线的写法：
 * 3.75 拍贪心给「附点四分 + 两条增时线 + 十六分」（4 个记号、3 条连音线），
 * 最优是「附点二分 + 附点八分」（2 个记号、1 条连音线）。
 *
 * 做法是按网格步数递推的动态规划：状态 = 已覆盖的网格步数，转移 = 追加一段记号，
 * 代价按（连音线数, 记号数, 增时线数）字典序比较。
 * 拍数不是网格整数倍、或网格细到步数超过 512 时返回 `null`，调用方退回贪心写法。
 */
export function bestSpelling(beats: number, grid: number, allowDashes: boolean): Segment[] | null {
  if (beats <= EPS || grid <= 0) return null;
  const steps = Math.round(beats / grid);
  if (Math.abs(steps * grid - beats) > 1e-6) return null;
  if (steps > 512) return null;

  interface Cand {
    seg: Segment;
    events: number;
    tiesFirst: number;
    tiesRest: number;
  }
  const byCover = new Map<number, Cand[]>();
  const push = (duration: Duration, dotted: boolean, dashes: number, covered: number): void => {
    // 段覆盖的拍数必须正好落在网格上，否则会把时值悄悄改掉
    if (!isMultiple(covered, grid)) return;
    const cover = Math.round(covered / grid);
    if (cover <= 0 || cover > steps) return;
    const seg: Segment = { duration, dotted, dashes, covered: cover * grid };
    const cand: Cand = {
      seg,
      events: segmentEventCount(seg),
      tiesFirst: segmentTieCount(seg, true),
      tiesRest: segmentTieCount(seg, false),
    };
    const list = byCover.get(cover);
    if (list) list.push(cand);
    else byCover.set(cover, [cand]);
  };

  for (const d of DURATION_ORDER) {
    const base = 4 / d;
    if (!isMultiple(base, grid)) continue;
    const dashMax = allowDashes ? MAX_DASHES : 0;
    for (let k = 0; k <= dashMax; k += 1) {
      push(d, false, k, base * (k + 1));
      // 全音符 / 二分音符不带附点（简谱里不写「附点全音符」）
      if (d > 2) push(d, true, k, base * (1.5 + k));
    }
  }

  const INF = Number.POSITIVE_INFINITY;
  const ties: number[] = new Array(steps + 1).fill(INF);
  const events: number[] = new Array(steps + 1).fill(INF);
  const dashTotals: number[] = new Array(steps + 1).fill(INF);
  const prevStep: number[] = new Array(steps + 1).fill(-1);
  const prevCand: (Cand | null)[] = new Array(steps + 1).fill(null);
  ties[0] = 0;
  events[0] = 0;
  dashTotals[0] = 0;

  const better = (t: number, t0: number, e: number, e0: number, dd: number, dd0: number): boolean =>
    t < t0 || (t === t0 && (e < e0 || (e === e0 && dd < dd0)));

  const pathOf = (k: number): Segment[] => {
    const segs: Segment[] = [];
    for (let p = k; p > 0; p = prevStep[p]) {
      const c = prevCand[p];
      if (!c) break;
      segs.unshift(c.seg);
    }
    return segs;
  };

  /** 代价完全相同时，长时值写在前面（`2 - -` 而不是 `16 2~ - -`），符合简谱书写习惯 */
  const preferLongerFirst = (a: Segment[], b: Segment[]): boolean => {
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i += 1) {
      const ba = 4 / a[i].duration;
      const bb = 4 / b[i].duration;
      if (Math.abs(ba - bb) > EPS) return ba > bb;
      if (a[i].dotted !== b[i].dotted) return a[i].dotted;
    }
    return a.length < b.length;
  };

  for (let k = 0; k <= steps; k += 1) {
    if (!Number.isFinite(ties[k])) continue;
    for (const [cover, cands] of byCover) {
      const next = k + cover;
      if (next > steps) continue;
      for (const c of cands) {
        const t = ties[k] + (k === 0 ? c.tiesFirst : c.tiesRest);
        const e = events[k] + c.events;
        const dd = dashTotals[k] + c.seg.dashes;
        const win = better(t, ties[next], e, events[next], dd, dashTotals[next]);
        const equal = t === ties[next] && e === events[next] && dd === dashTotals[next];
        if (win || (equal && preferLongerFirst([...pathOf(k), c.seg], pathOf(next)))) {
          ties[next] = t;
          events[next] = e;
          dashTotals[next] = dd;
          prevStep[next] = k;
          prevCand[next] = c;
        }
      }
    }
  }

  if (!Number.isFinite(ties[steps])) return null;

  const segs: Segment[] = [];
  for (let k = steps; k > 0; k = prevStep[k]) {
    const c = prevCand[k];
    if (!c || prevStep[k] < 0) return null;
    segs.unshift(c.seg);
  }
  return segs.length > 0 ? segs : null;
}
