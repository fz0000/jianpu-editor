// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FADE_OUT_SEC, MASTER_GAIN, Player, SOFT_CLIP_POINTS, softClipCurve } from '../src/audio/player';
import { makeBar, makeDash, makeNote, makeScore, type Degree, type Score } from '../src/core/model';

// ---------- 假 Web Audio：记录每一次自动化与 start/stop，用来验「有没有硬切断」 ----------

type Ev = { kind: 'set' | 'ramp' | 'cancel'; v: number; t: number };

class FakeParam {
  value = 0;
  events: Ev[] = [];

  setValueAtTime(v: number, t: number): this {
    this.events.push({ kind: 'set', v, t });
    this.value = v;
    return this;
  }

  linearRampToValueAtTime(v: number, t: number): this {
    this.events.push({ kind: 'ramp', v, t });
    return this;
  }

  cancelScheduledValues(t: number): this {
    this.events = this.events.filter((e) => e.t < t);
    this.events.push({ kind: 'cancel', v: Number.NaN, t });
    return this;
  }
}

class FakeNode {
  out: FakeNode[] = [];
  disconnected = false;

  connect(dest: FakeNode): void {
    this.out.push(dest);
  }

  disconnect(): void {
    this.disconnected = true;
    this.out = [];
  }
}

class FakeOsc extends FakeNode {
  type = 'sine';
  frequency = new FakeParam();
  detune = new FakeParam();
  startT = -1;
  stopT = -1;

  start(t: number): void {
    this.startT = t;
  }

  stop(t: number): void {
    this.stopT = t;
  }
}

class FakeGain extends FakeNode {
  gain = new FakeParam();
}

class FakeFilter extends FakeNode {
  type = 'lowpass';
  frequency = new FakeParam();
  Q = new FakeParam();
}

class FakeShaper extends FakeNode {
  curve: Float32Array | null = null;
  oversample = 'none';
}

class FakeCtx {
  currentTime = 1.5;
  state: 'running' | 'suspended' = 'running';
  destination = new FakeNode();
  oscs: FakeOsc[] = [];
  gains: FakeGain[] = [];
  shapers: FakeShaper[] = [];

  createGain(): FakeGain {
    const g = new FakeGain();
    this.gains.push(g);
    return g;
  }

  createOscillator(): FakeOsc {
    const o = new FakeOsc();
    this.oscs.push(o);
    return o;
  }

  createBiquadFilter(): FakeFilter {
    return new FakeFilter();
  }

  createWaveShaper(): FakeShaper {
    const s = new FakeShaper();
    this.shapers.push(s);
    return s;
  }

  resume(): Promise<void> {
    this.state = 'running';
    return Promise.resolve();
  }
}

let ctx: FakeCtx;
let ctorOpts: unknown[];

function score(bars: ReturnType<typeof makeBar>[]): Score {
  return makeScore({ tonic: { letter: 'C', accidental: 'natural' }, tempo: 100 }, bars);
}

/** 推进假时钟：小步推进，让调度泵与 tick 按真实顺序交错（一次跳完会打乱调度次序） */
function advance(seconds: number): void {
  const step = 0.02;
  for (let left = seconds; left > 1e-9; left -= step) {
    const dt = Math.min(step, left);
    ctx.currentTime += dt;
    vi.advanceTimersByTime(Math.round(dt * 1000));
  }
}

/**
 * 停止后的保证：**没有任何振荡器还排在「当下 + 0.1 秒」之后发声**。
 * 响完的声部在包络归零后 0.1 秒自然停（那时增益已经是 0，听不见），
 * 在响的声部必须被 stopVoices 接管、停在淡出结束点上——
 * 停在淡出之后 = 停不干净（循环时越积越多），停在淡出之前 = 硬切断（咔哒）。
 */
function assertSilenced(now: number): void {
  for (const osc of ctx.oscs) expect(osc.stopT).toBeLessThanOrEqual(now + 0.1);
  const maxStop = Math.max(...ctx.oscs.map((o) => o.stopT));
  expect(maxStop).toBeGreaterThanOrEqual(now + FADE_OUT_SEC);
}

/** 第一个声部的包络增益（gains[0] 是主输出） */
function voiceGain(): FakeGain {
  return ctx.gains[1];
}

const EIGHT_QUARTERS = [1, 2, 3, 4, 5, 6, 7, 5].map((d) => makeNote(d as Degree, 4));

beforeEach(() => {
  ctx = new FakeCtx();
  ctorOpts = [];
  const Ctor = function (opts?: unknown): FakeCtx {
    ctorOpts.push(opts);
    return ctx;
  };
  (window as unknown as { AudioContext: unknown }).AudioContext = Ctor;
  vi.useFakeTimers();
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  (window as unknown as { AudioContext: unknown }).AudioContext = undefined;
});

describe('输出链接线：主输出串软限幅，不直接进 destination', () => {
  it('master → WaveShaper → destination，曲线是 softClipCurve 且 4x 过采样', () => {
    const player = new Player();
    player.play(score([makeBar([makeNote(1, 4)])]));

    expect(ctx.shapers.length).toBe(1);
    const shaper = ctx.shapers[0];
    const master = ctx.gains[0];
    expect(master.gain.value).toBeCloseTo(MASTER_GAIN);
    expect(master.out).toContain(shaper);
    expect(shaper.out).toContain(ctx.destination);
    expect(shaper.oversample).toBe('4x');
    expect(shaper.curve?.length).toBe(SOFT_CLIP_POINTS);
    expect(Array.from(shaper.curve ?? [])).toEqual(Array.from(softClipCurve()));
    player.stop();
  });

  it('AudioContext 用 interactive 延迟（默认 balanced 的缓冲更大，起音与高亮偏差更明显）', () => {
    const player = new Player();
    player.play(score([makeBar([makeNote(1, 4)])]));

    expect(ctorOpts[0]).toEqual({ latencyHint: 'interactive' });
    player.stop();
  });
});

describe('前瞻调度：不要一次排完整首曲子', () => {
  // 8 个四分音符 @♩100 = 每 0.6 秒一个，全曲 4.8 秒；钢琴每音 5 个振荡器 → 全排完 40 个
  const bars = [makeBar(EIGHT_QUARTERS)];

  it('起播时只创建前瞻窗口内的声部，随时间推进逐批补齐', () => {
    const player = new Player();
    player.play(score(bars));

    const first = ctx.oscs.length;
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThan(40); // 一次排完 40 个就是老写法（长谱面上瞬间几千个节点）

    advance(1.2);
    expect(ctx.oscs.length).toBeGreaterThan(first);
    expect(ctx.oscs.length).toBeLessThan(40);

    advance(4.2);
    expect(ctx.oscs.length).toBe(40); // 整首曲子最终都排上了，一个音都不漏
    player.stop();
  });

  it('每个音的起音时刻都落在当下之后（自动化不会塌成「立刻生效」= 增益直接跳到峰值）', () => {
    const player = new Player();
    player.play(score(bars));
    advance(4.2);

    for (const osc of ctx.oscs) expect(osc.startT).toBeGreaterThan(1.5);
    player.stop();
  });

  it('degree 0（旧文件里写成音符的休止）不建任何节点，NaN 不进 AudioParam', () => {
    const player = new Player();
    player.play(score([makeBar([makeNote(0 as unknown as Degree, 4), makeNote(1, 4)])]));
    advance(2);

    expect(ctx.oscs.length).toBe(5); // 只有第二个音建了声部
    for (const osc of ctx.oscs) expect(Number.isFinite(osc.frequency.value)).toBe(true);
    player.stop();
  });
});

describe('停止 / 暂停：先淡出再停，不在波形非零处切断', () => {
  it('增益先停在当前电平上，再线性拉到 0；振荡器在淡出之后才停', () => {
    const player = new Player();
    player.play(score([makeBar([makeNote(1, 2)])]));
    const g = voiceGain();
    g.gain.value = 0.2; // 模拟「正在响」的电平（真机上读的是自动化算出的当前值）
    const now = ctx.currentTime;

    player.stop();

    const evs = g.gain.events;
    const cancel = evs.findIndex((e) => e.kind === 'cancel');
    const set = evs.findIndex((e) => e.kind === 'set' && e.v === 0.2);
    const ramp = evs.findIndex((e) => e.kind === 'ramp' && e.v === 0);
    expect(cancel).toBeGreaterThanOrEqual(0);
    expect(set).toBeGreaterThan(cancel); // 先抹掉后面的包络，再停在当前电平上
    expect(ramp).toBeGreaterThan(set);
    expect(evs[set].t).toBeCloseTo(now, 6);
    expect(evs[ramp].t).toBeCloseTo(now + FADE_OUT_SEC, 6);

    for (const osc of ctx.oscs) expect(osc.stopT).toBeGreaterThanOrEqual(now + FADE_OUT_SEC);
  });

  it('淡出期间不断开节点（断开 = 立刻静音 = 咔哒），淡出完才回收', () => {
    const player = new Player();
    player.play(score([makeBar([makeNote(1, 2)])]));
    const g = voiceGain();

    player.stop();
    expect(g.disconnected).toBe(false);
    for (const osc of ctx.oscs) expect(osc.disconnected).toBe(false);

    advance(0.2);
    expect(g.disconnected).toBe(true);
    for (const osc of ctx.oscs) expect(osc.disconnected).toBe(true);
  });

  it('暂停也走淡出，恢复时从断点继续', () => {
    const s = score([makeBar([makeNote(1, 4), makeNote(2, 4), makeNote(3, 4), makeNote(4, 4)])]);
    const player = new Player();
    player.play(s);
    advance(1.2);
    const now = ctx.currentTime;

    player.pause();
    assertSilenced(now);
    expect(player.isPlaying).toBe(false);
    expect(player.isPaused).toBe(true);

    player.resume(s);
    expect(player.isPlaying).toBe(true);
    player.stop();
  });
});

describe('继续播放：断点存「拍」不存「秒」', () => {
  // 8 个四分音符 @♩100 = 每拍 0.6 秒；钢琴每音 5 个振荡器，整首排完 40 个
  const eightQuarters = () => score([makeBar(EIGHT_QUARTERS)]);

  it('resume 只排断点之后的音（从头重排会多排一个已经过去的音）', () => {
    const player = new Player();
    player.play(eightQuarters());
    advance(1.2); // 放过约 2 拍
    player.pause();

    const before = ctx.oscs.length;
    player.resume(eightQuarters());
    advance(4.2); // 让剩下的音全部排上

    // 断点在第 2 拍 → 第 3 个音起共 7 个音 = 35 个振荡器；从头重排会是 8 个音 = 40 个
    expect(ctx.oscs.length - before).toBe(35);
    player.stop();
  });

  it('暂停期间改速度：续播的拍位不跳（断点若存秒，改速后位置会漂）', () => {
    const slow = eightQuarters(); // ♩100：每拍 0.6 秒
    const fast = eightQuarters();
    fast.meta.tempo = 200; // 暂停期间把速度翻倍：每拍 0.3 秒

    const player = new Player();
    player.play(slow);
    advance(1.2); // = 2 拍
    player.pause();

    const before = ctx.oscs.length;
    player.resume(fast);
    advance(3);

    // 断点仍是第 2 拍 → 7 个音 = 35 个振荡器。
    // 断点若存成秒（1.14 秒），翻倍速度后变成第 3.8 拍，只会排 5 个音 = 25 个。
    expect(ctx.oscs.length - before).toBe(35);
    player.stop();
  });

  it('停止会清掉断点：之后 resume() 退化成从头播放', () => {
    const player = new Player();
    player.play(eightQuarters());
    advance(1.2);
    player.pause();
    player.stop();
    expect(player.isPaused).toBe(false);

    const before = ctx.oscs.length;
    player.resume(eightQuarters());
    advance(4.2);

    expect(ctx.oscs.length - before).toBe(40); // 整首重排
    player.stop();
  });
});

describe('暂停期间移动高亮：断点作废（「继续」打回「播放」）', () => {
  const eightQuarters = () => score([makeBar(EIGHT_QUARTERS)]);

  it('cancelResume 清掉断点：之后 resume() 退化成整首重排', () => {
    const player = new Player();
    player.play(eightQuarters());
    advance(1.2); // 放过约 2 拍
    player.pause();
    expect(player.isPaused).toBe(true);

    // 暂停期间用户点了别的记号 → main.ts 的 dropResumePointOnCursorMove 调这个
    player.cancelResume();
    expect(player.isPaused).toBe(false);
    expect(player.isPlaying).toBe(false);

    const before = ctx.oscs.length;
    player.resume(eightQuarters());
    advance(4.2);

    // 断点没了 → 从头整首重排 8 个音 = 40 个振荡器（断点还在的话只排 7 个音 = 35 个）
    expect(ctx.oscs.length - before).toBe(40);
    player.stop();
  });

  it('播放中调用 cancelResume 不动声音（只有暂停态才作废断点）', () => {
    const player = new Player();
    player.play(eightQuarters());
    advance(1.2);
    const before = ctx.oscs.length;

    player.cancelResume();
    expect(player.isPlaying).toBe(true);

    advance(3); // 声音继续往后排，没被这一下掐掉
    expect(ctx.oscs.length).toBeGreaterThan(before);
    player.stop();
  });
});

describe('播放起点：从光标（高亮）所在记号起播', () => {
  const eightQuarters = () => score([makeBar(EIGHT_QUARTERS)]);

  it('从第 5 个音起播只排第 5 个音之后的音（从头播会是 8 个音 = 40 个振荡器）', () => {
    const s = eightQuarters();
    const player = new Player();
    player.play(s, s.bars[0].events[4].id);
    advance(4.2); // 让剩下的音全部排上

    // 起点在第 5 拍 → 剩下 4 个音 × 每音 5 个振荡器 = 20
    expect(ctx.oscs.length).toBe(20);
    player.stop();
  });

  it('传 null（全曲没有记号可落）时从全曲开头播', () => {
    const player = new Player();
    player.play(eightQuarters(), null);
    advance(4.2);

    expect(ctx.oscs.length).toBe(40);
    player.stop();
  });

  it('从增时线起播落在它所属的长音上；从下一个音起播则长音不响', () => {
    // 第 1 小节：二分音符（2 拍）+ 增时线（1 拍）+ 四分音符（1 拍）= 4 拍
    const s = score([
      makeBar([makeNote(1, 2), makeDash(), makeNote(2, 4)]),
      makeBar([makeNote(3, 4), makeNote(5, 4)]),
    ]);
    const dash = s.bars[0].events[1];
    const quarter = s.bars[0].events[2];

    // 增时线不是播放计划项：`play()` 用 `findEventBeat` 把它换算成第 2 拍。
    // 第 2 拍上那个二分长音还在响 → 4 个计划项全排 = 20 个振荡器
    const fromDash = new Player();
    let before = ctx.oscs.length;
    fromDash.play(s, dash.id);
    advance(4);
    expect(ctx.oscs.length - before).toBe(20);
    fromDash.stop();

    // 对照组：起点换成紧随其后的四分音符（第 3 拍）→ 长音已经结束，不响 = 3 项 = 15 个
    const fromQuarter = new Player();
    before = ctx.oscs.length;
    fromQuarter.play(s, quarter.id);
    advance(4);
    expect(ctx.oscs.length - before).toBe(15);
    fromQuarter.stop();
  });
});

describe('循环：上一遍的尾音仍被跟踪，接缝处能淡出（不会越积越多顶满刻度）', () => {
  it('循环接缝处所有在响的声部都被淡出，且新一遍继续排音', () => {
    const s = score([makeBar([makeNote(1, 4), makeNote(2, 4)])]); // 2 拍 = 1.2 秒
    const player = new Player();
    player.setLoop(true);
    player.play(s);

    advance(1.5); // 过一遍的结尾 → tick 触发 schedule(0)
    expect(ctx.oscs.length).toBeGreaterThan(5); // 两遍都排上了

    const now = ctx.currentTime;
    player.stop();
    assertSilenced(now);
  });
});
