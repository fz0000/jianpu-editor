import { ALL_TONICS, formatTonic, parseTonic } from '../core/constants';
import type { ScoreStore } from '../core/document';
import { scoreToJianpuText } from '../core/jianpu-text';
import { FONT_SIZE_STEPS, fontSizeLabel, snapFontSize } from '../core/metrics';
import type { Score, Tonic } from '../core/model';
import { SAMPLES } from '../samples';
import { toast } from './toast';

export interface MetaPanelCallbacks {
  onImportText(text: string): void;
  onNewScore(): void;
}

interface Wrap {
  wrap: HTMLElement;
}
interface TextInputWrap extends Wrap {
  input: HTMLInputElement;
}
interface SelectWrap extends Wrap {
  select: HTMLSelectElement;
}
interface CheckWrap extends Wrap {
  input: HTMLInputElement;
}

function textInput(label: string): TextInputWrap {
  const wrap = document.createElement('label');
  wrap.className = 'field';
  const span = document.createElement('span');
  span.textContent = label;
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'input';
  wrap.append(span, input);
  return { wrap, input };
}

function selectInput(label: string, values: string[]): SelectWrap {
  return selectLabeled(label, values.map((value) => ({ value, label: value })));
}

interface Option {
  value: string;
  label: string;
}

function selectLabeled(label: string, options: Option[]): SelectWrap {
  const wrap = document.createElement('label');
  wrap.className = 'field';
  const span = document.createElement('span');
  span.textContent = label;
  const select = document.createElement('select');
  select.className = 'input';
  for (const option of options) {
    const opt = document.createElement('option');
    opt.value = option.value;
    opt.textContent = option.label;
    select.appendChild(opt);
  }
  wrap.append(span, select);
  return { wrap, select };
}

function numberInput(label: string, min: number, max: number): TextInputWrap {
  const wrap = document.createElement('label');
  wrap.className = 'field';
  const span = document.createElement('span');
  span.textContent = label;
  const input = document.createElement('input');
  input.type = 'number';
  input.min = String(min);
  input.max = String(max);
  input.className = 'input';
  wrap.append(span, input);
  return { wrap, input };
}

function checkInput(label: string): CheckWrap {
  const wrap = document.createElement('label');
  wrap.className = 'field field-check';
  const input = document.createElement('input');
  input.type = 'checkbox';
  const span = document.createElement('span');
  span.textContent = label;
  wrap.append(input, span);
  return { wrap, input };
}

function row(children: HTMLElement[]): HTMLElement {
  const div = document.createElement('div');
  div.className = 'field-row';
  div.append(...children);
  return div;
}

function fieldGroup(label: string, content: HTMLElement): HTMLElement {
  const div = document.createElement('div');
  div.className = 'field-group';
  const span = document.createElement('span');
  span.className = 'field-group-label';
  span.textContent = label;
  div.append(span, content);
  return div;
}

function textOf(score: Score): string {
  return scoreToJianpuText(score);
}

function tonicValue(value: string): Tonic {
  return parseTonic(value);
}

export class MetaPanel {
  private readonly titleInput = textInput('标题');
  private readonly singerInput = textInput('演唱');
  private readonly composerInput = textInput('作曲');
  private readonly lyricistInput = textInput('作词');
  private readonly tonicSelect = selectInput('调 (1=)', ALL_TONICS);
  private readonly numInput = numberInput('分子', 1, 24);
  private readonly denSelect = selectInput('分母', ['1', '2', '4', '8', '16']);
  private readonly tempoInput = numberInput('速度', 20, 300);
  private readonly lyricsCheck = checkInput('显示歌词');
  private readonly barNumberCheck = checkInput('显示小节号');
  private readonly barsPerLineInput = numberInput('每行小节数（0=自动）', 0, 32);
  private readonly fontSizeSelect = selectLabeled(
    '谱面字号',
    FONT_SIZE_STEPS.map((v) => ({ value: String(v), label: `${v} · ${fontSizeLabel(v)}` })),
  );
  private readonly textarea = document.createElement('textarea');

  constructor(
    private readonly root: HTMLElement,
    private readonly store: ScoreStore,
    private readonly cb: MetaPanelCallbacks,
  ) {
    this.build();
  }

  private section(title: string): HTMLElement {
    const box = document.createElement('section');
    box.className = 'panel-section';
    const h = document.createElement('h3');
    h.textContent = title;
    box.appendChild(h);
    this.root.appendChild(box);
    return box;
  }

  private build(): void {
    const info = this.section('乐曲信息');
    info.append(
      this.titleInput.wrap,
      this.singerInput.wrap,
      this.composerInput.wrap,
      this.lyricistInput.wrap,
      row([this.tonicSelect.wrap, this.tempoInput.wrap]),
      fieldGroup('拍号', row([this.numInput.wrap, this.denSelect.wrap])),
      row([this.lyricsCheck.wrap, this.barNumberCheck.wrap]),
      row([this.barsPerLineInput.wrap]),
      row([this.fontSizeSelect.wrap]),
    );

    const tools = this.section('乐谱');
    const sampleRow = document.createElement('div');
    sampleRow.className = 'btn-row';
    for (const sample of SAMPLES) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn btn-sm';
      b.textContent = sample.label;
      b.addEventListener('click', () => {
        this.store.replaceScore(sample.build(), 'load');
        toast(`已载入示例：${sample.label}`);
      });
      sampleRow.appendChild(b);
    }
    const newBtn = document.createElement('button');
    newBtn.type = 'button';
    newBtn.className = 'btn btn-sm';
    newBtn.textContent = '新建空谱';
    newBtn.addEventListener('click', () => this.cb.onNewScore());
    sampleRow.appendChild(newBtn);
    tools.appendChild(sampleRow);

    const textSection = this.section('简谱文本');
    this.textarea.className = 'textarea';
    this.textarea.rows = 5;
    this.textarea.spellcheck = false;
    this.textarea.placeholder = '1 2 3 4 | 5 5 6 6 | 5./ 0 3 4 |';
    textSection.appendChild(this.textarea);
    const hint = document.createElement('p');
    hint.className = 'panel-hint';
    hint.textContent =
      "记号：1-7 音级 · 0 休止 · - 延长 · ' 高八度 · , 低八度 · # b 升降 · . 附点 · / 缩短时值 · | 小节线";
    textSection.appendChild(hint);

    const textRow = document.createElement('div');
    textRow.className = 'btn-row';
    const importBtn = document.createElement('button');
    importBtn.type = 'button';
    importBtn.className = 'btn btn-sm btn-primary';
    importBtn.textContent = '导入文本';
    importBtn.addEventListener('click', () => this.cb.onImportText(this.textarea.value));
    const exportBtn = document.createElement('button');
    exportBtn.type = 'button';
    exportBtn.className = 'btn btn-sm';
    exportBtn.textContent = '导出到文本框';
    exportBtn.addEventListener('click', () => {
      this.textarea.value = textOf(this.store.getScore());
      this.textarea.select();
    });
    textRow.append(importBtn, exportBtn);
    textSection.appendChild(textRow);
  }

  sync(score: Score): void {
    const meta = score.meta;
    focusGuard(this.titleInput.input, () => (this.titleInput.input.value = meta.title));
    focusGuard(this.singerInput.input, () => (this.singerInput.input.value = meta.singer));
    focusGuard(this.composerInput.input, () => (this.composerInput.input.value = meta.composer));
    focusGuard(this.lyricistInput.input, () => (this.lyricistInput.input.value = meta.lyricist));
    focusGuard(this.tonicSelect.select, () => (this.tonicSelect.select.value = formatTonic(meta.tonic)));
    focusGuard(this.numInput.input, () => (this.numInput.input.value = String(meta.timeSig.num)));
    focusGuard(this.denSelect.select, () => (this.denSelect.select.value = String(meta.timeSig.den)));
    focusGuard(this.tempoInput.input, () => (this.tempoInput.input.value = String(meta.tempo)));
    this.lyricsCheck.input.checked = meta.showLyrics;
    this.barNumberCheck.input.checked = meta.showBarNumbers;
    focusGuard(this.barsPerLineInput.input, () => (this.barsPerLineInput.input.value = String(meta.barsPerLine ?? 0)));
    focusGuard(this.fontSizeSelect.select, () => (this.fontSizeSelect.select.value = String(snapFontSize(meta.fontSize))));
    focusGuard(this.textarea, () => (this.textarea.value = textOf(score)));
  }

  bind(): void {
    const store = this.store;
    const meta = (patch: Parameters<ScoreStore['setMeta']>[0]) => store.setMeta(patch);
    this.titleInput.input.addEventListener('change', () => meta({ title: this.titleInput.input.value }));
    this.singerInput.input.addEventListener('change', () => meta({ singer: this.singerInput.input.value }));
    this.composerInput.input.addEventListener('change', () => meta({ composer: this.composerInput.input.value }));
    this.lyricistInput.input.addEventListener('change', () => meta({ lyricist: this.lyricistInput.input.value }));
    this.tonicSelect.select.addEventListener('change', () => meta({ tonic: tonicValue(this.tonicSelect.select.value) }));
    const timeSig = () => ({
      num: Math.max(1, Math.min(24, Math.round(Number(this.numInput.input.value) || 4))),
      den: Number(this.denSelect.select.value) || 4,
    });
    this.numInput.input.addEventListener('change', () => meta({ timeSig: timeSig() }));
    this.denSelect.select.addEventListener('change', () => meta({ timeSig: timeSig() }));
    this.tempoInput.input.addEventListener('change', () =>
      meta({ tempo: Math.max(20, Math.min(300, Math.round(Number(this.tempoInput.input.value) || 100))) }),
    );
    this.lyricsCheck.input.addEventListener('change', () => meta({ showLyrics: this.lyricsCheck.input.checked }));
    this.barNumberCheck.input.addEventListener('change', () =>
      meta({ showBarNumbers: this.barNumberCheck.input.checked }),
    );
    this.barsPerLineInput.input.addEventListener('change', () =>
      meta({
        barsPerLine: Math.max(0, Math.min(32, Math.round(Number(this.barsPerLineInput.input.value) || 0))),
      }),
    );
    this.fontSizeSelect.select.addEventListener('change', () =>
      meta({ fontSize: snapFontSize(Number(this.fontSizeSelect.select.value)) }),
    );
  }
}

function focusGuard(el: HTMLElement, apply: () => void): void {
  if (document.activeElement !== el) apply();
}

