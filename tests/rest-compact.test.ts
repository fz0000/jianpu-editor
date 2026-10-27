import { describe, expect, it } from 'vitest';
import { ScoreStore } from '../src/core/document';
import { compactRestRuns } from '../src/core/rest-compact';
import {
  barBeatLength,
  isDash,
  makeBar,
  makeNote,
  makeRest,
  makeScore,
  type Bar,
  type Duration,
} from '../src/core/model';

/** 把小节写成可读字符串：`0:4.` = 附点四分休止，`-` = 增时线 */
function fmt(bar: Bar): string {
  return bar.events
    .map((e) => {
      if (e.kind === 'dash') return '-';
      if (e.kind === 'rest') return `0:${e.duration}${e.dotted ? '.' : ''}`;
      return `${e.degree}${e.octave > 0 ? "'".repeat(e.octave) : ''}:${e.duration}${e.dotted ? '.' : ''}${e.tie ? '~' : ''}`;
    })
    .join(' ');
}

function restBar(specs: [Duration, boolean?][]): Bar {
  return makeBar(specs.map(([d, dotted]) => makeRest(d, dotted === true)));
}

describe('compactRestRuns：小节内连续休止符合并', () => {
  it('三个四分休止（4 拍）→ 一个全休止', () => {
    const bar = restBar([[4, true], [4, true], [4]]);
    const { bars, stats } = compactRestRuns([bar]);

    expect(fmt(bars[0])).toBe('0:1');
    expect(stats.restsRemoved).toBe(2);
    expect(stats.eventsRemoved).toBe(2);
    expect(barBeatLength(bars[0])).toBeCloseTo(4);
  });

  it('附点四分 + 八分休止（2 拍）→ 一个二分休止', () => {
    const bar = restBar([[4, true], [8]]);
    const { bars, stats } = compactRestRuns([bar]);

    expect(fmt(bars[0])).toBe('0:2');
    expect(stats.restsRemoved).toBe(1);
    expect(barBeatLength(bars[0])).toBeCloseTo(2);
  });

  it('两个八分休止 → 一个四分休止', () => {
    const bar = restBar([[8], [8]]);
    const { bars, stats } = compactRestRuns([bar]);

    expect(fmt(bars[0])).toBe('0:4');
    expect(stats.restsRemoved).toBe(1);
  });

  it('休止符不会接增时线：4 拍写成一个全休止，不是「0:4 - - -」', () => {
    const { bars } = compactRestRuns([restBar([[4, true], [4, true], [4]])]);

    expect(bars[0].events.filter(isDash).length).toBe(0);
  });

  it('1.75 拍（附点四分 + 十六分休止）已是最少个数，原样保留', () => {
    const bar = restBar([[4, true], [16]]);
    const { bars, stats } = compactRestRuns([bar]);

    expect(fmt(bars[0])).toBe('0:4. 0:16');
    expect(stats.restsRemoved).toBe(0);
  });

  it('音符打断休止段，两段各自合并', () => {
    const bar = makeBar([makeRest(8), makeRest(8), makeNote(3, 4), makeRest(8), makeRest(8)]);
    const { bars, stats } = compactRestRuns([bar]);

    expect(fmt(bars[0])).toBe('0:4 3:4 0:4');
    expect(stats.restsRemoved).toBe(2);
  });

  it('跨小节的休止不合并（各小节独立）', () => {
    const bars = [restBar([[4]]), restBar([[4]])];
    const { bars: next, stats } = compactRestRuns(bars);

    expect(fmt(next[0])).toBe('0:4');
    expect(fmt(next[1])).toBe('0:4');
    expect(stats.restsRemoved).toBe(0);
    expect(stats.barsChanged).toBe(0);
  });

  it('段首沿用原来的休止符 id，拍数逐小节守恒', () => {
    const head = makeRest(4, true);
    const bar = makeBar([head, makeRest(4, true), makeRest(4)]);
    const { bars } = compactRestRuns([bar]);

    expect(bars[0].events[0].id).toBe(head.id);
    expect(barBeatLength(bars[0])).toBeCloseTo(barBeatLength(bar));
  });

  it('合并后已是最少个数（幂等）', () => {
    const once = compactRestRuns([restBar([[4, true], [4, true], [4]])]);
    const twice = compactRestRuns(once.bars);

    expect(twice.stats.restsRemoved).toBe(0);
    expect(fmt(twice.bars[0])).toBe(fmt(once.bars[0]));
  });
});

describe('ScoreStore.compactNotation：连音线 + 休止符一起精简', () => {
  function sampleScore() {
    return makeScore(
      { title: 't', timeSig: { num: 4, den: 4 }, tempo: 90, showLyrics: false },
      [
        makeBar([makeNote(2, 8), makeNote(2, 8, { tie: true }), makeNote(3, 4), makeNote(4, 4)]),
        restBar([[4, true], [4, true], [4]]),
      ],
    );
  }

  it('一次调用同时合并连音线链与连续休止，一次撤销全部还原', () => {
    const store = new ScoreStore(sampleScore());
    const stats = store.compactNotation();

    expect(stats.tiesRemoved).toBe(1);
    expect(stats.restsRemoved).toBe(2);
    expect(stats.eventsRemoved).toBe(3);
    expect(stats.barsChanged).toBe(2);

    const bars = store.getScore().bars;
    expect(fmt(bars[0])).toBe('2:4 3:4 4:4');
    expect(fmt(bars[1])).toBe('0:1');

    store.undo();
    expect(fmt(store.getScore().bars[0])).toBe('2:8 2:8~ 3:4 4:4');
    expect(fmt(store.getScore().bars[1])).toBe('0:4. 0:4. 0:4');
  });

  it('无可精简时不写入历史', () => {
    const store = new ScoreStore(sampleScore());
    store.compactNotation();
    const before = fmt(store.getScore().bars[1]);
    const stats = store.compactNotation();

    expect(stats.tiesRemoved).toBe(0);
    expect(stats.restsRemoved).toBe(0);
    expect(fmt(store.getScore().bars[1])).toBe(before);

    store.undo();
    expect(fmt(store.getScore().bars[1])).toBe('0:4. 0:4. 0:4');
  });
});
