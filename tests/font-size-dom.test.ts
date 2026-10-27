// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { ScoreStore } from '../src/core/document';
import { layoutScore, scaledSize } from '../src/core/layout';
import {
  DEFAULT_FONT_SIZE,
  FONT_SIZE,
  MAX_FONT_SIZE,
  MIN_FONT_SIZE,
  TITLE_FONT_SIZE,
} from '../src/core/metrics';
import { makeBar, makeNote, makeScore, type Score } from '../src/core/model';
import { renderScore, scoreToSvgString, SVG_NS } from '../src/core/render';
import { MetaPanel } from '../src/ui/metaPanel';
import { dispatchEditKey, type EditKeyHandlers } from '../src/ui/shortcuts';
import { Toolbar, type ToolbarCallbacks, type ToolbarState } from '../src/ui/toolbar';

function sampleScore(fontSize: number): Score {
  return makeScore(
    { title: '字号', timeSig: { num: 4, den: 4 }, showLyrics: true, fontSize },
    [
      makeBar([makeNote(1, 4, { lyric: '起' }), makeNote(2, 8), makeNote(3, 4), makeNote(4, 4)]),
      makeBar([makeNote(5, 2), makeNote(6, 4), makeNote(7, 4), makeNote(1, 4)]),
    ],
  );
}

function buttonByLabel(root: HTMLElement, label: string): HTMLButtonElement {
  const found = Array.from(root.querySelectorAll('button')).find((b) => b.textContent === label);
  if (!found) throw new Error(`找不到按钮：${label}`);
  return found as HTMLButtonElement;
}

function selectByLabel(root: HTMLElement, label: string): HTMLSelectElement {
  for (const wrap of Array.from(root.querySelectorAll('label.field'))) {
    if (wrap.querySelector('span')?.textContent === label) {
      const select = wrap.querySelector('select');
      if (select) return select as HTMLSelectElement;
    }
  }
  throw new Error(`找不到下拉：${label}`);
}

describe('renderScore：字号只缩放 SVG 外层尺寸，内容仍是标准用户单位', () => {
  it('width / height 属性 = 排版尺寸 × 字号系数，viewBox 保持标准单位', () => {
    const layout = layoutScore(sampleScore(MAX_FONT_SIZE), 900);
    const svg = document.createElementNS(SVG_NS, 'svg');
    renderScore(svg, layout);
    const size = scaledSize(layout);
    expect(Number(svg.getAttribute('width'))).toBe(size.width);
    expect(Number(svg.getAttribute('height'))).toBe(size.height);
    expect(svg.getAttribute('viewBox')).toBe(`0 0 ${Math.round(layout.width)} ${Math.round(layout.height)}`);
  });

  it('数字的 font-size 属性恒为标准字号（缩放交给 viewBox），谱面高度随字号变大', () => {
    const renderOf = (fontSize: number) => {
      const svg = document.createElementNS(SVG_NS, 'svg');
      renderScore(svg, layoutScore(sampleScore(fontSize), 900));
      return svg;
    };
    const small = renderOf(MIN_FONT_SIZE);
    const large = renderOf(MAX_FONT_SIZE);
    expect(Number(small.querySelector('.jp-digit')?.getAttribute('font-size'))).toBe(FONT_SIZE);
    expect(Number(large.querySelector('.jp-digit')?.getAttribute('font-size'))).toBe(FONT_SIZE);
    expect(Number(large.getAttribute('height'))).toBeGreaterThan(Number(small.getAttribute('height')));
  });

  it('页眉（标题 / 演唱）画在 SVG 里，随谱面字号整体缩放', () => {
    const svgOf = (fontSize: number): SVGSVGElement => {
      const score = makeScore(
        { title: '茉莉花', singer: '邓丽君', timeSig: { num: 4, den: 4 }, fontSize },
        [makeBar([makeNote(1, 4), makeNote(2, 4), makeNote(3, 4), makeNote(4, 4)])],
      );
      const svg = document.createElementNS(SVG_NS, 'svg');
      renderScore(svg, layoutScore(score, 900));
      return svg;
    };
    const small = svgOf(MIN_FONT_SIZE);
    const large = svgOf(MAX_FONT_SIZE);
    expect(small.querySelector('.jp-title')?.textContent).toBe('茉莉花');
    expect(small.querySelector('.jp-singer')?.textContent).toBe('演唱  邓丽君');
    // 标题字号属性恒为标准值：缩放交给外层 width/height（页眉随谱面一起放大）
    expect(Number(large.querySelector('.jp-title')?.getAttribute('font-size'))).toBe(TITLE_FONT_SIZE);
    expect(Number(large.getAttribute('height'))).toBeGreaterThan(Number(small.getAttribute('height')));
  });

  it('导出的独立 SVG 用缩放后的宽高 + 标准 viewBox', () => {
    const score = sampleScore(MAX_FONT_SIZE);
    const layout = layoutScore(score, 900);
    const size = scaledSize(layout);
    const text = scoreToSvgString(score, layout);
    expect(text).toContain(`width="${size.width}" height="${size.height}"`);
    expect(text).toContain(`viewBox="0 0 ${Math.round(layout.width)} ${Math.round(layout.height)}"`);
  });
});

describe('MetaPanel「谱面字号」下拉 ↔ 模型双向同步', () => {
  function mount() {
    const store = new ScoreStore(makeScore({ title: '字号' }, [makeBar([makeNote(1, 4)])]));
    const root = document.createElement('div');
    document.body.appendChild(root);
    const panel = new MetaPanel(root, store, { onImportText: () => {}, onNewScore: () => {} });
    panel.bind();
    panel.sync(store.getScore());
    return { store, root, panel };
  }

  it('默认显示标准字号档位', () => {
    const { root } = mount();
    expect(selectByLabel(root, '谱面字号').value).toBe(String(DEFAULT_FONT_SIZE));
  });

  it('改下拉 -> 写入 meta.fontSize，并以 reason="meta" 通知订阅者', () => {
    const { store, root } = mount();
    const reasons: string[] = [];
    store.subscribe((_score, reason) => reasons.push(reason));

    const select = selectByLabel(root, '谱面字号');
    select.value = '44';
    select.dispatchEvent(new Event('change', { bubbles: true }));

    expect(store.getScore().meta.fontSize).toBe(44);
    expect(reasons).toContain('meta');
  });

  it('sync() 回显模型：撤销后回到标准字号，非档位值吸附到档位', () => {
    const { store, root, panel } = mount();
    const select = selectByLabel(root, '谱面字号');

    store.setMeta({ fontSize: 38 });
    panel.sync(store.getScore());
    expect(select.value).toBe('38');

    store.undo();
    panel.sync(store.getScore());
    expect(select.value).toBe(String(DEFAULT_FONT_SIZE));

    store.setMeta({ fontSize: 37 });
    panel.sync(store.getScore());
    expect(select.value).toBe('38');
  });
});


describe('工具栏字号按钮与快捷键', () => {
  const callbacks = (onFontSize: (delta: number) => void): ToolbarCallbacks => ({
    onDuration: () => {},
    onDot: () => {},
    onAccidental: () => {},
    onOctave: () => {},
    onTranspose: () => {},
    onTransposeDialog: () => {},
    onTriplet: () => {},
    onTie: () => {},
    onSlur: () => {},
    onRest: () => {},
    onDash: () => {},
    onDelete: () => {},
    onToggleInsertMode: () => {},
    onInsertBar: () => {},
    onRemoveBar: () => {},
    onBarline: () => {},
    onCompactNotation: () => {},
    onFontSize,
    onUndo: () => {},
    onRedo: () => {},
  });

  const stateOf = (fontSize: number): ToolbarState => ({
    duration: 4,
    dotted: false,
    accidental: 'natural',
    octave: 0,
    triplet: false,
    tie: false,
    slur: false,
    insertMode: false,
    fontSize,
    canUndo: false,
    canRedo: false,
    hasSelection: false,
  });

  it('A− / A+ 分别给出 -1 / +1；中间的 A 按钮显示当前字号，标准字号时禁用', () => {
    const root = document.createElement('div');
    const calls: number[] = [];
    const toolbar = new Toolbar(root, callbacks((d) => calls.push(d)));

    buttonByLabel(root, 'A+').click();
    buttonByLabel(root, 'A−').click();
    expect(calls).toEqual([1, -1]);

    toolbar.update(stateOf(38));
    expect(buttonByLabel(root, 'A38').classList.contains('is-active')).toBe(true);

    toolbar.update(stateOf(DEFAULT_FONT_SIZE));
    expect(buttonByLabel(root, `A${DEFAULT_FONT_SIZE}`).disabled).toBe(true);
  });

  it('到达字号端点时禁用对应按钮', () => {
    const root = document.createElement('div');
    const toolbar = new Toolbar(root, callbacks(() => {}));

    toolbar.update(stateOf(MAX_FONT_SIZE));
    expect(buttonByLabel(root, 'A+').disabled).toBe(true);
    expect(buttonByLabel(root, 'A−').disabled).toBe(false);

    toolbar.update(stateOf(MIN_FONT_SIZE));
    expect(buttonByLabel(root, 'A−').disabled).toBe(true);
  });

  it('Ctrl+Shift+= / Ctrl+Shift+- 调用 fontSizeUp / fontSizeDown', () => {
    const fired: string[] = [];
    const noop = () => {};
    const handlers: EditKeyHandlers = {
      note: noop,
      rest: noop,
      dash: noop,
      duration: noop,
      dot: noop,
      accidental: noop,
      octaveUp: noop,
      octaveDown: noop,
      transposeUp: noop,
      transposeDown: noop,
      triplet: noop,
      tie: noop,
      slur: noop,
      compactNotation: noop,
      fontSizeUp: () => fired.push('up'),
      fontSizeDown: () => fired.push('down'),
      cursorMove: noop,
      barMove: noop,
      appendNote: noop,
      remove: noop,
      toggleInsertMode: noop,
      togglePlay: noop,
      stop: noop,
      undo: noop,
      redo: noop,
      importMidi: noop,
      saveJson: noop,
    };
    const press = (key: string) =>
      dispatchEditKey(
        new KeyboardEvent('keydown', { key, ctrlKey: true, shiftKey: true, cancelable: true }),
        handlers,
      );

    expect(press('+')).toBe(true);
    expect(press('-')).toBe(true);
    expect(fired).toEqual(['up', 'down']);
    // 不带 Shift 的 Ctrl+= 不是字号快捷键（留给浏览器缩放）
    expect(dispatchEditKey(new KeyboardEvent('keydown', { key: '=', ctrlKey: true, cancelable: true }), handlers)).toBe(false);
  });
});

