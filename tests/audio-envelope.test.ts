import { describe, expect, it } from 'vitest';
import {
  FADE_OUT_SEC,
  INSTRUMENTS,
  LOOKAHEAD_SEC,
  MASTER_GAIN,
  MIN_NOTE_SEC,
  PUMP_INTERVAL_MS,
  SCHEDULE_AHEAD_SEC,
  SOFT_CLIP_KNEE,
  SOFT_CLIP_POINTS,
  noteEnvelope,
  sampleEnvelope,
  softClipCurve,
  voiceGainSum,
  voicePeakAmplitude,
} from '../src/audio/player';
import { INSTRUMENT_LABELS, type InstrumentPreset } from '../src/core/model';

const PRESETS = Object.keys(INSTRUMENTS) as InstrumentPreset[];

/**
 * 时值秒数：下限 0.05s（Player 的钳制值）、32 分音符 @♩180（0.083s）、
 * 四分音符 @♩100（0.6s 附近）、全音符 @♩100（2.4s）、全音符 @♩40（9.6s 量级）。
 */
const DURATIONS = [0.05, 0.0833, 0.125, 0.25, 0.5, 1, 2.4, 8];

/** 听得清的最低振幅（约 −30 dBFS）；低于它，长音听起来就像被切断了 */
const AUDIBLE = 0.03;

describe('音色包络：音要响满它记的时值', () => {
  it('七种音色都有包络配置', () => {
    expect([...PRESETS].sort()).toEqual(Object.keys(INSTRUMENT_LABELS).sort());
  });

  for (const preset of PRESETS) {
    describe(INSTRUMENT_LABELS[preset], () => {
      for (const dur of DURATIONS) {
        it(`${dur}s 的音在时值 3/4 与 9/10 处仍在可听电平`, () => {
          const env = noteEnvelope(INSTRUMENTS[preset], dur, 96);

          expect(sampleEnvelope(env, dur * 0.75)).toBeGreaterThanOrEqual(AUDIBLE);
          expect(sampleEnvelope(env, dur * 0.9)).toBeGreaterThanOrEqual(AUDIBLE);
        });
      }

      it('声音不早于时值结束，到点时还剩尾音', () => {
        const dur = 2.4;
        const env = noteEnvelope(INSTRUMENTS[preset], dur, 96);

        expect(env.end).toBeGreaterThanOrEqual(dur);
        expect(sampleEnvelope(env, dur)).toBeGreaterThanOrEqual(env.tail * 0.6);
      });

      it('持续段末尾电平 ≥ 峰值的 25%（旧值钢琴 12% / 吉他 4% / 八音盒 1% 会挂）', () => {
        const env = noteEnvelope(INSTRUMENTS[preset], 4, 96);

        expect(env.tail).toBeGreaterThanOrEqual(env.peak * 0.25);
      });

      it('控制点时间不减，峰值之后只降不升（Web Audio 要求自动化时间不减）', () => {
        const env = noteEnvelope(INSTRUMENTS[preset], 1.5, 96);
        const pts = env.points;

        for (let i = 1; i < pts.length; i += 1) {
          expect(pts[i].t).toBeGreaterThanOrEqual(pts[i - 1].t);
        }
        for (let i = 2; i < pts.length; i += 1) {
          expect(pts[i].v).toBeLessThanOrEqual(pts[i - 1].v);
        }
        expect(pts[pts.length - 1].v).toBe(0);
      });
    });
  }
});

describe('包络的时值换算', () => {
  it('起音与释音都不超过时值的四分之一，衰减落在释音起点之前', () => {
    for (const preset of PRESETS) {
      for (const dur of DURATIONS) {
        const env = noteEnvelope(INSTRUMENTS[preset], dur, 96);

        expect(env.attack).toBeLessThanOrEqual(dur * 0.25 + 1e-9);
        expect(env.release).toBeLessThanOrEqual(dur * 0.25 + 1e-9);
        expect(env.attack + env.decay).toBeLessThanOrEqual(env.sustainEnd + 1e-9);
        expect(env.sustainEnd).toBeLessThanOrEqual(dur + 1e-9);
      }
    }
  });

  it('时值越长，包络越长（释音与静音时刻随时值增长）', () => {
    const cfg = INSTRUMENTS.piano;
    const short = noteEnvelope(cfg, 0.25, 96);
    const long = noteEnvelope(cfg, 4, 96);

    expect(long.end).toBeGreaterThan(short.end);
    expect(long.sustainEnd).toBeGreaterThan(short.sustainEnd);
  });

  it('力度参与峰值：强奏比弱奏响，缺省力度按 96 算', () => {
    const cfg = INSTRUMENTS.piano;

    expect(noteEnvelope(cfg, 1, 120).peak).toBeGreaterThan(noteEnvelope(cfg, 1, 40).peak);
    expect(noteEnvelope(cfg, 1, 0).peak).toBeCloseTo(noteEnvelope(cfg, 1, 96).peak);
  });
});


// ---------- 输出链：爆音的两个来源（硬削波 / 硬切断） ----------

/** 按 WaveShaper 的取点方式（输入 -1..1 均匀映射到数组下标）插值取曲线值 */
function applyCurve(curve: Float32Array, x: number): number {
  const n = curve.length;
  const clamped = Math.max(-1, Math.min(1, x));
  const t = ((clamped + 1) / 2) * (n - 1);
  const i = Math.floor(t);
  const j = Math.min(n - 1, i + 1);
  const k = t - i;
  return curve[i] * (1 - k) + curve[j] * k;
}

describe('软限幅曲线：叠加顶到满刻度时不能硬削波', () => {
  const curve = softClipCurve();
  const dx = 2 / (curve.length - 1);

  it('点数是奇数（过零点落在格点上），全表有限、单调不减、不越界', () => {
    expect(curve.length % 2).toBe(1);
    expect(curve.length).toBe(SOFT_CLIP_POINTS);
    for (let i = 0; i < curve.length; i += 1) {
      expect(Number.isFinite(curve[i])).toBe(true);
      expect(Math.abs(curve[i])).toBeLessThanOrEqual(1);
      if (i > 0) expect(curve[i]).toBeGreaterThanOrEqual(curve[i - 1]);
    }
  });

  it('奇对称且过零点精确为 0（不引入直流偏移 → 不会推扬声器振膜 = 无声响的「噗」）', () => {
    const mid = (curve.length - 1) / 2;
    expect(curve[mid]).toBe(0);
    for (let i = 0; i < mid; i += 1) expect(curve[i]).toBeCloseTo(-curve[curve.length - 1 - i], 6);
  });

  it('拐点以下完全线性：小信号零失真（单音峰值 0.22 一个采样点都不动）', () => {
    for (const x of [-0.55, -0.2, -0.01, 0, 0.01, 0.2, 0.55]) {
      expect(applyCurve(curve, x)).toBeCloseTo(x, 5);
    }
    expect(0.22).toBeLessThan(SOFT_CLIP_KNEE);
  });

  it('曲线斜率有界（拐点处连续，不在拐点本身产生新的失真 / 咔哒）', () => {
    let maxSlope = 0;
    for (let i = 1; i < curve.length; i += 1) maxSlope = Math.max(maxSlope, (curve[i] - curve[i - 1]) / dx);

    expect(maxSlope).toBeLessThanOrEqual(1.02);
  });

  it('满刻度输入被压到 1 以下：多声部尾音叠加不再硬削波', () => {
    expect(applyCurve(curve, 1)).toBeLessThan(1);
    expect(applyCurve(curve, -1)).toBeGreaterThan(-1);
    // 12 个声部同时起音（循环接缝 + 密集连音线）也顶不出满刻度
    for (let n = 1; n <= 12; n += 1) {
      expect(Math.abs(applyCurve(curve, n * 0.22))).toBeLessThan(1);
    }
  });
});

describe('输出电平：留够多音叠加的余量', () => {
  it('主输出增益不超过 1', () => {
    expect(MASTER_GAIN).toBeGreaterThan(0);
    expect(MASTER_GAIN).toBeLessThanOrEqual(1);
  });

  it('单声部峰值远小于 1：音与音的尾音重叠（释音锚在时值结束点）才有地方叠', () => {
    for (const preset of PRESETS) {
      for (const dur of DURATIONS) {
        const amp = voicePeakAmplitude(INSTRUMENTS[preset], dur, 127);

        expect(amp).toBeGreaterThan(0);
        expect(amp).toBeLessThan(0.35);
      }
    }
  });

  it('振荡器增益总和 = 主组 0.7 + 二次音色 / 泛音 / 次低音（与 voice() 的接线一致）', () => {
    expect(voiceGainSum(INSTRUMENTS.flute)).toBeCloseTo(0.7 + 0.08); // body 空，但 subOctave 0 有一路齐次正弦
    expect(voiceGainSum(INSTRUMENTS.piano)).toBeCloseTo(0.7 + 0.22 + 0.18 + 0.15);
    for (const preset of PRESETS) expect(voiceGainSum(INSTRUMENTS[preset])).toBeLessThan(2);
  });

  it('四个声部叠加仍在拐点之上不多（软限幅接手就够，不需要压缩器抬电平）', () => {
    const single = voicePeakAmplitude(INSTRUMENTS.piano, 2.4, 127);

    expect(single * 4).toBeLessThan(1.1);
  });

  it('淡出时长可闻但不成句：5–50 毫秒之间', () => {
    expect(FADE_OUT_SEC).toBeGreaterThanOrEqual(0.005);
    expect(FADE_OUT_SEC).toBeLessThanOrEqual(0.05);
  });

  it('前瞻窗口大于调度泵间隔（否则会出现排不上音的静音间隙）', () => {
    expect(LOOKAHEAD_SEC).toBeGreaterThan((PUMP_INTERVAL_MS / 1000) * 4);
    expect(MIN_NOTE_SEC).toBeGreaterThan(0);
    expect(SCHEDULE_AHEAD_SEC).toBeGreaterThan(0);
    expect(SCHEDULE_AHEAD_SEC).toBeLessThan(LOOKAHEAD_SEC);
  });
});
