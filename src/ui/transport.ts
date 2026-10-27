import type { InstrumentPreset } from '../core/model';
import { INSTRUMENT_LABELS } from '../core/model';

/** 播放状态机：与 `Player` 的三态一一对应 */
export type PlayState = 'stopped' | 'playing' | 'paused';

export interface TransportCallbacks {
  /**
   * 播放 / 暂停 / 继续**一个按钮**：播放中点 = 暂停（保留断点），
   * 暂停中点 = 从断点续播，停止态点 = 从当前高亮的记号起播。
   * 暂停期间用户移动了高亮时，调用方要 `setState('stopped')` 把「继续」打回「播放」
   * （断点作废，下一次点击从新高亮的记号起播）——见 `main.ts` 的 `dropResumePointOnCursorMove`。
   */
  onPlayPause(): void;
  /** 停止：淡出消音并回到开头（与播放按钮的第二次点击不再重复——那一下是暂停） */
  onStop(): void;
  onTempo(value: number): void;
  onRate(value: number): void;
  onLoop(value: boolean): void;
  onInstrument(value: InstrumentPreset): void;
}

/**
 * 播放按钮的文案随状态走。**`is-active` 只在真正发声时亮着**——暂停态必须弹起，
 * 否则按钮顶着「播放中」的按下态而声音已经停了，界面在骗人。
 */
const PLAY_BUTTON: Record<PlayState, { label: string; title: string; active: boolean }> = {
  stopped: { label: '▶ 播放', title: '从当前高亮的记号播放 (Space)', active: false },
  playing: { label: '⏸ 暂停', title: '暂停 (Space)', active: true },
  paused: { label: '▶ 继续', title: '从断点继续 (Space)', active: false },
};

export class Transport {
  private playBtn!: HTMLButtonElement;
  private tempoInput!: HTMLInputElement;
  private positionEl!: HTMLElement;
  private instrumentSelect!: HTMLSelectElement;
  private state: PlayState = 'stopped';

  constructor(
    private readonly root: HTMLElement,
    private readonly cb: TransportCallbacks,
  ) {
    this.build();
  }

  private build(): void {
    const wrap = document.createElement('div');
    wrap.className = 'transport-group';

    this.playBtn = mkButton(PLAY_BUTTON.stopped.label, PLAY_BUTTON.stopped.title, () =>
      this.cb.onPlayPause(),
    );
    const stop = mkButton('⏹ 停止', '停止 (Esc)', () => this.cb.onStop());
    wrap.append(this.playBtn, stop);
    this.root.appendChild(wrap);

    const tempo = document.createElement('label');
    tempo.className = 'transport-field';
    tempo.innerHTML = '<span>速度</span>';
    this.tempoInput = document.createElement('input');
    this.tempoInput.type = 'number';
    this.tempoInput.min = '20';
    this.tempoInput.max = '300';
    this.tempoInput.step = '1';
    this.tempoInput.className = 'input input-sm';
    this.tempoInput.addEventListener('change', () => {
      const v = Number(this.tempoInput.value);
      if (Number.isFinite(v)) this.cb.onTempo(Math.max(20, Math.min(300, Math.round(v))));
    });
    const unit = document.createElement('span');
    unit.className = 'unit';
    unit.textContent = 'BPM';
    tempo.append(this.tempoInput, unit);
    this.root.appendChild(tempo);

    const rate = document.createElement('label');
    rate.className = 'transport-field';
    rate.innerHTML = '<span>倍速</span>';
    const rateSelect = document.createElement('select');
    rateSelect.className = 'input input-sm';
    for (const value of [0.5, 0.75, 1, 1.25, 1.5, 2]) {
      const opt = document.createElement('option');
      opt.value = String(value);
      opt.textContent = `${value}×`;
      if (value === 1) opt.selected = true;
      rateSelect.appendChild(opt);
    }
    rateSelect.addEventListener('change', () => this.cb.onRate(Number(rateSelect.value)));
    rate.appendChild(rateSelect);
    this.root.appendChild(rate);

    const loop = document.createElement('label');
    loop.className = 'transport-field transport-check';
    const loopInput = document.createElement('input');
    loopInput.type = 'checkbox';
    loopInput.addEventListener('change', () => this.cb.onLoop(loopInput.checked));
    const loopText = document.createElement('span');
    loopText.textContent = '循环';
    loop.append(loopInput, loopText);
    this.root.appendChild(loop);

    const inst = document.createElement('label');
    inst.className = 'transport-field';
    inst.innerHTML = '<span>音色</span>';
    this.instrumentSelect = document.createElement('select');
    this.instrumentSelect.className = 'input input-sm';
    for (const [value, label] of Object.entries(INSTRUMENT_LABELS)) {
      const opt = document.createElement('option');
      opt.value = value;
      opt.textContent = label;
      this.instrumentSelect.appendChild(opt);
    }
    this.instrumentSelect.addEventListener('change', () => {
      this.cb.onInstrument(this.instrumentSelect.value as InstrumentPreset);
    });
    inst.appendChild(this.instrumentSelect);
    this.root.appendChild(inst);

    this.positionEl = document.createElement('div');
    this.positionEl.className = 'transport-position';
    this.positionEl.textContent = '未播放';
    this.root.appendChild(this.positionEl);
  }

  /** 当前状态（测试与外部回调用） */
  get playState(): PlayState {
    return this.state;
  }

  setState(state: PlayState): void {
    this.state = state;
    const view = PLAY_BUTTON[state];
    this.playBtn.textContent = view.label;
    this.playBtn.title = view.title;
    this.playBtn.classList.toggle('is-active', view.active);
  }

  setTempo(tempo: number): void {
    if (document.activeElement !== this.tempoInput) this.tempoInput.value = String(tempo);
  }

  setPosition(bar: number | null, noteName: string | null): void {
    if (bar === null) {
      this.positionEl.textContent = '未播放';
      return;
    }
    this.positionEl.textContent = `第 ${bar + 1} 小节${noteName ? ` · ${noteName}` : ''}`;
  }

  setInstrument(inst: InstrumentPreset): void {
    if (document.activeElement !== this.instrumentSelect) {
      this.instrumentSelect.value = inst;
    }
  }
}

function mkButton(label: string, title: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn transport-btn';
  button.textContent = label;
  button.title = title;
  button.addEventListener('click', onClick);
  return button;
}