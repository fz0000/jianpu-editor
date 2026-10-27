// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { ScoreStore } from '../src/core/document';
import { makeBar, makeNote, makeScore } from '../src/core/model';
import { MetaPanel } from '../src/ui/metaPanel';

function checkboxByLabel(root: HTMLElement, label: string): HTMLInputElement {
  for (const wrap of Array.from(root.querySelectorAll('label.field-check'))) {
    if (wrap.querySelector('span')?.textContent === label) {
      const input = wrap.querySelector('input[type=checkbox]');
      if (input) return input as HTMLInputElement;
    }
  }
  throw new Error(`找不到复选框：${label}`);
}

function inputByLabel(root: HTMLElement, label: string): HTMLInputElement {
  for (const wrap of Array.from(root.querySelectorAll('label.field'))) {
    if (wrap.querySelector('span')?.textContent === label) {
      const input = wrap.querySelector('input[type=text]');
      if (input) return input as HTMLInputElement;
    }
  }
  throw new Error(`找不到输入框：${label}`);
}

function mount() {
  const store = new ScoreStore(
    makeScore({ showLyrics: true, showBarNumbers: true }, [
      makeBar([makeNote(1, 4, { lyric: '起' }), makeNote(2, 4, { lyric: '来' })]),
    ]),
  );
  const root = document.createElement('div');
  document.body.appendChild(root);
  const panel = new MetaPanel(root, store, { onImportText: () => {}, onNewScore: () => {} });
  panel.bind();
  panel.sync(store.getScore());
  return { store, root, panel };
}

const toggle = (box: HTMLInputElement, checked: boolean) => {
  box.checked = checked;
  box.dispatchEvent(new Event('change', { bubbles: true }));
};

describe('MetaPanel「显示歌词」复选框 ↔ 模型双向同步', () => {
  it('取消勾选 -> 模型 showLyrics=false，并以 reason="meta" 通知订阅者', () => {
    const { store, root } = mount();
    const reasons: string[] = [];
    store.subscribe((_score, reason) => reasons.push(reason));

    const box = checkboxByLabel(root, '显示歌词');
    expect(box.checked).toBe(true);

    toggle(box, false);

    expect(store.getScore().meta.showLyrics).toBe(false);
    expect(reasons).toContain('meta');
  });

  it('重新勾选 -> 模型恢复 true（歌词数据不被删除）', () => {
    const { store, root } = mount();
    const box = checkboxByLabel(root, '显示歌词');

    toggle(box, false);
    toggle(box, true);

    expect(store.getScore().meta.showLyrics).toBe(true);
    const first = store.getScore().bars[0].events[0];
    expect(first.kind === 'note' ? first.lyric : '').toBe('起');
  });

  it('模型变化后 sync() 回显到复选框（撤销 / 载入示例走这条路）', () => {
    const { store, root, panel } = mount();
    const box = checkboxByLabel(root, '显示歌词');

    store.setMeta({ showLyrics: false });
    panel.sync(store.getScore());
    expect(box.checked).toBe(false);

    store.undo();
    panel.sync(store.getScore());
    expect(box.checked).toBe(true);
  });

  it('「显示歌词」与「显示小节号」互不干扰', () => {
    const { store, root } = mount();
    toggle(checkboxByLabel(root, '显示歌词'), false);
    expect(store.getScore().meta.showBarNumbers).toBe(true);

    toggle(checkboxByLabel(root, '显示小节号'), false);
    expect(store.getScore().meta.showBarNumbers).toBe(false);
    expect(store.getScore().meta.showLyrics).toBe(false);
  });
});

describe('MetaPanel「演唱」输入框 ↔ 模型双向同步', () => {
  it('改动 -> 写入 meta.singer，并以 reason="meta" 通知订阅者', () => {
    const { store, root } = mount();
    const reasons: string[] = [];
    store.subscribe((_score, reason) => reasons.push(reason));

    const box = inputByLabel(root, '演唱');
    box.value = '邓丽君';
    box.dispatchEvent(new Event('change', { bubbles: true }));

    expect(store.getScore().meta.singer).toBe('邓丽君');
    expect(reasons).toContain('meta');
  });

  it('模型变化后 sync() 回显到输入框（撤销 / 载入示例走这条路）', () => {
    const { store, root, panel } = mount();
    const box = inputByLabel(root, '演唱');

    store.setMeta({ singer: '李谷一' });
    panel.sync(store.getScore());
    expect(box.value).toBe('李谷一');

    store.undo();
    panel.sync(store.getScore());
    expect(box.value).toBe('');
  });
});
