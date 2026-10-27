import { mappingToMidi, tonicMidiBase } from '../core/constants';
import { noteBeats, restBeats, type InstrumentPreset, type Score } from '../core/model';

export interface PlayNote {
  /**
   * 计划项类型。`'rest'` 项**不发声**，只为休止符提供逐拍高亮与进度定位
   * （播放时「0」也要跟着亮，演奏者才数得清拍子），`midi` 为 NaN。
   */
  kind: 'note' | 'rest';
  eventId: string;
  barIndex: number;
  eventIndex: number;
  startBeat: number;
  beats: number;
  /** 绝对音高（MIDI 号）；休止符项是 NaN，取用前先判 kind */
  midi: number;
  velocity: number;
  /**
   * 该音符是连音线（tie）的后续音符：时值已经累加进前一个同音高音符，
   * 播放时不重新起音，只用于跟随高亮与进度定位。
   */
  tied: boolean;
}

export interface InstCfg {
  oscType: OscillatorType;
  oscCount: number;
  detune: number;
  subGain: number;
  subOctave: number;
  filterFreq: number;
  filterQ: number;
  attack: number;
  /** 从峰值衰减到 sustain 的时间（瞬态） */
  decay: number;
  /**
   * 持续段起点的电平（峰值的比例）。
   * **不能低到听不见**：这是整段时值里的发声电平，调低了长音就会「听起来像短音」
   * （旧值钢琴 0.12 / 吉他 0.04 / 八音盒 0.01 就是这个坑，见 tests/audio-envelope.test.ts）。
   * 拨弦类的「余音渐弱」交给 bodyTail，别靠压低 sustain 实现。
   */
  sustain: number;
  /** 持续段末尾（释音起点）电平相对 sustain 的比例，模拟琴弦/音体的缓慢衰减 */
  bodyTail: number;
  release: number;
  peak: number;
  body: Partial<{
    oscType2: OscillatorType;
    gain2: number;
    detune2: number;
    harmonic: number;
    harmonicGain: number;
  }>;
}

export const INSTRUMENTS: Record<InstrumentPreset, InstCfg> = {
  piano: {
    oscType: 'triangle',
    oscCount: 2,
    detune: 6,
    subGain: 0.15,
    subOctave: -1,
    filterFreq: 4200,
    filterQ: 0.5,
    attack: 0.006,
    decay: 0.18,
    sustain: 0.55,
    bodyTail: 0.7,
    release: 0.25,
    peak: 1.0,
    body: { oscType2: 'sawtooth', gain2: 0.22, detune2: -3, harmonic: 2, harmonicGain: 0.18 },
  },
  flute: {
    oscType: 'sine',
    oscCount: 1,
    detune: 2,
    subGain: 0.08,
    subOctave: 0,
    filterFreq: 2800,
    filterQ: 0.3,
    attack: 0.04,
    decay: 0.08,
    sustain: 0.85,
    bodyTail: 0.95,
    release: 0.18,
    peak: 0.55,
    body: {},
  },
  violin: {
    oscType: 'sawtooth',
    oscCount: 3,
    detune: 4,
    subGain: 0.12,
    subOctave: -1,
    filterFreq: 3200,
    filterQ: 0.7,
    attack: 0.09,
    decay: 0.13,
    sustain: 0.7,
    bodyTail: 0.9,
    release: 0.3,
    peak: 0.65,
    body: { harmonic: 3, harmonicGain: 0.12 },
  },
  organ: {
    oscType: 'sawtooth',
    oscCount: 2,
    detune: 3,
    subGain: 0.32,
    subOctave: -1,
    filterFreq: 5000,
    filterQ: 0.4,
    attack: 0.01,
    decay: 0.06,
    sustain: 0.8,
    bodyTail: 0.98,
    release: 0.12,
    peak: 0.6,
    body: { oscType2: 'square', gain2: 0.35, detune2: 12, harmonic: 2, harmonicGain: 0.25 },
  },
  guitar: {
    oscType: 'triangle',
    oscCount: 2,
    detune: 5,
    subGain: 0.1,
    subOctave: -1,
    filterFreq: 3500,
    filterQ: 0.6,
    attack: 0.003,
    decay: 0.16,
    sustain: 0.5,
    bodyTail: 0.7,
    release: 0.3,
    peak: 0.9,
    body: { oscType2: 'sawtooth', gain2: 0.16, harmonic: 2, harmonicGain: 0.22 },
  },
  clarinet: {
    oscType: 'square',
    oscCount: 2,
    detune: 3,
    subGain: 0.06,
    subOctave: 0,
    filterFreq: 2200,
    filterQ: 0.8,
    attack: 0.03,
    decay: 0.07,
    sustain: 0.75,
    bodyTail: 0.92,
    release: 0.2,
    peak: 0.5,
    body: { harmonic: 3, harmonicGain: 0.15 },
  },
  musicbox: {
    oscType: 'sine',
    oscCount: 1,
    detune: 1,
    subGain: 0.0,
    subOctave: 0,
    filterFreq: 6000,
    filterQ: 0.2,
    attack: 0.001,
    decay: 0.12,
    sustain: 0.5,
    bodyTail: 0.6,
    release: 0.5,
    peak: 0.75,
    body: { harmonic: 4, harmonicGain: 0.35 },
  },
};

// ---------- 输出链与调度参数（防爆音的几条硬约定，见 tests/audio-envelope.test.ts） ----------

/** 主输出增益：单音峰值约 0.22，这里留出多音叠加的余量 */
export const MASTER_GAIN = 0.8;

/**
 * 软限幅曲线的拐点：`|x| ≤ knee` 段完全线性（小信号零失真），
 * 超过之后用 tanh 平滑压下去，永不越界。
 */
export const SOFT_CLIP_KNEE = 0.6;

/** 软限幅曲线的采样点数（奇数，保证过零点正好落在格点上，不引入直流偏移） */
export const SOFT_CLIP_POINTS = 2049;

/** 停止 / 暂停 / 重播 / 变速时的淡出时长：直接掐断波形就是一声「咔哒」 */
export const FADE_OUT_SEC = 0.02;

/** 前瞻调度窗口：只创建未来这段时间内要发声的音频节点，不要一次排完整首曲子 */
export const LOOKAHEAD_SEC = 0.5;

/** 调度泵的定时器间隔（rAF 只负责逐拍高亮，音频调度不能挂在 rAF 上） */
export const PUMP_INTERVAL_MS = 25;

/** 最短发声时值：比这更短的音在包络上已经没意义 */
export const MIN_NOTE_SEC = 0.05;

/** 起音时刻相对当前时间的最小提前量：自动化事件不能落在过去 */
export const SCHEDULE_AHEAD_SEC = 0.02;

/**
 * WaveShaper 的软削波曲线（纯计算，可单测）。
 *
 * **为什么要有它**：单音峰值约 0.22，看着很安全，但音与音是**重叠**的——释音锚在时值
 * 结束点，尾音一直响到「时值结束后 2 倍释音」，于是每个音都跨进下一个音；循环模式下
 * 上一遍的尾音还会叠上新一遍的起音。几条尾巴一叠加就顶过 1.0，直接进 destination
 * 就是硬削波，听感是偶发的「啪」一声（密集十六分、连音线长音、循环接缝处最容易碰到）。
 *
 * 用 WaveShaper 而不是 DynamicsCompressor：压缩器自带 makeup gain（threshold -10 /
 * ratio 12 时约 2.9 倍），本来就是为了压削波而抬电平，反而更容易削波；软限幅曲线
 * 在拐点以下完全透明，且是纯数组，能直接单测。
 */
export function softClipCurve(n = SOFT_CLIP_POINTS, knee = SOFT_CLIP_KNEE): Float32Array<ArrayBuffer> {
  const size = Math.max(3, Math.floor(n));
  const curve = new Float32Array(size);
  const head = Math.max(1e-6, 1 - knee);
  for (let i = 0; i < size; i += 1) {
    const x = (i / (size - 1)) * 2 - 1;
    const ax = Math.abs(x);
    // 拐点处函数值与斜率都连续（右侧斜率 = head × (1/head) × sech²(0) = 1），
    // 所以小信号完全线性，大信号平滑饱和，不会在拐点本身产生新的失真。
    curve[i] = ax <= knee ? x : Math.sign(x) * (knee + head * Math.tanh((ax - knee) / head));
  }
  const mid = (size - 1) / 2;
  if (Number.isInteger(mid)) curve[mid] = 0;
  return curve;
}

/**
 * 一个声部里所有振荡器的增益总和：主振荡器组固定摊成 0.7（`0.7 / oscCount × oscCount`），
 * 再加二次音色、泛音、次低音。乘上包络峰值就是这一声的瞬时振幅上限。
 */
export function voiceGainSum(cfg: InstCfg): number {
  let sum = 0.7;
  if (cfg.body.oscType2 && cfg.body.gain2) sum += cfg.body.gain2;
  if (cfg.body.harmonic && cfg.body.harmonicGain) sum += cfg.body.harmonicGain;
  if (cfg.subGain > 0) sum += cfg.subGain;
  return sum;
}

/** 单声部的峰值振幅（含主输出增益）：明显小于 1 才有多音叠加的余量 */
export function voicePeakAmplitude(cfg: InstCfg, durSec: number, velocity: number): number {
  return noteEnvelope(cfg, durSec, velocity).peak * voiceGainSum(cfg) * MASTER_GAIN;
}

/** 包络控制点：相对起音时刻的秒数 → 增益值 */
export interface EnvelopePoint {
  t: number;
  v: number;
}

export interface Envelope {
  peak: number;
  attack: number;
  decay: number;
  release: number;
  /** 持续段起点电平（= peak * cfg.sustain） */
  sustain: number;
  /** 持续段末尾（释音起点）电平（= sustain * cfg.bodyTail） */
  tail: number;
  /** 释音起点：记符时值结束前 release 秒 */
  sustainEnd: number;
  /** 完全静音的时刻：时值结束后 release * 2 秒 */
  end: number;
  points: EnvelopePoint[];
}

/**
 * 按时值算出这个音的增益包络（纯计算，可单测）。
 *
 * 形状：起音 → 峰值 → 衰减到 sustain → 缓慢体衰减到 tail → 释音归零。
 * 关键是**释音以「时值结束点」为中心**：淡出从 `durSec - release` 起、到 `durSec + release * 2`
 * 归零，于是记符时值之内一直是 tail 附近的可听电平（时值结束那一刻还剩 2/3 尾音），
 * 长音才读得出长度。
 * 旧写法把淡出终点放在 `durSec + release * 2`、起点放在 `durSec - release`，
 * 再叠上拨弦类低到 1%–12% 的 sustain，钢琴 / 吉他 / 八音盒的长音在 0.4 秒内就掉到听不见，
 * 听起来就是「每个音都很短，没按时值延长」。
 */
export function noteEnvelope(cfg: InstCfg, durSec: number, velocity: number): Envelope {
  const vel = 0.35 + ((velocity || 96) / 127) * 0.65;
  const peak = cfg.peak * vel * 0.22;
  const attack = Math.min(cfg.attack, durSec * 0.25);
  // 释音最多占时值的四分之一：淡出不能吃掉大半条音，否则长音尾部先没了
  const release = Math.min(cfg.release, durSec * 0.25);
  // 衰减必须在释音起点之前走完，否则时值长的音会一路衰减下去、落不到 sustain
  const decay = Math.min(cfg.decay, Math.max(0.005, durSec - attack - release));
  const sustain = peak * cfg.sustain;
  const tail = sustain * cfg.bodyTail;
  const sustainEnd = Math.max(attack + decay, durSec - release);
  const end = durSec + release * 2;
  return {
    peak,
    attack,
    decay,
    release,
    sustain,
    tail,
    sustainEnd,
    end,
    points: [
      { t: 0, v: 0 },
      { t: attack, v: peak },
      { t: attack + decay, v: sustain },
      { t: sustainEnd, v: tail },
      { t: end, v: 0 },
    ],
  };
}

/** 按包络控制点线性插值取 t 时刻的增益值（测试与预览用） */
export function sampleEnvelope(env: Envelope, t: number): number {
  const pts = env.points;
  if (t <= pts[0].t) return pts[0].v;
  for (let i = 1; i < pts.length; i += 1) {
    if (t > pts[i].t) continue;
    const a = pts[i - 1];
    const b = pts[i];
    if (b.t <= a.t) return b.v;
    const k = (t - a.t) / (b.t - a.t);
    return a.v + (b.v - a.v) * k;
  }
  return pts[pts.length - 1].v;
}


/**
 * 把乐谱展开成播放计划。
 * 延长线并入前一个音符；连音线（tie）把时值累加到前一个同音高音符，
 * 累加出来的后续音符保留在计划里（tied=true）但不单独发声。
 * 休止符也进计划（kind='rest'，不发声）：播放时休止符要跟着高亮，
 * 末尾的休止符也要计入总时长，否则全曲以休止结尾时播放会提前结束。
 */
export function buildPlaybackPlan(score: Score): PlayNote[] {
  const tonicBase = tonicMidiBase(score.meta.tonic, 4);
  const plan: PlayNote[] = [];
  let beat = 0;
  let last: PlayNote | null = null;
  let lastBaseBeats = 0;

  for (let b = 0; b < score.bars.length; b += 1) {
    const bar = score.bars[b];
    for (let i = 0; i < bar.events.length; i += 1) {
      const ev = bar.events[i];
      if (ev.kind === 'note') {
        const beats = noteBeats(ev);
        const midi = mappingToMidi(
          { degree: ev.degree, accidental: ev.accidental, octave: ev.octave },
          tonicBase,
        );
        // 连音线：与前一个发声音符音高相同才合并时值，此时不重新起音
        const mergeable = ev.tie && last !== null && last.midi === midi;
        const note: PlayNote = {
          kind: 'note',
          eventId: ev.id,
          barIndex: b,
          eventIndex: i,
          startBeat: beat,
          beats,
          midi,
          velocity: ev.velocity || 96,
          tied: mergeable,
        };
        if (mergeable && last) {
          last.beats += beats;
        } else {
          last = note;
        }
        plan.push(note);
        lastBaseBeats = beats;
        beat += beats;
      } else if (ev.kind === 'rest') {
        const beats = restBeats(ev);
        // 休止符进计划但不发声（schedule 里跳过），只用于逐拍高亮与总时长
        plan.push({
          kind: 'rest',
          eventId: ev.id,
          barIndex: b,
          eventIndex: i,
          startBeat: beat,
          beats,
          midi: Number.NaN,
          velocity: 0,
          tied: false,
        });
        beat += beats;
        last = null;
        lastBaseBeats = 0;
      } else {
        const base = lastBaseBeats || 1;
        if (last) last.beats += base;
        beat += base;
      }
    }
  }
  return plan;
}

/**
 * 这个计划项该不该发声。
 *
 * 三层过滤：休止符项不发声；连音线后续音符的时值已经并入链首，不重新起音；
 * **音高非有限值的不发声**——旧工程文件里 `degree === 0` 的音符（写成音符的休止）
 * 在 `DEGREE_PC` 里没有条目，`mappingToMidi` 对它算出 NaN，把 NaN 写进
 * `osc.frequency.value` 在 Chrome 里直接抛异常（整首曲子放不出来），
 * 非有限值还会污染整条音频链（输出变静音 / 乱码）。
 */
export function isPlayableNote(note: PlayNote): boolean {
  return note.kind === 'note' && !note.tied && Number.isFinite(note.midi);
}

/**
 * 从 `fromSec` 起播时，第一个还要发声的计划项下标（之前的都已结束，跳过）。
 * 用「结束拍」判断，所以起播点落在某个长音中间时，那个音会从头重放一次
 * （与旧版 `endSec <= from → continue` 的行为一致）。纯计算，可单测。
 */
export function firstSoundingIndex(plan: PlayNote[], fromSec: number, spb: number): number {
  if (!(fromSec > 0) || !(spb > 0)) return 0;
  const fromBeat = fromSec / spb;
  for (let i = 0; i < plan.length; i += 1) {
    const n = plan[i];
    if (n.startBeat + n.beats > fromBeat) return i;
  }
  return plan.length;
}

/**
 * 找出某一拍位应高亮的计划项下标，找不到返回 -1。
 * 从后往前找：连音线的后续音符起始拍更晚，应优先于被它合并的音符命中。
 * 休止符项同样命中，所以播放经过休止符时「0」会亮起来。
 */
export function findPlanIndexAtBeat(plan: PlayNote[], beat: number): number {
  for (let i = plan.length - 1; i >= 0; i -= 1) {
    const n = plan[i];
    if (beat >= n.startBeat && beat < n.startBeat + n.beats) return i;
  }
  return -1;
}

/** 在乐谱中查找指定事件的累计拍数位置（用于休止符/延长线的起播定位） */
function findEventBeat(score: Score, eventId: string): number {
  let beat = 0;
  let lastNoteBeats = 0;
  for (let b = 0; b < score.bars.length; b += 1) {
    for (let i = 0; i < score.bars[b].events.length; i += 1) {
      const ev = score.bars[b].events[i];
      if (ev.id === eventId) return beat;
      if (ev.kind === 'note') {
        const nb = noteBeats(ev);
        beat += nb;
        lastNoteBeats = nb;
      } else if (ev.kind === 'rest') {
        beat += restBeats(ev);
        lastNoteBeats = 0;
      } else {
        beat += lastNoteBeats || 1;
      }
    }
  }
  return -1;
}

interface Voice {
  oscs: OscillatorNode[];
  gain: GainNode;
  filter: BiquadFilterNode;
  /** 包络归零的时刻（`ctx.currentTime` 时基）；过了它这个声部就该清出列表 */
  endsAt: number;
}

/** 页面是否在后台：后台标签页的定时器会被节流到 1 秒以上，前瞻窗口跟不上就得整段排完 */
function isDocumentHidden(): boolean {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden';
}

export class Player {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private voices: Voice[] = [];
  private raf = 0;
  /** 调度泵定时器（`ReturnType` 兼容 DOM 与 node 两套 `setInterval` 签名） */
  private pumpTimer: ReturnType<typeof setInterval> | null = null;
  private startAt = 0;
  /** 下一个待调度的计划项下标（前瞻调度：只排到 horizon 为止） */
  private nextIndex = 0;
  private plan: PlayNote[] = [];
  private totalBeats = 0;
  private tempo = 100;
  private rate = 1;
  private loop = false;
  /**
   * 暂停时停在**第几拍**。存拍数不存秒：暂停期间用户会改速度 / 倍速，
   * `resume()` 换算回秒时拍位才不会跳（与 `setRate` 里「发声与逐拍高亮两条时间轴必须对齐」同一套约定）。
   */
  private pauseBeat = 0;
  private state: 'stopped' | 'playing' | 'paused' = 'stopped';
  private instrument: InstrumentPreset = 'piano';

  onNote: ((note: PlayNote | null, index: number) => void) | null = null;
  onEnd: (() => void) | null = null;

  constructor() {
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', this.onVisibility);
  }

  get isPlaying(): boolean {
    return this.state === 'playing';
  }

  /** 暂停态：断点（`pauseBeat`）还留着，`resume()` 能从这一拍续播 */
  get isPaused(): boolean {
    return this.state === 'paused';
  }

  /**
   * 切到后台的瞬间立刻补排一次。后台标签页里 rAF 完全停摆、`setInterval` 被节流到
   * 1 秒以上（挂久了节流到 1 分钟），0.5 秒的前瞻窗口跟不上，就会出现一段段静音，
   * 听感就是卡顿 / 爆音——所以后台状态下 horizon 放开成无限，一次排完剩余整段。
   */
  private onVisibility = (): void => {
    if (this.state === 'playing') this.pump();
  };

  /**
   * 换音色。前瞻调度下这个改动对「未来 0.5 秒之后」的音立刻生效
   * （旧版一次排完整首，播放中换音色要等下一次播放才起作用）。
   */
  setInstrument(inst: InstrumentPreset): void {
    this.instrument = inst;
  }

  setLoop(loop: boolean): void {
    this.loop = loop;
  }

  /**
   * 变速。播放中变速要**重新锚定时间轴**：只改 `rate` 的话，已经排好的音按旧速度发声、
   * 逐拍高亮按新速度换算，两条时间轴立刻对不上（高亮瞬间跳一大截，接缝处的音挤在一起）。
   */
  setRate(rate: number): void {
    const next = Math.max(0.25, Math.min(2, rate));
    if (next === this.rate) return;
    if (this.state === 'playing' && this.ctx) {
      const beatPos = (this.ctx.currentTime - this.startAt) / this.secondsPerBeat();
      this.rate = next;
      this.stopVoices();
      this.schedule(beatPos * this.secondsPerBeat());
      return;
    }
    this.rate = next;
  }

  private secondsPerBeat(): number {
    return 60 / Math.max(1, this.tempo) / this.rate;
  }

  private ensureContext(): AudioContext {
    if (!this.ctx) {
      const w = window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
      const Ctor = w.AudioContext ?? w.webkitAudioContext;
      if (!Ctor) throw new Error('当前浏览器不支持 Web Audio');
      // latencyHint: 'interactive' —— 默认的 'balanced' 渲染缓冲更大，起音与逐拍高亮
      // 的偏差更明显，CPU 紧张时更容易攒出一次长回调（渲染量子超时 = 丢帧噼啪）。
      this.ctx = new Ctor({ latencyHint: 'interactive' });
      this.master = this.ctx.createGain();
      this.master.gain.value = MASTER_GAIN;
      // 主输出串一级软限幅（曲线见 softClipCurve）：音与音的尾音是重叠的，几条尾巴一叠加
      // 就会顶过满刻度，直接进 destination 是硬削波，听感就是偶发的「啪」一声。
      // oversample 用 4x：软削波是非线性运算，不超采样会生出高频混叠（沙哑的嘶声）。
      const shaper = this.ctx.createWaveShaper();
      shaper.curve = softClipCurve();
      shaper.oversample = '4x';
      this.master.connect(shaper);
      shaper.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  /**
   * 从 `from` 秒处起排。**前瞻调度**：这里只锚定时间轴并排第一批，后续的音由 `pump()`
   * 在 `LOOKAHEAD_SEC` 窗口内随时间推进逐批创建。一次排完整首曲子会在长谱面上瞬间造出
   * 几千个振荡器 / 滤波器节点，建图的开销尖峰压垮音频线程的渲染预算（丢帧 = 爆音）。
   */
  private schedule(from: number): void {
    const ctx = this.ensureContext();
    if (!this.master) return;
    const spb = this.secondsPerBeat();
    const base = ctx.currentTime + 0.06;
    this.startAt = base - from;
    this.nextIndex = firstSoundingIndex(this.plan, from, spb);
    this.startPump();
    this.pump();
  }

  /** 创建未来窗口内到期的声部，并回收已经响完的声部 */
  private pump = (): void => {
    const ctx = this.ctx;
    if (!ctx || !this.master || this.state !== 'playing') return;
    const spb = this.secondsPerBeat();
    const horizon = ctx.currentTime + (isDocumentHidden() ? Number.POSITIVE_INFINITY : LOOKAHEAD_SEC);

    while (this.nextIndex < this.plan.length) {
      const note = this.plan[this.nextIndex];
      const startSec = this.startAt + note.startBeat * spb;
      if (startSec >= horizon) break;
      if (isPlayableNote(note)) {
        // 起播点落在长音中间时 startSec 在过去：钳到当下。自动化事件时间早于当前时，
        // Web Audio 会把整条斜坡压成「立刻生效」，增益直接跳到峰值 = 一声爆点。
        const when = Math.max(startSec, ctx.currentTime + SCHEDULE_AHEAD_SEC);
        this.voice(note, when, Math.max(MIN_NOTE_SEC, note.beats * spb));
      }
      this.nextIndex += 1;
    }
    this.pruneVoices();
  };

  private startPump(): void {
    this.stopPump();
    this.pumpTimer = setInterval(this.pump, PUMP_INTERVAL_MS);
  }

  private stopPump(): void {
    if (this.pumpTimer !== null) clearInterval(this.pumpTimer);
    this.pumpTimer = null;
  }

  /**
   * 把响完的声部清出列表：包络归零后振荡器已自动停止，留着只会在长谱面（循环模式尤其明显）
   * 里越积越多，让每次淡出遍历变慢、也让淡出漏掉真正在响的声部。
   */
  private pruneVoices(): void {
    const ctx = this.ctx;
    if (!ctx || this.voices.length === 0) return;
    const now = ctx.currentTime;
    this.voices = this.voices.filter((v) => v.endsAt > now);
  }

  private voice(note: PlayNote, when: number, durSec: number): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master) return;

    const cfg = INSTRUMENTS[this.instrument];
    const freq = 440 * Math.pow(2, (note.midi - 69) / 12);
    // 音级不在 1..7 表里（旧工程文件里写成音符的休止）算不出频率：
    // 把 NaN 写进 AudioParam 在 Chrome 里抛异常，整首曲子放不出来。
    if (!Number.isFinite(freq)) return;
    const env = noteEnvelope(cfg, durSec, note.velocity);
    const oscList: OscillatorNode[] = [];

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = cfg.filterFreq;
    filter.Q.value = cfg.filterQ;

    const gain = ctx.createGain();
    // 逐点落笔。Web Audio 要求自动化事件的时间不减，两点重合时没有斜坡，改用定值。
    gain.gain.setValueAtTime(env.points[0].v, when);
    let prevT = when;
    for (const p of env.points.slice(1)) {
      const t = when + p.t;
      if (t > prevT) gain.gain.linearRampToValueAtTime(p.v, t);
      else gain.gain.setValueAtTime(p.v, t);
      prevT = t;
    }

    const addOsc = (type: OscillatorType, f: number, g: number, detune: number): void => {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = f;
      osc.detune.value = detune;
      const oscGain = ctx.createGain();
      oscGain.gain.value = g;
      osc.connect(oscGain);
      oscGain.connect(filter);
      osc.start(when);
      osc.stop(when + env.end + 0.1);
      oscList.push(osc);
    };

    for (let i = 0; i < cfg.oscCount; i += 1) {
      const spread = i === 0 ? 0 : cfg.detune * (i % 2 === 0 ? -1 : 1) * Math.ceil(i / 2);
      addOsc(cfg.oscType, freq, 0.7 / cfg.oscCount, spread);
    }

    if (cfg.body.oscType2 && cfg.body.gain2) {
      addOsc(cfg.body.oscType2, freq, cfg.body.gain2, cfg.body.detune2 ?? 0);
    }

    if (cfg.body.harmonic && cfg.body.harmonicGain) {
      addOsc('sine', freq * cfg.body.harmonic, cfg.body.harmonicGain, 2);
    }

    if (cfg.subGain > 0) {
      const subFreq = freq * Math.pow(2, cfg.subOctave);
      addOsc('sine', subFreq, cfg.subGain, 1);
    }

    filter.connect(gain);
    gain.connect(master);
    // endsAt = 包络归零的时刻：之后这个声部不发声了，交给 pruneVoices 回收
    this.voices.push({ oscs: oscList, gain, filter, endsAt: when + env.end });
  }

  /**
   * 从 `startEventId` 那个记号起播；传 `null` / 不传 = 从全曲开头播
   * （`ScoreStore.playStartEventId()` 在谱面没有任何记号时给的就是 null）。
   */
  play(score: Score, startEventId?: string | null): void {
    this.stopVoices();
    this.stopPump();
    this.tempo = score.meta.tempo;
    this.plan = buildPlaybackPlan(score);
    this.totalBeats = this.plan.reduce((acc, n) => Math.max(acc, n.startBeat + n.beats), 0);
    if (this.plan.length === 0) {
      this.state = 'stopped';
      this.onEnd?.();
      return;
    }

    let from = 0;
    if (startEventId) {
      const idx = this.plan.findIndex((n) => n.eventId === startEventId);
      if (idx >= 0) {
        from = this.plan[idx].startBeat * this.secondsPerBeat();
      } else {
        const beatPos = findEventBeat(score, startEventId);
        if (beatPos >= 0) from = beatPos * this.secondsPerBeat();
      }
    }

    // 先置 playing：schedule() 会立刻排第一批，pump() 在非 playing 状态下直接返回
    this.state = 'playing';
    this.schedule(from);
    this.tick();
  }

  private tick = (): void => {
    if (this.state !== 'playing' || !this.ctx) return;
    const spb = this.secondsPerBeat();
    const elapsed = this.ctx.currentTime - this.startAt;
    const totalSec = this.totalBeats * spb;

    const index = findPlanIndexAtBeat(this.plan, elapsed / spb);
    this.onNote?.(index >= 0 ? this.plan[index] : null, index);

    if (elapsed >= totalSec) {
      if (this.loop) {
        this.schedule(0);
      } else {
        this.stop();
        this.onEnd?.();
        return;
      }
    }
    this.raf = requestAnimationFrame(this.tick);
  };

  /**
   * 暂停：淡出消音，**保留断点**（`pauseBeat`），之后 `resume()` 从这一拍续播。
   * 断点存「拍」不存「秒」——暂停期间改速度 / 倍速，续播的拍位才不会跳。
   */
  pause(): void {
    if (this.state !== 'playing' || !this.ctx) return;
    this.pauseBeat = (this.ctx.currentTime - this.startAt) / this.secondsPerBeat();
    this.state = 'paused';
    this.stopPump();
    this.stopVoices();
    this.cancelRaf();
    this.onNote?.(null, -1);
  }

  /** 从断点续播；不在暂停态时退化成从头播放 */
  resume(score: Score): void {
    if (this.state !== 'paused') {
      this.play(score);
      return;
    }
    this.tempo = score.meta.tempo;
    this.state = 'playing';
    this.schedule(this.pauseBeat * this.secondsPerBeat());
    this.tick();
  }

  /**
   * 放弃暂停断点：状态回到 `stopped`，界面上的「继续」按钮因此变回「播放」。
   *
   * 暂停期间用户移动了高亮（点了别的记号）时调用——断点留着的话，下一次点击会从
   * **旧断点**续播，新高亮的记号被完全无视：按钮写着「继续」，播出来的却不是那里。
   * 只在暂停态生效：**播放中调用不能把正在响的声音停了**。
   * 不动音频——`pause()` 已经把声部淡出停干净了，这里没有需要淡出的东西。
   */
  cancelResume(): void {
    if (this.state !== 'paused') return;
    this.pauseBeat = 0;
    this.state = 'stopped';
  }

  /**
   * 淡出并停掉所有声部。
   *
   * **不能直接 `osc.stop()`**：振荡器会停在一个非零采样上（方波还带着直流分量），
   * 波形出现阶跃，听感就是一声「咔哒」——暂停 / 停止 / 重播 / 变速 / 循环接缝处必现。
   * 正确做法：先把增益从**当前电平**线性拉到 0（`FADE_OUT_SEC` 短到听不出是淡出，
   * 又足够长到不产生可闻的频谱失真），让振荡器在淡出之后才停，最后断开节点交给 GC。
   */
  private stopVoices(fadeSec = FADE_OUT_SEC): void {
    const ctx = this.ctx;
    const voices = this.voices;
    this.voices = [];
    if (!ctx || voices.length === 0) return;
    const now = ctx.currentTime;
    const fade = Math.max(0.005, fadeSec);

    for (const v of voices) {
      const g = v.gain.gain;
      try {
        // cancelScheduledValues 抹掉后面还没发生的包络，先停在当前电平上，再从这一电平拉下去
        g.cancelScheduledValues(now);
        g.setValueAtTime(g.value, now);
        g.linearRampToValueAtTime(0, now + fade);
      } catch {
        /* 节点已断开 */
      }
      for (const osc of v.oscs) {
        try {
          osc.stop(now + fade + 0.01);
        } catch {
          /* 已经停止 */
        }
      }
      this.retire(v, now + fade + 0.05);
    }
  }

  /** 淡出结束后断开节点：此时振荡器已停，整条链可以回收了 */
  private retire(v: Voice, at: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const delay = Math.max(0, (at - ctx.currentTime) * 1000);
    setTimeout(() => {
      for (const osc of v.oscs) {
        try {
          osc.disconnect();
        } catch {
          /* 已断开 */
        }
      }
      v.gain.disconnect();
      v.filter.disconnect();
    }, delay);
  }

  private cancelRaf(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  stop(): void {
    this.state = 'stopped';
    this.stopPump();
    this.stopVoices();
    this.cancelRaf();
    this.pauseBeat = 0;
    this.onNote?.(null, -1);
  }
}