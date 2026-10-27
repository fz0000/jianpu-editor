import type { ScoreStore } from '../core/document';
import { layoutScore, type LayoutResult } from '../core/layout';
import { BAR_PADDING } from '../core/metrics';
import { renderScore } from '../core/render';

export interface ScoreViewCallbacks {
  /** 单击（非拖拽）某个记号：用于弹出微型编辑浮层 */
  onBlockClick(info: { barIndex: number; eventIndex: number; group: Element }): void;
}

export class ScoreView {
  private readonly svg: SVGSVGElement;
  private layout: LayoutResult | null = null;
  private playingId: string | null = null;
  private drag: { barIndex: number; eventIndex: number; id: string; x: number; y: number; moved: boolean } | null = null;

  constructor(
    private readonly container: HTMLElement,
    private readonly store: ScoreStore,
    private readonly cb?: ScoreViewCallbacks,
  ) {
    const page = document.createElement('div');
    page.className = 'score-page';
    this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.svg.setAttribute('class', 'jp-score');
    // 页眉（标题 / 演唱 / 词曲作者 / 调号拍号速度）画在 SVG 里，与导出的 SVG / PNG / 打印同一份版式
    page.appendChild(this.svg);
    container.appendChild(page);

    this.bindEvents();
  }

  getSvg(): SVGSVGElement {
    return this.svg;
  }

  getLayout(): LayoutResult | null {
    return this.layout;
  }

  private availableWidth(): number {
    return Math.max(320, this.container.clientWidth - 48);
  }

  render(): void {
    this.layout = layoutScore(this.store.getScore(), this.availableWidth());
    renderScore(this.svg, this.layout);
    this.applyHighlights();
  }

  setPlaying(eventId: string | null): void {
    if (this.playingId === eventId) return;
    this.playingId = eventId;
    this.applyHighlights();
  }

  private applyHighlights(): void {
    this.svg.querySelectorAll('.is-cursor').forEach((el) => el.classList.remove('is-cursor'));
    this.svg.querySelectorAll('.is-playing').forEach((el) => el.classList.remove('is-playing'));
    this.svg.querySelectorAll('.jp-caret').forEach((el) => el.remove());

    const cursor = this.store.cursor;
    const bar = this.store.getScore().bars[cursor.barIndex];
    if (!bar) return;

    if (cursor.eventIndex < bar.events.length) {
      const group = findBlock(this.svg, bar.events[cursor.eventIndex].id);
      group?.classList.add('is-cursor');
    } else {
      this.drawCaret(cursor.barIndex);
    }

    if (this.playingId) {
      const group = findBlock(this.svg, this.playingId);
      group?.classList.add('is-playing');
      this.followElement(group);
    }
  }

  /**
   * 把光标所在记号滚进可视区：「停止」把高亮送回全曲开头时，停在第 100 小节的视图
   * 得跟着回去——否则「回到开头」在长谱面上根本看不见。
   */
  revealCursor(): void {
    const { barIndex, eventIndex } = this.store.cursor;
    const bar = this.store.getScore().bars[barIndex];
    if (!bar) return;
    const ev = bar.events[eventIndex];
    if (ev) {
      this.followElement(findBlock(this.svg, ev.id));
      return;
    }
    // 光标在小节末尾的空槽（画的是光标符）：滚到那一小节所在处，小节命中区一定在版式里
    this.followElement(this.svg.querySelector(`rect.jp-bar-hit[data-bar="${barIndex}"]`));
  }

  /** 播放时自动滚动跟随当前音符（文档第六章） */
  private followElement(group: Element | null): void {
    if (!group) return;
    const box = this.container.getBoundingClientRect();
    const rect = group.getBoundingClientRect();
    const marginY = Math.min(60, box.height * 0.25);
    if (rect.top < box.top + marginY || rect.bottom > box.bottom - marginY) {
      const target = rect.top - box.top - this.container.clientHeight * 0.35;
      this.container.scrollTop += target;
    }
    if (rect.left < box.left + 12 || rect.right > box.right - 12) {
      this.container.scrollLeft += rect.left - box.left - 80;
    }
  }

  private drawCaret(barIndex: number): void {
    if (!this.layout) return;
    for (const system of this.layout.systems) {
      const slot = system.barSlots.find((s) => s.barIndex === barIndex);
      if (!slot) continue;
      const blocks = system.blocks.filter((b) => b.barIndex === barIndex);
      const x =
        blocks.length > 0
          ? blocks[blocks.length - 1].x + blocks[blocks.length - 1].width + 4
          : slot.x + BAR_PADDING;
      const caret = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      caret.setAttribute('class', 'jp-caret');
      caret.setAttribute('x', String(x));
      caret.setAttribute('y', String(system.centerY - 16));
      caret.setAttribute('width', '3');
      caret.setAttribute('height', '32');
      systemGroup(this.svg, system.index)?.appendChild(caret);
      return;
    }
  }

  private selectBarEnd(barIndex: number): void {
    const bar = this.store.getScore().bars[barIndex];
    if (!bar) return;
    this.store.setCursor({ barIndex, eventIndex: bar.events.length });
  }

  private bindEvents(): void {
    this.svg.addEventListener('pointerdown', (event) => {
      const group = blockFromEvent(event.target);
      if (!group) {
        const barHit = event.target instanceof Element ? event.target.closest('rect.jp-bar-hit') : null;
        if (barHit) this.selectBarEnd(Number(barHit.getAttribute('data-bar')));
        return;
      }
      const barIndex = Number(group.getAttribute('data-bar'));
      const eventIndex = Number(group.getAttribute('data-index'));
      const id = group.getAttribute('data-event-id');
      if (!id || Number.isNaN(barIndex) || Number.isNaN(eventIndex)) return;
      this.store.setCursorToEvent(id);
      this.drag = { barIndex, eventIndex, id, x: event.clientX, y: event.clientY, moved: false };
      this.svg.setPointerCapture?.(event.pointerId);
    });

    this.svg.addEventListener('pointermove', (event) => {
      if (!this.drag) return;
      const dx = event.clientX - this.drag.x;
      const dy = event.clientY - this.drag.y;
      if (!this.drag.moved && Math.hypot(dx, dy) < 7) return;
      this.drag.moved = true;
      this.svg.querySelectorAll('.is-drop-target').forEach((el) => el.classList.remove('is-drop-target'));
      const target = targetBlock(event.clientX, event.clientY);
      target?.classList.add('is-drop-target');
    });

    const finish = (event: PointerEvent): void => {
      const drag = this.drag;
      this.drag = null;
      this.svg.querySelectorAll('.is-drop-target').forEach((el) => el.classList.remove('is-drop-target'));
      if (!drag) return;

      if (!drag.moved) {
        const group = findBlock(this.svg, drag.id);
        if (group) this.cb?.onBlockClick({ barIndex: drag.barIndex, eventIndex: drag.eventIndex, group });
        return;
      }

      const target = targetBlock(event.clientX, event.clientY);
      if (!target) return;
      const toBar = Number(target.getAttribute('data-bar'));
      const toIndex = Number(target.getAttribute('data-index'));
      if (Number.isNaN(toBar) || Number.isNaN(toIndex)) return;
      if (toBar === drag.barIndex && toIndex === drag.eventIndex) return;
      this.store.moveEvent(drag.barIndex, drag.eventIndex, toBar, toIndex);
    };

    this.svg.addEventListener('pointerup', finish);
    this.svg.addEventListener('pointercancel', () => {
      this.drag = null;
      this.svg.querySelectorAll('.is-drop-target').forEach((el) => el.classList.remove('is-drop-target'));
    });
  }
}

function blockFromEvent(target: EventTarget | null): Element | null {
  if (!(target instanceof Element)) return null;
  return target.closest('g.jp-block');
}

function targetBlock(clientX: number, clientY: number): Element | null {
  return document.elementFromPoint(clientX, clientY)?.closest('g.jp-block') ?? null;
}

function findBlock(svg: SVGSVGElement, eventId: string): Element | null {
  return svg.querySelector(`g[data-event-id="${cssEscape(eventId)}"]`);
}

function systemGroup(svg: SVGSVGElement, index: number): Element | null {
  const systems = svg.querySelectorAll('g.jp-system');
  return systems[index]?.parentElement ?? null;
}

function cssEscape(value: string): string {
  return typeof CSS !== 'undefined' && CSS.escape
    ? CSS.escape(value)
    : value.replace(/[^a-zA-Z0-9_-]/g, '\\$&');
}

