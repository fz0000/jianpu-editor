import { describe, expect, it } from 'vitest';
import { ScoreStore } from '../src/core/document';
import { makeBar, makeDash, makeNote, makeRest, makeScore, type Score } from '../src/core/model';

/**
 * 「播放从当前高亮的记号起播」与「停止把高亮送回开头」这两条按钮语义的底层约定。
 *
 * 播放起点必须问 `ScoreStore` 而不是直接取 `currentSlot().event`：光标落在**小节末尾的
 * 空槽**时那里画的是光标符、`event` 是 null，直接取会让「从高亮处播放」跳回全曲开头。
 * 停止同理：高亮留在第 100 小节的话，下一次播放就从第 100 小节起，「回到开头」等于没做到。
 */

/** 三个小节：[1, 2, 增时线] / [休止, 5] / 空小节 */
function buildScore(): Score {
  return makeScore({ timeSig: { num: 4, den: 4 } }, [
    makeBar([makeNote(1, 4), makeNote(2, 4), makeDash()]),
    makeBar([makeRest(4), makeNote(5, 4)]),
    makeBar([]),
  ]);
}

const idAt = (score: Score, barIndex: number, eventIndex: number): string =>
  score.bars[barIndex].events[eventIndex].id;

describe('playStartEventId：播放起点 = 当前高亮的记号', () => {
  it('光标在记号上时就是那个记号（逐个小节逐个位置）', () => {
    const score = buildScore();
    const store = new ScoreStore(score);
    for (let b = 0; b < 2; b += 1) {
      const count = score.bars[b].events.length;
      for (let i = 0; i < count; i += 1) {
        store.setCursor({ barIndex: b, eventIndex: i });
        expect(store.playStartEventId()).toBe(idAt(score, b, i));
      }
    }
  });

  it('光标在小节末尾的空槽时取下一个小节的第一个记号，不跳回全曲开头', () => {
    const score = buildScore();
    const store = new ScoreStore(score);
    // 第 1 小节末尾（增时线之后）→ 第 2 小节的休止符
    store.setCursor({ barIndex: 0, eventIndex: 3 });
    expect(store.playStartEventId()).toBe(idAt(score, 1, 0));
    // 第 2 小节末尾 → 第 3 小节是空小节，往后没有记号
    store.setCursor({ barIndex: 1, eventIndex: 2 });
    expect(store.playStartEventId()).toBeNull();
  });

  it('光标在增时线上时返回增时线自己（播放器会换算成所在长音的拍位）', () => {
    const score = buildScore();
    const store = new ScoreStore(score);
    store.setCursor({ barIndex: 0, eventIndex: 2 });
    expect(store.playStartEventId()).toBe(idAt(score, 0, 2));
  });

  it('全曲没有任何记号时返回 null（播放器从头播）', () => {
    const store = new ScoreStore(makeScore({ timeSig: { num: 4, den: 4 } }, [makeBar([])]));
    expect(store.playStartEventId()).toBeNull();
  });

  it('一个小节都没有时也不越界（返回 null）', () => {
    const store = new ScoreStore(makeScore({ timeSig: { num: 4, den: 4 } }, []));
    expect(store.playStartEventId()).toBeNull();
  });
});

describe('goToStart：停止时把高亮送回全曲开头', () => {
  it('光标落回 { 0, 0 } 并发一次 change（UI 据此重画高亮）', () => {
    const score = buildScore();
    const store = new ScoreStore(score);
    store.setCursor({ barIndex: 1, eventIndex: 1 });
    const reasons: string[] = [];
    store.subscribe((_s, reason) => reasons.push(reason));

    store.goToStart();

    expect(store.cursor).toEqual({ barIndex: 0, eventIndex: 0 });
    expect(store.currentSlot().event?.id).toBe(idAt(score, 0, 0));
    expect(reasons).toEqual(['edit']);
  });

  it('不写历史：移动光标不该多出一条撤销记录', () => {
    const store = new ScoreStore(buildScore());
    store.setCursor({ barIndex: 1, eventIndex: 0 });
    expect(store.canUndo).toBe(false);
    store.goToStart();
    expect(store.canUndo).toBe(false);
  });

  it('空谱面上也安全（第一小节没有记号时落回小节开头的空槽）', () => {
    const store = new ScoreStore(makeScore({ timeSig: { num: 4, den: 4 } }, [makeBar([])]));
    store.goToStart();
    expect(store.cursor).toEqual({ barIndex: 0, eventIndex: 0 });
    expect(store.currentSlot().event).toBeNull();
  });
});
