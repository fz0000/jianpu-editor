// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { ScoreStore } from '../src/core/document';
import { makeBar, makeNote, makeScore, type Score } from '../src/core/model';
import { ScoreView } from '../src/ui/scoreView';

/**
 * 「停止」按钮把高亮送回全曲开头，在视图层的落点：
 * `store.goToStart()` 之后重排重绘，`.is-cursor` 必须落在**全曲第一个记号**上，
 * 并且 `revealCursor()` 要能把它滚进可视区（停在第 100 小节的视图得跟着回去）。
 */

function buildScore(): Score {
  return makeScore({ timeSig: { num: 4, den: 4 } }, [
    makeBar([makeNote(1, 4), makeNote(2, 4)]),
    makeBar([makeNote(3, 4), makeNote(5, 4)]),
  ]);
}

function mount() {
  const score = buildScore();
  const store = new ScoreStore(score);
  const container = document.createElement('div');
  document.body.appendChild(container);
  const view = new ScoreView(container, store);
  view.render();
  return { score, store, view, svg: view.getSvg() };
}

function cursorIds(svg: SVGSVGElement): string[] {
  return Array.from(svg.querySelectorAll('.is-cursor')).map((el) => el.getAttribute('data-event-id') ?? '');
}

describe('ScoreView 的光标高亮随「停止」回到开头', () => {
  it('光标在后面的记号上时高亮那个记号', () => {
    const { score, store, view } = mount();
    store.setCursor({ barIndex: 1, eventIndex: 1 });
    view.render();
    expect(cursorIds(view.getSvg())).toEqual([score.bars[1].events[1].id]);
  });

  it('goToStart() 后重绘，高亮只剩全曲第一个记号', () => {
    const { score, store, view } = mount();
    store.setCursor({ barIndex: 1, eventIndex: 1 });
    view.render();

    store.goToStart();
    view.render();

    const svg = view.getSvg();
    expect(cursorIds(svg)).toEqual([score.bars[0].events[0].id]);
    expect(svg.querySelectorAll('.jp-caret')).toHaveLength(0);
  });

  it('revealCursor() 把光标记号滚进可视区：不抛异常（happy-dom 里没有真实布局）', () => {
    const { store, view } = mount();
    store.goToStart();
    view.render();
    expect(() => view.revealCursor()).not.toThrow();
  });

  it('光标在小节末尾空槽（画光标符）时 revealCursor() 走小节命中区分支，也不抛', () => {
    const { store, view } = mount();
    store.setCursor({ barIndex: 1, eventIndex: 2 });
    view.render();
    expect(view.getSvg().querySelectorAll('.jp-caret').length).toBeGreaterThan(0);
    expect(() => view.revealCursor()).not.toThrow();
    expect(cursorIds(view.getSvg())).toEqual([]);
  });
});
