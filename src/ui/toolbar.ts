import { DEFAULT_FONT_SIZE, MAX_FONT_SIZE, MIN_FONT_SIZE } from '../core/metrics';
import type { Accidental, BarlineKind, Duration } from '../core/model';

export interface ToolbarCallbacks {
  onDuration(d: Duration): void;
  onDot(): void;
  onAccidental(a: Accidental): void;
  onOctave(delta: number): void;
  /** 全曲移调：delta = 半音数（正 = 升高），走默认方式（只平移调号） */
  onTranspose(delta: number): void;
  /** 打开「全曲移调」对话框（任意半音数，可选改调号 / 改音符） */
  onTransposeDialog(): void;
  onTriplet(): void;
  onTie(): void;
  onSlur(): void;
  onRest(): void;
  onDash(): void;
  onDelete(): void;
  onToggleInsertMode(): void;
  onInsertBar(): void;
  onRemoveBar(): void;
  onBarline(kind: BarlineKind): void;
  onCompactNotation(): void;
  /** 谱面字号：delta = +1 放大 / -1 缩小 / 0 恢复标准 */
  onFontSize(delta: number): void;
  onUndo(): void;
  onRedo(): void;
}

export interface ToolbarState {
  duration: Duration;
  dotted: boolean;
  accidental: Accidental;
  octave: number;
  triplet: boolean;
  tie: boolean;
  slur: boolean;
  insertMode: boolean;
  /** 当前谱面字号（数字字号，SVG 用户单位），显示在「A」按钮上 */
  fontSize: number;
  canUndo: boolean;
  canRedo: boolean;
  hasSelection: boolean;
}

interface ButtonSpec {
  label: string;
  title: string;
  key: string;
  onClick: () => void;
}

const DURATION_BUTTONS: { d: Duration; label: string; title: string }[] = [
  { d: 1, label: '全', title: '全音符 (Q)' },
  { d: 2, label: '半', title: '二分音符 (W)' },
  { d: 4, label: '1/4', title: '四分音符 (R)' },
  { d: 8, label: '1/8', title: '八分音符 (T)' },
  { d: 16, label: '1/16', title: '十六分音符 (Y)' },
  { d: 32, label: '1/32', title: '三十二分音符 (U)' },
];

export class Toolbar {
  private readonly buttons = new Map<string, HTMLButtonElement>();

  constructor(
    private readonly root: HTMLElement,
    private readonly cb: ToolbarCallbacks,
  ) {
    this.build();
  }

  private group(label: string, specs: ButtonSpec[]): void {
    const wrap = document.createElement('div');
    wrap.className = 'tool-group';
    const title = document.createElement('span');
    title.className = 'tool-group-label';
    title.textContent = label;
    wrap.appendChild(title);
    for (const spec of specs) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'tool-btn';
      button.textContent = spec.label;
      button.title = spec.title;
      button.addEventListener('click', spec.onClick);
      this.buttons.set(spec.key, button);
      wrap.appendChild(button);
    }
    this.root.appendChild(wrap);
  }

  private build(): void {
    const { cb } = this;

    this.group(
      '时值',
      DURATION_BUTTONS.map(({ d, label, title }) => ({
        label,
        title,
        key: `dur-${d}`,
        onClick: () => cb.onDuration(d),
      })),
    );

    this.group('修饰', [
      { label: '·', title: '附点 (D)', key: 'dot', onClick: cb.onDot },
      { label: '#', title: '升号 (S)', key: 'sharp', onClick: () => cb.onAccidental('sharp') },
      { label: 'b', title: '降号 (F)', key: 'flat', onClick: () => cb.onAccidental('flat') },
      { label: '♮', title: '还原 (N)', key: 'natural', onClick: () => cb.onAccidental('natural') },
      { label: '3', title: '三连音标记 (L)', key: 'triplet', onClick: cb.onTriplet },
      { label: '⌒', title: '连音线 tie（连到前一个音，快捷键 V）', key: 'tie', onClick: cb.onTie },
      {
        label: '⌢',
        title:
          '圆滑线 slur（连到前一个音；选中第一个音时连到后一个音。连续标记三个以上音符会共用一条圆滑线，快捷键 B）',
        key: 'slur',
        onClick: cb.onSlur,
      },
    ]);


    this.group('八度 / 移调', [
      { label: '↑', title: '高八度 (])', key: 'oct-up', onClick: () => cb.onOctave(1) },
      { label: '↓', title: '低八度 ([)', key: 'oct-down', onClick: () => cb.onOctave(-1) },
      { label: '○', title: '清除八度点 (0 与数字之间)', key: 'oct-clear', onClick: () => cb.onOctave(0) },
      {
        label: '全↑',
        title: '全曲升高 1 个半音：只平移调号（1=C → 1=C#），谱面数字不变 (Ctrl+Shift+])',
        key: 'transpose-up',
        onClick: () => cb.onTranspose(1),
      },
      {
        label: '全↓',
        title: '全曲降低 1 个半音：只平移调号（1=C → 1=bB），谱面数字不变 (Ctrl+Shift+[)',
        key: 'transpose-down',
        onClick: () => cb.onTranspose(-1),
      },
      {
        label: '移调…',
        title:
          '全曲移调：以半音为单位升降任意度。默认只平移调号（数字不变），可勾选改成改写音符（调号不变，谱面出现 # b）(Ctrl+Shift+M)',
        key: 'transpose-dialog',
        onClick: cb.onTransposeDialog,
      },
    ]);

    this.group('输入', [
      { label: '0', title: '休止符 (空格)', key: 'rest', onClick: cb.onRest },
      { label: '—', title: '延长记号 (-)', key: 'dash', onClick: cb.onDash },
      { label: '删', title: '删除当前记号 (Delete)', key: 'delete', onClick: cb.onDelete },
      { label: '插', title: '插入 / 覆盖模式切换 (Insert)', key: 'insert', onClick: cb.onToggleInsertMode },
    ]);

    this.group('小节', [
      { label: '＋节', title: '在光标后插入小节', key: 'bar-add', onClick: cb.onInsertBar },
      { label: '－节', title: '删除光标所在小节', key: 'bar-remove', onClick: cb.onRemoveBar },
      { label: '|:', title: '反复开始线', key: 'barline-start', onClick: () => cb.onBarline('repeat-start') },
      { label: ':|', title: '反复结束线', key: 'barline-end', onClick: () => cb.onBarline('repeat-end') },
      { label: '∥', title: '终止线', key: 'barline-final', onClick: () => cb.onBarline('final') },
      { label: '|', title: '普通小节线', key: 'barline-normal', onClick: () => cb.onBarline('normal') },
    ]);

    this.group('整理', [
      {
        label: '简⌒',
        title:
          '精简记号：把小节内同音高的连音线链合并成更长时值（四分 / 二分 / 全音符 + 增时线），并把小节内连续的休止符合并成更少的休止符；跨小节的长音保留（快捷键 Alt+T）',
        key: 'compact-ties',
        onClick: cb.onCompactNotation,
      },
    ]);

    this.group('谱面字号', [
      { label: 'A−', title: '缩小谱面字号（整张谱面等比缩小，每行小节数随之增多，快捷键 Ctrl+Shift+-）', key: 'font-down', onClick: () => cb.onFontSize(-1) },
      { label: 'A', title: '当前谱面字号；点击恢复标准字号', key: 'font-size', onClick: () => cb.onFontSize(0) },
      { label: 'A+', title: '放大谱面字号（整张谱面等比放大，每行小节数随之减少，快捷键 Ctrl+Shift+=）', key: 'font-up', onClick: () => cb.onFontSize(1) },
    ]);

    this.group('历史', [
      { label: '↶', title: '撤销 (Ctrl+Z)', key: 'undo', onClick: cb.onUndo },
      { label: '↷', title: '重做 (Ctrl+Y)', key: 'redo', onClick: cb.onRedo },
    ]);
  }

  update(state: ToolbarState): void {
    const set = (key: string, active: boolean, disabled = false): void => {
      const button = this.buttons.get(key);
      if (!button) return;
      button.classList.toggle('is-active', active);
      button.disabled = disabled;
    };

    for (const { d } of DURATION_BUTTONS) set(`dur-${d}`, state.duration === d);
    set('dot', state.dotted, !state.hasSelection);
    set('sharp', state.accidental === 'sharp', !state.hasSelection);
    set('flat', state.accidental === 'flat', !state.hasSelection);
    set('natural', state.accidental === 'natural' && state.hasSelection, !state.hasSelection);
    set('triplet', state.triplet, !state.hasSelection);
    set('tie', state.tie, !state.hasSelection);
    set('slur', state.slur, !state.hasSelection);

    set('oct-up', state.octave > 0, !state.hasSelection);
    set('oct-down', state.octave < 0, !state.hasSelection);
    set('insert', state.insertMode);
    // 字号按钮直接显示当前字号（A30 / A38 …），非标准档时高亮；到达端点时禁用对应按钮
    const fontButton = this.buttons.get('font-size');
    if (fontButton) {
      fontButton.textContent = `A${state.fontSize}`;
      fontButton.classList.toggle('is-active', state.fontSize !== DEFAULT_FONT_SIZE);
      fontButton.disabled = state.fontSize === DEFAULT_FONT_SIZE;
    }
    set('font-down', false, state.fontSize <= MIN_FONT_SIZE);
    set('font-up', false, state.fontSize >= MAX_FONT_SIZE);
    set('undo', false, !state.canUndo);
    set('redo', false, !state.canRedo);
    set('delete', false, !state.hasSelection);
  }
}