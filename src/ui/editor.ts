/**
 * 音符微型编辑浮层（文档第六章：点击音符选中 → 弹出浮层改音高 / 时值 / 歌词）。
 * 浮层挂在 body 上并固定定位，避免被谱面滚动容器裁剪。
 */

import { DURATION_LABELS } from '../core/constants';
import type { ScoreStore } from '../core/document';
import { isNote, type Accidental, type Degree, type Duration, type ScoreEvent } from '../core/model';

const DEGREES: Degree[] = [1, 2, 3, 4, 5, 6, 7];
const DURATIONS: Duration[] = [1, 2, 4, 8, 16, 32];
const OCTAVE_LABELS: { value: number; label: string }[] = [
  { value: -2, label: '↓↓' },
  { value: -1, label: '↓' },
  { value: 0, label: '○' },
  { value: 1, label: '↑' },
  { value: 2, label: '↑↑' },
];

interface Chip {
  label: string;
  active: boolean;
  title: string;
  onClick: () => void;
}

function section(label: string, content: HTMLElement): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'note-editor-section';
  const span = document.createElement('span');
  span.className = 'note-editor-label';
  span.textContent = label;
  wrap.append(span, content);
  return wrap;
}

function chipRow(chips: Chip[]): HTMLElement {
  const row = document.createElement('div');
  row.className = 'chip-row';
  for (const chip of chips) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `chip${chip.active ? ' is-active' : ''}`;
    button.textContent = chip.label;
    button.title = chip.title;
    button.addEventListener('click', chip.onClick);
    row.appendChild(button);
  }
  return row;
}

function cssEscape(value: string): string {
  return typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(value) : value.replace(/[^a-zA-Z0-9_-]/g, '\\$&');
}

export class NoteEditor {
  private el: HTMLDivElement | null = null;
  private barIndex = -1;
  private eventIndex = -1;
  private readonly onDocPointerDown: (event: PointerEvent) => void;
  private readonly onScrollCapture: () => void;

  constructor(private readonly store: ScoreStore) {
    this.onDocPointerDown = (event: PointerEvent) => {
      if (!this.el) return;
      if (this.el.contains(event.target as Node)) return;
      if ((event.target as Element).closest?.('g.jp-block')) return;
      this.close();
    };
    this.onScrollCapture = () => this.close();
  }

  get isOpen(): boolean {
    return this.el !== null;
  }

  private event(): ScoreEvent | null {
    return this.store.getScore().bars[this.barIndex]?.events[this.eventIndex] ?? null;
  }

  private patch(part: Partial<ScoreEvent>): void {
    this.store.patchEvent(this.barIndex, this.eventIndex, part);
    this.refresh();
  }

  close(): void {
    if (!this.el) return;
    this.el.remove();
    this.el = null;
    this.barIndex = -1;
    this.eventIndex = -1;
    document.removeEventListener('pointerdown', this.onDocPointerDown, true);
    window.removeEventListener('scroll', this.onScrollCapture, true);
  }

  open(barIndex: number, eventIndex: number, anchor: Element): void {
    const ev = this.store.getScore().bars[barIndex]?.events[eventIndex];
    if (!ev) return;
    this.close();

    this.barIndex = barIndex;
    this.eventIndex = eventIndex;

    const root = document.createElement('div');
    root.className = 'note-editor';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-label', '记号编辑');

    const head = document.createElement('div');
    head.className = 'note-editor-head';
    const title = document.createElement('strong');
    title.textContent = ev.kind === 'note' ? `音级 ${ev.degree}` : ev.kind === 'rest' ? '休止符' : '延长记号';
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'note-editor-close';
    closeBtn.textContent = '✕';
    closeBtn.addEventListener('click', () => this.close());
    head.append(title, closeBtn);
    root.appendChild(head);

    if (ev.kind === 'note') {
      root.appendChild(
        section(
          '音高',
          chipRow(
            DEGREES.map((d) => ({
              label: String(d),
              active: ev.degree === d,
              title: `音级 ${d}`,
              onClick: () => this.patch({ degree: d }),
            })),
          ),
        ),
      );
      root.appendChild(
        section(
          '八度',
          chipRow(
            OCTAVE_LABELS.map((o) => ({
              label: o.label,
              active: ev.octave === o.value,
              title: o.value === 0 ? '本位' : o.value > 0 ? `高 ${o.value} 八度` : `低 ${-o.value} 八度`,
              onClick: () => this.patch({ octave: o.value }),
            })),
          ),
        ),
      );
      root.appendChild(
        section(
          '升降',
          chipRow(
            (['sharp', 'flat', 'natural'] as Accidental[]).map((a) => ({
              label: a === 'sharp' ? '#' : a === 'flat' ? 'b' : '♮',
              active: ev.accidental === a,
              title: a === 'sharp' ? '升号' : a === 'flat' ? '降号' : '还原',
              onClick: () => this.patch({ accidental: a }),
            })),
          ),
        ),
      );
    }

    if (ev.kind !== 'dash') {
      const durationSelect = document.createElement('select');
      durationSelect.className = 'input input-sm';
      for (const d of DURATIONS) {
        const opt = document.createElement('option');
        opt.value = String(d);
        opt.textContent = DURATION_LABELS[d];
        if (ev.duration === d) opt.selected = true;
        durationSelect.appendChild(opt);
      }
      durationSelect.addEventListener('change', () =>
        this.patch({ duration: Number(durationSelect.value) as Duration }),
      );
      root.appendChild(section('时值', durationSelect));
    }
    const toggleRow = document.createElement('div');
    toggleRow.className = 'note-editor-toggles';
    const addToggle = (label: string, checked: boolean, onChange: (v: boolean) => void, title: string): void => {
      const wrap = document.createElement('label');
      wrap.className = 'note-editor-toggle';
      wrap.title = title;
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = checked;
      input.addEventListener('change', () => onChange(input.checked));
      const span = document.createElement('span');
      span.textContent = label;
      wrap.append(input, span);
      toggleRow.appendChild(wrap);
    };

    if (ev.kind !== 'dash') addToggle('附点', ev.dotted, (v) => this.patch({ dotted: v }), '附点');
    if (isNote(ev)) {
      const nextSlur = this.store.slurExtendsToNext(this.barIndex, this.eventIndex);
      addToggle('三连音', ev.triplet, (v) => this.patch({ triplet: v }), '三连音标记');
      addToggle('连音线', ev.tie, (v) => this.patch({ tie: v, slur: v ? false : ev.slur }), '与前一个音连音');
      addToggle(
        '圆滑线（入）',
        ev.slur,
        (v) => this.patch({ slur: v, tie: v ? false : ev.tie }),
        '与前一个音共用一条圆滑线',
      );
      if (nextSlur.hasNext) {
        addToggle(
          '圆滑线（出）',
          nextSlur.extended,
          (v) => {
            this.store.extendSlur(this.barIndex, this.eventIndex, v);
            this.refresh();
          },
          '把圆滑线延伸到下一个音；连续标记可让一条圆滑线覆盖三个以上音符',
        );
      }
    }
    root.appendChild(section('修饰', toggleRow));

    if (isNote(ev)) {
      const span = this.store.slurSpanOf(this.barIndex, this.eventIndex);
      if (span) {
        const hint = document.createElement('p');
        hint.className = 'note-editor-hint';
        hint.textContent =
          `圆滑线覆盖 ${span.noteCount} 个音：第 ${span.startBar + 1} 小节第 ${span.startIndex + 1} 个记号 → ` +
          `第 ${span.endBar + 1} 小节第 ${span.endIndex + 1} 个记号`;
        root.appendChild(hint);
      }
    }

    if (isNote(ev)) {
      const lyricInput = document.createElement('input');
      lyricInput.type = 'text';
      lyricInput.className = 'input input-sm';
      lyricInput.value = ev.lyric;
      lyricInput.placeholder = '歌词';
      lyricInput.addEventListener('change', () => this.patch({ lyric: lyricInput.value }));
      root.appendChild(section('歌词', lyricInput));
    }

    const foot = document.createElement('div');
    foot.className = 'note-editor-foot';
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'btn btn-sm';
    del.textContent = '删除记号';
    del.addEventListener('click', () => {
      const at = { bar: this.barIndex, index: this.eventIndex };
      this.close();
      this.store.removeEvent(at.bar, at.index);
    });
    const delBar = document.createElement('button');
    delBar.type = 'button';
    delBar.className = 'btn btn-sm';
    delBar.textContent = '删除本小节';
    delBar.addEventListener('click', () => {
      const bar = this.barIndex;
      this.close();
      this.store.removeBar(bar);
    });
    foot.append(del, delBar);
    root.appendChild(foot);

    document.body.appendChild(root);
    this.el = root;
    this.place(anchor);

    document.addEventListener('pointerdown', this.onDocPointerDown, true);
    window.addEventListener('scroll', this.onScrollCapture, true);
  }

  /** 在当前光标位置打开浮层（键盘 E 键） */
  openAtCursor(): boolean {
    const cursor = this.store.cursor;
    const ev = this.store.getScore().bars[cursor.barIndex]?.events[cursor.eventIndex];
    if (!ev) return false;
    const anchor = document.querySelector(`g[data-event-id="${cssEscape(ev.id)}"]`);
    if (!anchor) return false;
    this.open(cursor.barIndex, cursor.eventIndex, anchor);
    return true;
  }

  private place(anchor: Element): void {
    const root = this.el;
    if (!root) return;
    const rect = anchor.getBoundingClientRect();
    const w = root.offsetWidth;
    const h = root.offsetHeight;
    let left = rect.left + rect.width / 2 - w / 2;
    left = Math.max(8, Math.min(window.innerWidth - w - 8, left));
    let top = rect.bottom + 8;
    if (top + h > window.innerHeight - 8) top = Math.max(8, rect.top - h - 8);
    root.style.left = `${Math.round(left)}px`;
    root.style.top = `${Math.round(top)}px`;
  }

  /** 数据变化后重建浮层（保持打开状态） */
  private refresh(): void {
    const ev = this.event();
    if (!ev || !this.el) {
      this.close();
      return;
    }
    const anchor = document.querySelector(`g[data-event-id="${cssEscape(ev.id)}"]`);
    if (!anchor) {
      this.close();
      return;
    }
    this.open(this.barIndex, this.eventIndex, anchor);
  }
}


