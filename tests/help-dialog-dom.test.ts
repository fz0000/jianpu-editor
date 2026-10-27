// @vitest-environment happy-dom
/**
 * 「快捷键与说明」对话框的说明回归。守三件事：
 * - 「已知限制」列表**逐条渲染**（条数与 LIMITS 一致、没有空条目——数组字面量里多写一个空行
 *   不会多出条目，但多写一个空字符串就会在界面上留一个空 <li>）；
 * - 导入 MIDI 的「间隙处理」在帮助里有说明，并且四个档位（保留所有间隙 / 合并 < 1/16 拍 /
 *   合并 < 1/8 拍 / 合并 < 1/4 拍）的界面文案都出现在说明里，同时讲清「阈值 + 休止符 + 量化网格」
 *   这三件事（阈值必须 ≥ 网格才有意义，这是最容易踩的坑）。
 * - 「八度点」条讲清导入与播放 / 导出 MIDI 用**同一个八度窗口**（调主落在 C4–B4），
 *   并给出「低音点偏多」时的出口（工具栏 ↑ / ↓、整首移调、换调）。
 */
import { describe, expect, it } from 'vitest';
import { openHelpDialog } from '../src/ui/helpDialog';

function openHelp(): HTMLElement {
  document.body.innerHTML = '';
  const layer = document.createElement('div');
  layer.className = 'dialog-layer';
  layer.hidden = true;
  document.body.appendChild(layer);
  openHelpDialog(layer);
  return layer;
}

describe('说明对话框', () => {
  it('已知限制逐条渲染，没有空条目', () => {
    const items = Array.from(openHelp().querySelectorAll('.limit-list li'));
    expect(items.length).toBeGreaterThanOrEqual(8);
    for (const li of items) expect(li.textContent?.trim().length).toBeGreaterThan(0);
  });

  it('「八度点」有说明：导入与播放 / 导出同一八度窗口，并给出改八度的出口', () => {
    const text = Array.from(openHelp().querySelectorAll('.limit-list li'))
      .map((li) => li.textContent ?? '')
      .join('\n');
    const entry = text.split('\n').find((line) => line.startsWith('八度点'));
    expect(entry).toBeDefined();
    // 要点：窗口基准（调主落在 C4–B4）/ 与播放导出一致 / 低音点偏多时的出口
    for (const key of ['C4–B4', '导出 MIDI', '移调', '低音点']) {
      expect(entry).toContain(key);
    }
  });

  it('「间隙处理」有说明，四个档位文案与三条要点都在里面', () => {
    const text = Array.from(openHelp().querySelectorAll('.limit-list li'))
      .map((li) => li.textContent ?? '')
      .join('\n');
    const entry = text.split('\n').find((line) => line.startsWith('间隙处理'));
    expect(entry).toBeDefined();
    // 导入对话框里的四个选项文案（ui/importDialog.ts 的 MIN_REST_OPTIONS）
    for (const label of ['保留所有间隙', '合并 < 1/16 拍', '合并 < 1/8 拍', '合并 < 1/4 拍']) {
      expect(entry).toContain(label);
    }
    // 要点：并入前一个音（不是删后一个音）/ 会写成休止符 / 阈值要配量化网格
    for (const key of ['前一个音符', '休止符', '量化网格']) {
      expect(entry).toContain(key);
    }
  });
});
