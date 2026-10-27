import { describe, expect, it } from 'vitest';
import { barBeatLength, isNote, isRest, makeBar, makeNote, type TimeSignature } from '../src/core/model';
import { quantizeToBars, representDuration, snapToGrid, toBeatNotes, SHORT_NOTE_MAX_FILL_BEATS } from '../src/midi/quantize';
import type { MidiNote } from '../src/midi/smf';

const DIV = 480;
const TS44: TimeSignature = { num: 4, den: 4 };

function note(midi: number, startBeat: number, beats: number, velocity = 96): MidiNote {
  return {
    midi,
    channel: 0,
    start: Math.round(startBeat * DIV),
    duration: Math.round(beats * DIV),
    velocity,
  };
}

describe('snapToGrid', () => {
  it('对齐到最近的网格点', () => {
    expect(snapToGrid(1.03, 0.5)).toBe(1);
    expect(snapToGrid(1.26, 0.5)).toBe(1.5);
    expect(snapToGrid(0.9, 0.5)).toBe(1);
    expect(snapToGrid(2.49, 0.25)).toBe(2.5);
  });
});

describe('representDuration', () => {
  it('优先用更长的基本时值，必要时补延长线', () => {
    expect(representDuration(4, 0.5)).toEqual([
      { duration: 1, dotted: false, dashes: 0, covered: 4 },
    ]);
  });

  it('3 拍 -> 四分音符 + 两条增时线（简谱不用附点二分音符）', () => {
    expect(representDuration(3, 0.5)).toEqual([
      { duration: 4, dotted: false, dashes: 2, covered: 3 },
    ]);
  });

  it('1.5 拍 -> 附点四分音符', () => {
    expect(representDuration(1.5, 0.5)).toEqual([
      { duration: 4, dotted: true, dashes: 0, covered: 1.5 },
    ]);
  });

  it('2.5 拍 -> 附点四分音符 + 延长线', () => {
    expect(representDuration(2.5, 0.5)).toEqual([
      { duration: 4, dotted: true, dashes: 1, covered: 2.5 },
    ]);
  });

  it('网格不允许附点时退回普通时值组合', () => {
    const segments = representDuration(1.5, 1, false);
    const covered = segments.reduce((acc, s) => acc + s.covered, 0);
    expect(covered).toBe(1);
    expect(segments[0].dotted).toBe(false);
  });

  it('增时线永不超过 3 条', () => {
    const cases: Array<[number, number]> = [
      [0.25, 0.25],
      [0.75, 0.25],
      [1.25, 0.25],
      [1.75, 0.25],
      [2.25, 0.25],
      [2.75, 0.25],
      [3.25, 0.25],
      [3.75, 0.25],
      [4, 0.25],
      [0.5, 0.5],
      [1.5, 0.5],
      [2.5, 0.5],
      [3.5, 0.5],
      [4, 0.5],
    ];
    for (const [beats, grid] of cases) {
      for (const seg of representDuration(beats, grid)) {
        expect(seg.dashes, `${beats} 拍 grid=${grid}`).toBeLessThanOrEqual(3);
      }
    }
  });

  it('拆成多段也要覆盖完整时值', () => {
    for (const grid of [0.25, 0.5]) {
      for (let units = 1; units <= 16; units += 1) {
        const beats = units * grid;
        const covered = representDuration(beats, grid).reduce((acc, s) => acc + s.covered, 0);
        expect(covered, `${beats} 拍 grid=${grid}`).toBeCloseTo(beats);
      }
    }
  });

  it('3.25 拍不再选「附点八分 + 5 条增时线」（会展开成 6 个连音八分音符）', () => {
    expect(representDuration(3.25, 0.25)).toEqual([
      { duration: 4, dotted: false, dashes: 2, covered: 3 },
      { duration: 16, dotted: false, dashes: 0, covered: 0.25 },
    ]);
  });

  it('附点本身最省谱面时仍然优先附点', () => {
    expect(representDuration(1.5, 0.25)).toEqual([
      { duration: 4, dotted: true, dashes: 0, covered: 1.5 },
    ]);
    expect(representDuration(0.75, 0.25)).toEqual([
      { duration: 8, dotted: true, dashes: 0, covered: 0.75 },
    ]);
  });
});

describe('toBeatNotes', () => {
  it('按拍换算并排序', () => {
    const snapped = toBeatNotes([note(64, 2, 1), note(60, 0, 1)], DIV, {
      grid: 0.5,
      minRestBeats: 0.25,
      timeSig: TS44,
      tonicBase: 60,
      preferFlat: false,
    });
    expect(snapped.map((n) => n.midi)).toEqual([60, 64]);
    expect(snapped[0]).toMatchObject({ start: 0, end: 1 });
    expect(snapped[1]).toMatchObject({ start: 2, end: 3 });
  });

  it('小于阈值的间隙并入前一个音符', () => {
    const snapped = toBeatNotes([note(60, 0, 1), note(62, 1.25, 1)], DIV, {
      grid: 0.25,
      minRestBeats: 0.5,
      timeSig: TS44,
      tonicBase: 60,
      preferFlat: false,
    });
    expect(snapped[0].end).toBe(1.25);
  });

  it('零时长音（note-off 与 note-on 同 tick）补长到下一个音的起点', () => {
    // 导出器把「音节起点」写成 1 tick 的音（下一首歌_1_YAO.mid 有 80 个）：
    // 吸附后它会被吹成一整个网格，紧跟的缝再落成碎休止符（「4// 0./」就是这么来的）
    const snapped = toBeatNotes([note(60, 0, 1), note(60, 1, 1 / DIV), note(62, 2, 1)], DIV, {
      grid: 0.25,
      minRestBeats: 0.25,
      timeSig: TS44,
      tonicBase: 60,
      preferFlat: false,
    });
    expect(snapped[1]).toMatchObject({ start: 1, end: 2 });
  });

  it('零时长音最多补到一个全音符，补不到的那截仍是间隙', () => {
    const snapped = toBeatNotes([note(60, 0, 1 / DIV), note(62, 10, 1)], DIV, {
      grid: 0.25,
      minRestBeats: 0,
      timeSig: TS44,
      tonicBase: 60,
      preferFlat: false,
    });
    expect(snapped[0]).toMatchObject({ start: 0, end: SHORT_NOTE_MAX_FILL_BEATS });
  });

  it('时值写得出来的音不受补长规则影响', () => {
    const snapped = toBeatNotes([note(60, 0, 0.5), note(62, 2, 1)], DIV, {
      grid: 0.25,
      minRestBeats: 0,
      timeSig: TS44,
      tonicBase: 60,
      preferFlat: false,
    });
    expect(snapped[0]).toMatchObject({ start: 0, end: 0.5 });
  });

});

describe('quantizeToBars', () => {
  const opts = {
    grid: 0.5,
    minRestBeats: 0.25,
    timeSig: TS44,
    tonicBase: 60,
    preferFlat: false,
  };

  it('C 大调音阶量化为两个小节', () => {
    const pitches = [60, 62, 64, 65, 67, 69, 71, 72];
    const bars = quantizeToBars(
      pitches.map((p, i) => note(p, i, 1)),
      DIV,
      opts,
    );

    expect(bars.length).toBe(2);
    expect(bars[0].left).toBe('normal');
    expect(bars[1].right).toBe('final');

    const degrees = bars.flatMap((b) => b.events.filter(isNote).map((n) => n.degree));
    expect(degrees).toEqual([1, 2, 3, 4, 5, 6, 7, 1]);

    const octaves = bars.flatMap((b) => b.events.filter(isNote).map((n) => n.octave));
    expect(octaves).toEqual([0, 0, 0, 0, 0, 0, 0, 1]);
  });

  it('零时长音写成整拍音符，不再产生「十六分 + 附点八分休止」这种碎谱面', () => {
    // 下一首歌_1_YAO.mid 第 10 小节：36 拍上的音节记号只有 1 tick，37 拍才是整拍音
    const bars = quantizeToBars(
      [note(60, 36, 1 / DIV), note(62, 37, 1)],
      DIV,
      { grid: 0.25, minRestBeats: 0.25, timeSig: TS44, tonicBase: 67, preferFlat: false },
    );
    const bar = bars[9];
    expect(barBeatLength(bar)).toBeCloseTo(4);
    expect(bar.events.filter(isNote).map((n) => `${n.degree}:${n.duration}`)).toEqual(['4:4', '5:4']);
    // 旧行为：1 tick 被吹成一个网格，紧跟的 0.75 拍缝落成附点八分休止
    expect(bar.events.some((e) => isRest(e) && e.duration === 8 && e.dotted)).toBe(false);
  });

  it('拍号 / 网格坏掉时抛中文错误，不在 bars[0] 上崩英文 TypeError', () => {
    // 传坏拍号时 measureBeats 给 NaN，旧代码一路 NaN 索引，最后死在 `bars[0].left`
    const badTs = { ...opts, timeSig: { num: undefined as unknown as number, den: 4 } };
    expect(() => quantizeToBars([note(60, 0, 1)], DIV, badTs)).toThrow('拍号不合法');
    expect(() => quantizeToBars([note(60, 0, 1)], DIV, { ...opts, grid: 0 })).toThrow('量化网格不合法');
  });


  it('空输入返回一个小节', () => {
    const bars = quantizeToBars([], DIV, opts);
    expect(bars.length).toBe(1);
    expect(bars[0].events.length).toBe(0);
    expect(bars[0].right).toBe('final');
  });

  it('间隙写入休止符', () => {
    const bars = quantizeToBars([note(60, 0, 1), note(64, 3, 1)], DIV, opts);
    expect(bars.length).toBe(1);
    expect(bars[0].events.filter(isRest).length).toBe(1);
    const degrees = bars[0].events.filter(isNote).map((n) => n.degree);
    expect(degrees).toEqual([1, 3]);
  });

  it('跨小节音符自动加连音线', () => {
    const bars = quantizeToBars([note(60, 0, 6)], DIV, opts);
    expect(bars.length).toBe(2);

    const first = bars[0].events[0];
    const second = bars[1].events[0];
    expect(isNote(first)).toBe(true);
    expect(isNote(second)).toBe(true);
    if (isNote(first) && isNote(second)) {
      expect(first.tie).toBe(false);
      expect(second.tie).toBe(true);
      expect(second.degree).toBe(1);
    }
  });

  it('升降号按调性偏好映射', () => {
    const bars = quantizeToBars([note(61, 0, 1)], DIV, { ...opts, preferFlat: false });
    const flatBars = quantizeToBars([note(61, 0, 1)], DIV, { ...opts, preferFlat: true });
    const sharp = bars[0].events[0];
    const flat = flatBars[0].events[0];
    if (isNote(sharp) && isNote(flat)) {
      expect(sharp.accidental).toBe('sharp');
      expect(sharp.degree).toBe(1);
      expect(flat.accidental).toBe('flat');
      expect(flat.degree).toBe(2);
    }
  });

  it('小节内事件总拍数等于拍号长度', () => {
    const bars = quantizeToBars([note(60, 0, 1), note(62, 1.5, 2.5)], DIV, opts);
    for (const bar of bars) {
      expect(barBeatLength(bar)).toBeCloseTo(4);
    }
  });

  it('附点起音的跨小节长音不再展开成一串连音八分音符', () => {
    // x.mid 第 40 小节：0.75 拍的 1'，接一个从 0.75 起、共 4 拍的 2'（跨到下一小节 0.75 拍）
    const bars = quantizeToBars(
      [note(67, 156, 0.75), note(69, 156.75, 4)],
      DIV,
      { grid: 0.25, minRestBeats: 0.25, timeSig: TS44, tonicBase: 67, preferFlat: false },
    );
    const bar = bars[39];
    expect(barBeatLength(bar)).toBeCloseTo(4);

    // 最长连音线链（含首音）不超过 2 个音符
    let run = 0;
    let longest = 0;
    for (const ev of bar.events) {
      if (isNote(ev) && ev.tie) run += 1;
      else run = isNote(ev) ? 1 : 0;
      longest = Math.max(longest, run);
    }
    expect(longest).toBeLessThanOrEqual(2);

    expect(
      bar.events.map((ev) => (ev.kind === 'dash' ? '-' : ev.kind === 'rest' ? '0' : `${ev.degree}:${ev.duration}${ev.dotted ? '.' : ''}${ev.tie ? '~' : ''}`)),
    ).toEqual(['1:8.', '2:4', '-', '-', '2:16~']);

    // 跨小节延续仍由下一小节开头的连音音符表示
    const next = bars[40].events[0];
    expect(isNote(next)).toBe(true);
    if (isNote(next)) {
      expect(next.tie).toBe(true);
      expect(next.dotted).toBe(true);
      expect(next.duration).toBe(8);
    }
  });
});

describe('makeBar / makeNote 基础约定', () => {
  it('makeNote 默认自然音与无连音线', () => {
    const n = makeNote(3, 8);
    expect(n.kind).toBe('note');
    expect(n.degree).toBe(3);
    expect(n.duration).toBe(8);
    expect(n.octave).toBe(0);
    expect(n.accidental).toBe('natural');
    expect(n.tie).toBe(false);
    expect(makeBar([n]).events.length).toBe(1);
  });
});