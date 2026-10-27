import { describe, expect, it } from 'vitest';
import {
  bestSpelling,
  representDuration,
  segmentEventCount,
  segmentTieCount,
  type Segment,
} from '../src/core/spelling';

/** `2. ` = 附点二分，`4-2` = 四分音符 + 两条增时线 */
const shape = (segs: Segment[]): string[] =>
  segs.map((s) => `${s.duration}${s.dotted ? '.' : ''}${s.dashes ? `-${s.dashes}` : ''}`);

const cost = (segs: Segment[]): { ties: number; events: number } => ({
  ties: segs.reduce((acc, s, i) => acc + segmentTieCount(s, i === 0), 0),
  events: segs.reduce((acc, s) => acc + segmentEventCount(s), 0),
});

const covered = (segs: Segment[]): number => segs.reduce((acc, s) => acc + s.covered, 0);

describe('bestSpelling：连音线最少、记号最少的最优拼写', () => {
  it('3.75 拍 → 四分 + 两条增时线 + 附点八分（1 条连音线），胜过贪心的 3 条', () => {
    const segs = bestSpelling(3.75, 0.25, true);

    expect(segs).not.toBeNull();
    expect(shape(segs!)).toEqual(['4-2', '8.']);
    expect(cost(segs!)).toEqual({ ties: 1, events: 4 });
    // 贪心版本：附点四分 + 两条增时线 + 十六分，连音线多两条
    expect(cost(representDuration(3.75, 0.25, true))).toEqual({ ties: 3, events: 4 });
  });

  it('3.25 拍 → 四分 + 两条增时线 + 十六分（长时值写在前面）', () => {
    const segs = bestSpelling(3.25, 0.25, true)!;

    expect(shape(segs)).toEqual(['4-2', '16']);
    expect(cost(segs).ties).toBe(1);
  });

  it('6 拍 → 二分音符 + 两条增时线，零连音线', () => {
    const segs = bestSpelling(6, 0.25, true)!;

    expect(shape(segs)).toEqual(['2-2']);
    expect(cost(segs)).toEqual({ ties: 0, events: 3 });
  });

  it('4 拍 → 一个全音符', () => {
    expect(shape(bestSpelling(4, 0.25, true)!)).toEqual(['1']);
  });

  it('简谱模型不写附点二分 / 附点全音符：3 拍给「四分 + 两条增时线」', () => {
    expect(shape(bestSpelling(3, 0.25, true)!)).toEqual(['4-2']);
    expect(shape(bestSpelling(6, 0.25, true)!)).toEqual(['2-2']);
  });

  it('2.5 拍写不成零连音线，最少一条', () => {
    const segs = bestSpelling(2.5, 0.25, true)!;

    expect(cost(segs).ties).toBe(1);
    expect(covered(segs)).toBeCloseTo(2.5);
  });

  it('总拍数逐段守恒', () => {
    for (const beats of [0.75, 1.25, 2.5, 3.25, 3.75, 5, 6, 7, 8]) {
      const segs = bestSpelling(beats, 0.25, true);
      expect(segs, `${beats} 拍`).not.toBeNull();
      expect(covered(segs!), `${beats} 拍`).toBeCloseTo(beats, 9);
    }
  });

  it('八分网格下每段都落在网格上', () => {
    const segs = bestSpelling(3, 0.5, true)!;

    segs.forEach((s) => expect(Math.round(s.covered / 0.5) * 0.5).toBeCloseTo(s.covered));
    expect(covered(segs)).toBeCloseTo(3);
  });

  it('拍数不在网格上（或为 0）时返回 null，调用方保留原写法', () => {
    expect(bestSpelling(1.1, 0.25, true)).toBeNull();
    expect(bestSpelling(0, 0.25, true)).toBeNull();
  });
});
