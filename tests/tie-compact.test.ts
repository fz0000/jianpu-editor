import { describe, expect, it } from 'vitest';
import { compactTieChains } from '../src/core/tie-compact';
import {
  barBeatLength,
  isNote,
  makeBar,
  makeDash,
  makeNote,
  makeRest,
  type Bar,
} from '../src/core/model';

/** 把小节写成可读字符串：`5:4` = 四分 5，`-` = 增时线，`~` = 带连音线 */
function fmt(bar: Bar): string {
  return bar.events
    .map((e) => {
      if (e.kind === 'dash') return '-';
      if (e.kind === 'rest') return `0:${e.duration}${e.dotted ? '.' : ''}`;
      return `${e.degree}${e.octave > 0 ? "'".repeat(e.octave) : ''}:${e.duration}${e.dotted ? '.' : ''}${e.tie ? '~' : ''}`;
    })
    .join(' ');
}

function tieChain(notes: { d: number; dur: 8 | 16 | 4 | 2; octave?: number }[]): Bar {
  return makeBar(
    notes.map((n, i) =>
      makeNote(n.d as 1 | 2 | 3 | 4 | 5 | 6 | 7, n.dur, {
        octave: n.octave ?? 0,
        tie: i > 0,
      }),
    ),
  );
}

describe('compactTieChains：同音连音线链合并成更长时值', () => {
  it('六个连音八分（3 拍）→ 四分音符 + 两条增时线，零连音线', () => {
    const bar = tieChain([
      { d: 2, dur: 8 },
      { d: 2, dur: 8 },
      { d: 2, dur: 8 },
      { d: 2, dur: 8 },
      { d: 2, dur: 8 },
      { d: 2, dur: 8 },
    ]);
    const { bars, stats } = compactTieChains([bar]);

    expect(fmt(bars[0])).toBe('2:4 - -');
    expect(stats.tiesRemoved).toBe(5);
    expect(stats.eventsRemoved).toBe(3);
    expect(barBeatLength(bars[0])).toBeCloseTo(barBeatLength(bar));
  });

  it('四个连音四分（4 拍）→ 一个全音符', () => {
    const bar = tieChain([
      { d: 5, dur: 4 },
      { d: 5, dur: 4 },
      { d: 5, dur: 4 },
      { d: 5, dur: 4 },
    ]);
    const { bars } = compactTieChains([bar]);

    expect(fmt(bars[0])).toBe('5:1');
    expect(bars[0].events.length).toBe(1);
    expect(barBeatLength(bars[0])).toBeCloseTo(4);
  });

  it('附点四分 + 连音八分（2 拍）→ 二分音符', () => {
    const bar = makeBar([makeNote(5, 4, { dotted: true }), makeNote(5, 8, { tie: true })]);
    const { bars } = compactTieChains([bar]);

    expect(fmt(bars[0])).toBe('5:2');
    expect(barBeatLength(bars[0])).toBeCloseTo(2);
  });

  it('附点二分 + 连音附点二分（6 拍）→ 二分音符 + 两条增时线，连音线清零', () => {
    const bar = makeBar([
      makeNote(3, 2, { dotted: true }),
      makeNote(3, 2, { dotted: true, tie: true }),
    ]);
    const { bars, stats } = compactTieChains([bar]);

    expect(fmt(bars[0])).toBe('3:2 - -');
    expect(stats.tiesRemoved).toBe(1);
    expect(barBeatLength(bars[0])).toBeCloseTo(6);
  });

  it('5 拍（附点二分 + 连音二分）写不成更短的谱面，保留原写法', () => {
    const bar = makeBar([makeNote(3, 2, { dotted: true }), makeNote(3, 2, { tie: true })]);
    const { bars, stats } = compactTieChains([bar]);

    expect(fmt(bars[0])).toBe('3:2. 3:2~');
    expect(stats.tiesRemoved).toBe(0);
  });

  it('2.5 拍无法写成无连音线的形式，保留原写法', () => {
    const bar = makeBar([makeNote(3, 4, { dotted: true }), makeNote(3, 4, { tie: true })]);
    const { bars, stats } = compactTieChains([bar]);

    expect(fmt(bars[0])).toBe('3:4. 3:4~');
    expect(stats.tiesRemoved).toBe(0);
  });

  it('合并后连音线不会更少时保留原写法（1 又 1/4 拍只能留一条连音线）', () => {
    const bar = makeBar([makeNote(5, 8, { dotted: true }), makeNote(5, 8, { tie: true })]);
    const { bars, stats } = compactTieChains([bar]);

    expect(fmt(bars[0])).toBe('5:8. 5:8~');
    expect(stats.tiesRemoved).toBe(0);
  });

  it('链里的增时线一起并入：四分 + 增时线 + 连音四分 → 全音符', () => {
    const bar = makeBar([makeNote(5, 4), makeDash(), makeDash(), makeNote(5, 4, { tie: true })]);
    const { bars } = compactTieChains([bar]);

    expect(fmt(bars[0])).toBe('5:1');
    expect(barBeatLength(bars[0])).toBeCloseTo(4);
  });

  it('跨小节的连音线保留：链首的 tie 不删，链内合并', () => {
    const bars = [
      makeBar([makeNote(1, 4), makeNote(2, 2)]),
      makeBar([makeNote(2, 8, { tie: true }), makeNote(2, 8, { tie: true }), makeNote(3, 4)]),
    ];
    const { bars: next, stats } = compactTieChains(bars);

    // 第 2 小节开头 1 拍的同音链 → 四分音符，链首仍带跨小节连音线
    expect(fmt(next[1])).toBe('2:4~ 3:4');
    expect(isNote(next[1].events[0]) && next[1].events[0].tie).toBe(true);
    expect(stats.tiesRemoved).toBe(1);
  });

  it('八度不同不算同音，不合并', () => {
    const bar = tieChain([
      { d: 2, dur: 4 },
      { d: 2, dur: 4, octave: 1 },
    ]);
    const { bars, stats } = compactTieChains([bar]);

    expect(fmt(bars[0])).toBe(fmt(bar));
    expect(stats.tiesRemoved).toBe(0);
  });

  it('带歌词的音符只当链首：歌词不丢，也不被后面的音吃掉', () => {
    const bar = makeBar([
      makeNote(2, 8, { lyric: 'la' }),
      makeNote(2, 8, { tie: true, lyric: 'la' }),
      makeNote(2, 8, { tie: true }),
      makeNote(2, 8, { tie: true }),
    ]);
    const { bars, stats } = compactTieChains([bar]);

    // 链首（带歌词）保留，链内三个音合并成附点四分
    expect(fmt(bars[0])).toBe('2:8 2:4.~');
    expect(bars[0].events.filter(isNote).map((n) => n.lyric)).toEqual(['la', 'la']);
    expect(stats.tiesRemoved).toBe(2);
  });

  it('三连音标记与圆滑线标记的链不动', () => {
    const tripletBar = makeBar([
      makeNote(3, 8, { triplet: true }),
      makeNote(3, 8, { tie: true, triplet: true }),
    ]);
    const slurBar = makeBar([makeNote(3, 8, { slur: true }), makeNote(3, 8, { tie: true })]);

    expect(compactTieChains([tripletBar]).stats.tiesRemoved).toBe(0);
    expect(compactTieChains([slurBar]).stats.tiesRemoved).toBe(0);
  });

  it('休止符打断链，两段各自合并', () => {
    const bar = makeBar([
      makeNote(2, 8),
      makeNote(2, 8, { tie: true }),
      makeRest(8),
      makeNote(2, 8),
      makeNote(2, 8, { tie: true }),
    ]);
    const { bars } = compactTieChains([bar]);

    expect(fmt(bars[0])).toBe('2:4 0:8 2:4');
  });

  it('链已是最省写法时原样保留（幂等）', () => {
    const bar = tieChain([
      { d: 2, dur: 8 },
      { d: 2, dur: 8 },
      { d: 2, dur: 8 },
      { d: 2, dur: 8 },
      { d: 2, dur: 8 },
      { d: 2, dur: 8 },
    ]);
    const once = compactTieChains([bar]);
    const twice = compactTieChains(once.bars);

    expect(twice.stats.tiesRemoved).toBe(0);
    expect(fmt(twice.bars[0])).toBe(fmt(once.bars[0]));
  });

  it('链首的 id、歌词与最大力度留给合并后的音符', () => {
    const head = makeNote(2, 8, { lyric: 'so', velocity: 40 });
    const bar = makeBar([head, makeNote(2, 8, { tie: true, velocity: 100 }), makeNote(2, 8, { tie: true })]);
    const { bars } = compactTieChains([bar]);
    const merged = bars[0].events[0];

    expect(isNote(merged)).toBe(true);
    if (isNote(merged)) {
      expect(merged.id).toBe(head.id);
      expect(merged.lyric).toBe('so');
      expect(merged.velocity).toBe(100);
      expect(merged.tie).toBe(false);
    }
  });
});
