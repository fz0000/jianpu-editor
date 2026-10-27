// @vitest-environment happy-dom
/**
 * 「导入 MIDI」对话框的排版回归。守四件事：
 * - 量化 / 间隙 / 调 / 拍号 / 速度 / 标题 / 歌词 这组控制项**真的挂在对话框里**
 *   （曾经只建元素没 append，界面上就是轨道列表和预览之间一大片空白）；
 * - 轨道标题是整行文本，不参与轨道行的三列网格（否则被挤进 24px 的复选框列，一字一行竖排）；
 * - 轨道行统计不换行（固定 130px 列会把「283 音 · 41-84 · 144.91 拍」折成两行）；
 * - 预览按预览盒的实际宽度排版（写死 720 会在 680px 的对话框里永远出横向滚动条），
 *   并且每次刷新滚回顶部（否则一打开看到的是曲子中段）。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { exportScoreToMidi } from '../src/midi/export';
import { twinkleScore } from '../src/samples';
import { openImportDialog } from '../src/ui/importDialog';

const MIDI_BYTES = exportScoreToMidi(twinkleScore()).bytes;
const MIDI_BUFFER = MIDI_BYTES.buffer as ArrayBuffer;

/** styles.css 去掉注释后的规则块（选择器 + 声明体） */
function cssRules(): { selector: string; body: string }[] {
  // happy-dom 环境里 import.meta.url 不是 file: URL，按项目根取路径
  const css = readFileSync(join(process.cwd(), 'src', 'styles.css'), 'utf8');
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules: { selector: string; body: string }[] = [];
  for (const match of stripped.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    rules.push({ selector: match[1].trim(), body: match[2] });
  }
  return rules;
}

/** 选择器列表里出现该类名的规则（含后代选择器，如 `.track-row input[type=checkbox]`） */
function rulesMatching(className: string): { selector: string; body: string }[] {
  return cssRules().filter((rule) =>
    rule.selector.split(',').some((part) => part.trim().split(/\s+/).includes(className)),
  );
}

function openDialog(): HTMLElement {
  document.body.innerHTML = '';
  const layer = document.createElement('div');
  layer.className = 'dialog-layer';
  layer.hidden = true;
  document.body.appendChild(layer);
  openImportDialog(layer, MIDI_BUFFER, '小星星', () => {});
  return layer;
}

function fieldByLabel(root: HTMLElement, label: string): HTMLElement {
  for (const wrap of Array.from(root.querySelectorAll('label.field'))) {
    if (wrap.querySelector('span')?.textContent === label) return wrap as HTMLElement;
  }
  throw new Error(`找不到字段：${label}`);
}

function controlByLabel(root: HTMLElement, label: string, tag: string): HTMLElement {
  const control = fieldByLabel(root, label).querySelector(tag);
  if (!control) throw new Error(`字段 ${label} 里没有 ${tag}`);
  return control as HTMLElement;
}

function pick(select: HTMLElement, value: string): void {
  (select as HTMLSelectElement).value = value;
  select.dispatchEvent(new Event('change', { bubbles: true }));
}

function previewNoteOf(root: HTMLElement): string {
  return root.querySelector('.dialog-preview-note')?.textContent ?? '';
}

function previewWidthOf(root: HTMLElement): number {
  const svg = root.querySelector('.dialog-preview svg');
  return Number(svg?.getAttribute('width'));
}

describe('导入 MIDI 对话框：控制项在界面上', () => {
  const labels = ['量化网格', '间隙处理', '调 (1=)', '拍号', '速度 BPM', '标题'];

  it('六个字段加歌词勾选都挂在对话框里（不是只建了元素）', () => {
    const layer = openDialog();
    const options = layer.querySelector('.dialog-options');
    expect(options).not.toBeNull();
    for (const label of labels) {
      expect(options!.contains(fieldByLabel(layer, label))).toBe(true);
    }
    const lyric = Array.from(layer.querySelectorAll('label.field-check span')).find((s) =>
      (s.textContent ?? '').startsWith('导入歌词'),
    );
    expect(lyric).toBeDefined();
    expect(options!.contains(lyric!.parentElement!)).toBe(true);
  });

  it('顺序：摘要 → 轨道 → 选项 → 预览标题 → 预览 → 统计', () => {
    const layer = openDialog();
    const body = layer.querySelector('.dialog-body')!;
    expect(Array.from(body.children).map((el) => el.className)).toEqual([
      'dialog-summary',
      'track-list',
      'dialog-options',
      'dialog-preview-label',
      'dialog-preview',
      'dialog-preview-note',
    ]);
  });

  it('改拍号会重算预览（控制项与预览的接线有效）', () => {
    const layer = openDialog();
    expect(previewNoteOf(layer)).toContain('8 小节');
    const numInput = controlByLabel(layer, '拍号', 'input[type=number]') as HTMLInputElement;
    numInput.value = '4';
    numInput.dispatchEvent(new Event('change', { bubbles: true }));
    expect(previewNoteOf(layer)).toContain('4 小节');
  });
});

describe('导入 MIDI 对话框：轨道列表排版', () => {
  it('标题是整行文本、没有子元素（配合 CSS 不再落进三列网格的第一列）', () => {
    const layer = openDialog();
    const head = layer.querySelector('.track-list-head')!;
    expect(head.children.length).toBe(0);
    expect(head.textContent).toContain('选择要导入的旋律轨道');
  });

  it('styles.css 不给 .track-list-head 写网格（单条文字会被塞进复选框那一列）', () => {
    const rules = rulesMatching('.track-list-head');
    expect(rules.length).toBeGreaterThan(0);
    for (const rule of rules) {
      expect(rule.body).not.toContain('grid-template-columns');
      expect(rule.body).not.toMatch(/display:\s*grid/);
    }
  });

  it('轨道行三列：统计列不写死宽度，且统计不换行', () => {
    const row = rulesMatching('.track-row').find((r) => r.body.includes('grid-template-columns'));
    expect(row).toBeDefined();
    const columns = row!.body.match(/grid-template-columns:\s*([^;]+)/)![1];
    expect(columns).toContain('minmax(0, 1fr)');
    expect(columns).not.toContain('130px');
    expect(rulesMatching('.track-meta')[0].body).toMatch(/white-space:\s*nowrap/);
  });

  it('轨道行是 复选框 + 名称 + 统计 三件套', () => {
    const layer = openDialog();
    const row = layer.querySelector('.track-row')!;
    expect(row.querySelectorAll('input[type=checkbox]').length).toBe(1);
    expect(row.querySelector('.track-name')?.textContent).toContain('1.');
    expect(row.querySelector('.track-meta')?.textContent).toContain('音');
  });
});

describe('导入 MIDI 对话框：预览', () => {
  it('按预览盒的实际宽度排版，不出横向滚动条', () => {
    const layer = openDialog();
    const box = layer.querySelector('.dialog-preview') as HTMLElement;
    Object.defineProperty(box, 'clientWidth', { configurable: true, value: 400 });
    pick(controlByLabel(layer, '量化网格', 'select'), '0.125');
    // 谱表撑满可用宽度：400 的盒子（左右各 10px 内边距）排 380，而不是写死的 720
    expect(previewWidthOf(layer)).toBe(380);
  });

  it('量不到宽度时（无布局环境）退回标准宽度', () => {
    const layer = openDialog();
    expect(previewWidthOf(layer)).toBe(720);
  });

  it('刷新预览后滚回顶部（不停在曲子中段）', () => {
    const layer = openDialog();
    const box = layer.querySelector('.dialog-preview') as HTMLElement;
    let scrollTop = 200;
    Object.defineProperty(box, 'scrollTop', {
      configurable: true,
      get: () => scrollTop,
      set: (value: number) => {
        scrollTop = value;
      },
    });
    pick(controlByLabel(layer, '间隙处理', 'select'), '1');
    expect(scrollTop).toBe(0);
  });
});

