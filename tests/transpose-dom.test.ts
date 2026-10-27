// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { formatTonic } from '../src/core/constants';
import { ScoreStore } from '../src/core/document';
import { isNote, makeBar, makeNote, makeScore } from '../src/core/model';
import { formatPitch, type TransposeMode } from '../src/core/transpose';
import { dispatchEditKey, SHORTCUTS, type EditKeyHandlers } from '../src/ui/shortcuts';
import { openTransposeDialog } from '../src/ui/transposeDialog';
import { Toolbar, type ToolbarCallbacks } from '../src/ui/toolbar';

function selectByLabel(root: HTMLElement, label: string): HTMLSelectElement {
  for (const wrap of Array.from(root.querySelectorAll('label.field'))) {
    if (wrap.querySelector('span')?.textContent === label) {
      const select = wrap.querySelector('select');
      if (select) return select as HTMLSelectElement;
    }
  }
  throw new Error(`找不到下拉框：${label}`);
}

function checkboxByPrefix(root: HTMLElement, prefix: string): HTMLInputElement {
  for (const wrap of Array.from(root.querySelectorAll('label.field-check'))) {
    if ((wrap.querySelector('span')?.textContent ?? '').startsWith(prefix)) {
      const input = wrap.querySelector('input[type=checkbox]');
      if (input) return input as HTMLInputElement;
    }
  }
  throw new Error(`找不到复选框：${prefix}`);
}

function buttonByText(root: HTMLElement, text: string): HTMLButtonElement {
  for (const button of Array.from(root.querySelectorAll('button'))) {
    if (button.textContent === text) return button;
  }
  throw new Error(`找不到按钮：${text}`);
}

function previewOf(root: HTMLElement): string {
  return root.querySelector('.dialog-preview-note')?.textContent ?? '';
}

function pick(select: HTMLSelectElement, value: string): void {
  select.value = value;
  select.dispatchEvent(new Event('change', { bubbles: true }));
}

function toggle(box: HTMLInputElement, checked: boolean): void {
  box.checked = checked;
  box.dispatchEvent(new Event('change', { bubbles: true }));
}

function sampleStore(): ScoreStore {
  return new ScoreStore(
    makeScore({ tonic: { letter: 'C', accidental: 'natural' }, timeSig: { num: 4, den: 4 } }, [
      makeBar([makeNote(1, 4), makeNote(3, 4), makeNote(5, 4), makeNote(1, 4)]),
    ]),
  );
}

function pitches(store: ScoreStore): string[] {
  const out: string[] = [];
  for (const bar of store.getScore().bars) {
    for (const ev of bar.events) if (isNote(ev)) out.push(formatPitch(ev));
  }
  return out;
}

function open(store: ScoreStore, onApply?: (n: number, mode: TransposeMode) => void) {
  const layer = document.createElement('div');
  document.body.appendChild(layer);
  const calls: [number, TransposeMode][] = [];
  openTransposeDialog(layer, store.getScore(), onApply ?? ((n, mode) => calls.push([n, mode])));
  return { layer, calls };
}

describe('「全曲移调」对话框', () => {
  it('打开时给出当前调与默认幅度（升高 1 个半音）的预览', () => {
    const store = sampleStore();
    const { layer } = open(store);

    expect(layer.querySelector('.dialog-summary')?.textContent).toContain('当前 1=C');
    expect(selectByLabel(layer, '移调幅度').value).toBe('1');
    expect(previewOf(layer)).toContain('升高 1 个半音（小二度）');
    expect(previewOf(layer)).toContain('调号：1=C → 1=C#');
    expect(previewOf(layer)).toContain('谱面数字一个都不动');
  });

  it('换幅度实时刷新预览：降低 2 个半音 → 1=bB', () => {
    const store = sampleStore();
    const { layer } = open(store);

    pick(selectByLabel(layer, '移调幅度'), '-2');

    expect(previewOf(layer)).toContain('降低 2 个半音（大二度）');
    expect(previewOf(layer)).toContain('调号：1=C → 1=bB');
  });

  it('勾选「改变音符」后预览给出改写前后的数字对照', () => {
    const store = sampleStore();
    const { layer } = open(store);

    toggle(checkboxByPrefix(layer, '改变音符'), true);

    expect(previewOf(layer)).toContain('调号：保持 1=C');
    expect(previewOf(layer)).toContain('前 4 个音符：1 3 5 1 → #1 4 #5 #1');
  });

  it('确认「改调号」：调号平移，谱面数字一个都不动', () => {
    const store = sampleStore();
    const before = pitches(store);
    const { layer } = open(store, (n, mode) => store.transposeAll(n, mode));

    pick(selectByLabel(layer, '移调幅度'), '2');
    buttonByText(layer, '移调').click();

    expect(formatTonic(store.getScore().meta.tonic)).toBe('D');
    expect(pitches(store)).toEqual(before);
  });

  it('勾选「改变音符」后确认：调号不动，数字被改写，一次撤销全部还原', () => {
    const store = sampleStore();
    const before = pitches(store);
    const { layer } = open(store, (n, mode) => store.transposeAll(n, mode));

    pick(selectByLabel(layer, '移调幅度'), '2');
    toggle(checkboxByPrefix(layer, '改变音符'), true);
    buttonByText(layer, '移调').click();

    expect(formatTonic(store.getScore().meta.tonic)).toBe('C');
    expect(pitches(store)).toEqual(['2', '#4', '6', '2']);

    store.undo();
    expect(pitches(store)).toEqual(before);
    expect(formatTonic(store.getScore().meta.tonic)).toBe('C');
  });

  it('幅度为 0 时不应用，也不关闭对话框', () => {
    const store = sampleStore();
    const { layer, calls } = open(store);

    pick(selectByLabel(layer, '移调幅度'), '0');
    buttonByText(layer, '移调').click();

    expect(calls).toEqual([]);
    expect(layer.querySelector('.dialog')).not.toBeNull();
  });

  it('八度点会越出 ±2 时给出警告', () => {
    const store = new ScoreStore(
      makeScore({ tonic: { letter: 'C', accidental: 'natural' }, timeSig: { num: 4, den: 4 } }, [
        makeBar([makeNote(1, 4, { octave: 2 }), makeNote(3, 4), makeNote(5, 4), makeNote(1, 4)]),
      ]),
    );
    const { layer } = open(store);

    pick(selectByLabel(layer, '移调幅度'), '13');

    expect(previewOf(layer)).toContain('八度点会越出 ±2');
  });
});

describe('工具栏移调按钮', () => {
  const noop = () => {};
  const callbacks = (fired: string[], onTranspose: (delta: number) => void): ToolbarCallbacks => ({
    onDuration: noop,
    onDot: noop,
    onAccidental: noop,
    onOctave: noop,
    onTranspose,
    onTransposeDialog: () => fired.push('dialog'),
    onTriplet: noop,
    onTie: noop,
    onSlur: noop,
    onRest: noop,
    onDash: noop,
    onDelete: noop,
    onToggleInsertMode: noop,
    onInsertBar: noop,
    onRemoveBar: noop,
    onBarline: noop,
    onCompactNotation: noop,
    onFontSize: noop,
    onUndo: noop,
    onRedo: noop,
  });

  function buttonByLabel(root: HTMLElement, label: string): HTMLButtonElement {
    for (const button of Array.from(root.querySelectorAll('button'))) {
      if (button.textContent === label) return button;
    }
    throw new Error(`找不到按钮：${label}`);
  }

  it('全↑ / 全↓ 给出 ±1 个半音，「移调…」打开对话框', () => {
    const root = document.createElement('div');
    const fired: string[] = [];
    const deltas: number[] = [];
    new Toolbar(root, callbacks(fired, (delta) => deltas.push(delta)));

    buttonByLabel(root, '全↑').click();
    buttonByLabel(root, '全↓').click();
    buttonByLabel(root, '移调…').click();

    expect(deltas).toEqual([1, -1]);
    expect(fired).toEqual(['dialog']);
  });

  it('逐音八度按钮仍在（移调改成半音后没有动它）', () => {
    const root = document.createElement('div');
    new Toolbar(root, callbacks([], noop));
    expect(buttonByLabel(root, '↑').textContent).toBe('↑');
    expect(buttonByLabel(root, '○').textContent).toBe('○');
  });
});

describe('移调快捷键', () => {
  const noop = () => {};
  const fired: string[] = [];
  const handlers: EditKeyHandlers = {
    note: noop,
    rest: noop,
    dash: noop,
    duration: noop,
    dot: noop,
    accidental: noop,
    octaveUp: noop,
    octaveDown: noop,
    transposeUp: () => fired.push('up'),
    transposeDown: () => fired.push('down'),
    transposeDialog: () => fired.push('dialog'),
    triplet: noop,
    tie: noop,
    slur: noop,
    compactNotation: noop,
    fontSizeUp: noop,
    fontSizeDown: noop,
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
    dispatchEditKey(new KeyboardEvent('keydown', { key, ctrlKey: true, shiftKey: true, cancelable: true }), handlers);

  it('Ctrl+Shift+] / [ 移 1 个半音，Ctrl+Shift+M 打开对话框', () => {
    expect(press(']')).toBe(true);
    expect(press('[')).toBe(true);
    expect(press('M')).toBe(true);
    expect(fired).toEqual(['up', 'down', 'dialog']);
  });

  it('快捷键表里写明两种移调方式', () => {
    const table = SHORTCUTS.filter((row) => row.keys.includes('Ctrl+Shift+'));
    const dialog = table.find((row) => row.keys === 'Ctrl+Shift+M');
    expect(dialog?.desc).toContain('半音');
    expect(dialog?.desc).toContain('调号');
    expect(table.find((row) => row.keys === 'Ctrl+Shift+] / Ctrl+Shift+[')?.desc).toContain('半音');
  });
});

