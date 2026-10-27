import { describe, expect, it } from 'vitest';
import { ScoreStore } from '../src/core/document';
import { isNote, makeBar, makeNote, makeScore, type Bar, type Score } from '../src/core/model';

function buildScore(): Score {
  const bars: Bar[] = [
    makeBar([makeNote(1, 4), makeNote(2, 4), makeNote(3, 4)]),
    makeBar([makeNote(4, 4), makeNote(5, 4)]),
  ];
  return makeScore({ timeSig: { num: 4, den: 4 } }, bars);
}

describe('圆滑线组（可覆盖三个以上音符）', () => {
  it('extendSlur 把圆滑线延伸到下一个音符', () => {
    const store = new ScoreStore(buildScore());
    store.extendSlur(0, 0, true);
    const second = store.getScore().bars[0].events[1];
    expect(isNote(second) && second.slur).toBe(true);
    expect(store.slurExtendsToNext(0, 0)).toEqual({ hasNext: true, extended: true });
  });

  it('连续延伸形成覆盖五个音符的圆滑线（跨小节）', () => {
    const store = new ScoreStore(buildScore());
    store.extendSlur(0, 0, true);
    store.extendSlur(0, 1, true);
    store.extendSlur(0, 2, true);
    store.extendSlur(1, 0, true);

    const span = store.slurSpanOf(0, 1);
    expect(span).not.toBeNull();
    expect(span?.noteCount).toBe(5);
    expect(span?.startBar).toBe(0);
    expect(span?.startIndex).toBe(0);
    expect(span?.endBar).toBe(1);
    expect(span?.endIndex).toBe(1);
  });

  it('收回圆滑线后组变短', () => {
    const store = new ScoreStore(buildScore());
    store.extendSlur(0, 0, true);
    store.extendSlur(0, 1, true);
    store.extendSlur(0, 1, false);
    expect(store.slurSpanOf(0, 0)?.noteCount).toBe(2);
    expect(store.slurSpanOf(0, 2)).toBeNull();
  });

  it('没有圆滑线的音符返回 null，最后一个音符不能延伸', () => {
    const store = new ScoreStore(buildScore());
    expect(store.slurSpanOf(0, 0)).toBeNull();
    expect(store.slurExtendsToNext(1, 1)).toEqual({ hasNext: false, extended: false });
    store.extendSlur(1, 1, true);
    expect(store.getScore().bars[1].events[1]).toMatchObject({ slur: false });
  });

  it('toggleSlur 与 extendSlur 组合可标记三个以上音符', () => {
    const store = new ScoreStore(buildScore());
    store.setCursor({ barIndex: 0, eventIndex: 1 });
    store.toggleSlur();
    store.setCursor({ barIndex: 0, eventIndex: 2 });
    store.toggleSlur();
    expect(store.slurSpanOf(0, 0)?.noteCount).toBe(3);
  });

  it('第一个音符按圆滑线时向后连接，再按一次收回', () => {
    const store = new ScoreStore(buildScore());
    store.setCursor({ barIndex: 0, eventIndex: 0 });
    store.toggleSlur();
    expect(store.slurSpanOf(0, 0)?.noteCount).toBe(2);
    store.toggleSlur();
    expect(store.slurSpanOf(0, 0)).toBeNull();
  });
});