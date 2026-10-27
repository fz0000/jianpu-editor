import { describe, expect, it } from 'vitest';
import { layoutScore, scaledSize } from '../src/core/layout';
import {
  DEFAULT_FONT_SIZE,
  FONT_SIZE,
  FONT_SIZE_STEPS,
  MAX_FONT_SIZE,
  MIN_FONT_SIZE,
  fontScaleFor,
  fontSizeLabel,
  snapFontSize,
} from '../src/core/metrics';
import { barBeatLength, defaultMeta, makeBar, makeNote, makeScore, measureBeats } from '../src/core/model';
import { deserializeScore, serializeScore } from '../src/io/json';

/** 每小节四个四分音符的谱子：小节自然宽度规整，便于比较每行小节数 */
function sampleScore(fontSize: number, barCount = 16) {
  const bars = Array.from({ length: barCount }, () =>
    makeBar([makeNote(1, 4), makeNote(2, 4), makeNote(3, 4), makeNote(4, 4)]),
  );
  return makeScore({ title: '字号测试', timeSig: { num: 4, den: 4 }, showLyrics: false, fontSize }, bars);
}

const perLineOf = (layout: ReturnType<typeof layoutScore>) => layout.systems[0].barSlots.length;

describe('谱面字号：档位表与换算', () => {
  it('标准字号就是排版用的 FONT_SIZE，系数为 1', () => {
    expect(defaultMeta().fontSize).toBe(DEFAULT_FONT_SIZE);
    expect(DEFAULT_FONT_SIZE).toBe(FONT_SIZE);
    expect(fontScaleFor(DEFAULT_FONT_SIZE)).toBe(1);
  });

  it('档位表覆盖到端点，端点常量取自档位表', () => {
    expect(FONT_SIZE_STEPS[0]).toBe(MIN_FONT_SIZE);
    expect(FONT_SIZE_STEPS[FONT_SIZE_STEPS.length - 1]).toBe(MAX_FONT_SIZE);
    expect(FONT_SIZE_STEPS).toContain(DEFAULT_FONT_SIZE);
  });

  it('snapFontSize 吸附到最近档位，越界值收到端点', () => {
    expect(snapFontSize(29)).toBe(30);
    expect(snapFontSize(31)).toBe(30);
    // 正中间的值取较小档位（36 在 34 / 38 之间）
    expect(snapFontSize(36)).toBe(34);
    expect(snapFontSize(37)).toBe(38);
    expect(snapFontSize(999)).toBe(MAX_FONT_SIZE);
    expect(snapFontSize(0)).toBe(MIN_FONT_SIZE);
    expect(snapFontSize(Number.NaN)).toBe(DEFAULT_FONT_SIZE);
  });

  it('字号系数 = 字号 / 标准字号（非档位值先吸附）', () => {
    expect(fontScaleFor(48)).toBeCloseTo(48 / FONT_SIZE, 10);
    expect(fontScaleFor(18)).toBeCloseTo(18 / FONT_SIZE, 10);
    expect(fontScaleFor(100)).toBeCloseTo(MAX_FONT_SIZE / FONT_SIZE, 10);
  });

  it('每个档位都有中文名', () => {
    for (const step of FONT_SIZE_STEPS) {
      expect(fontSizeLabel(step)).toBeTruthy();
      expect(fontSizeLabel(step)).not.toBe(String(step));
    }
  });
});

describe('谱面字号：排版层按字号重排每行小节数', () => {
  const containerWidth = 900;

  it('排版尺寸是标准字号下的用户单位，scale 随字号变化', () => {
    expect(layoutScore(sampleScore(22), containerWidth).scale).toBeCloseTo(22 / FONT_SIZE, 10);
    expect(layoutScore(sampleScore(44), containerWidth).scale).toBeCloseTo(44 / FONT_SIZE, 10);
  });

  it('字号越大，每行小节数越少（行数随之增多）', () => {
    const small = layoutScore(sampleScore(22), containerWidth);
    const large = layoutScore(sampleScore(44), containerWidth);
    expect(perLineOf(large)).toBeLessThan(perLineOf(small));
    expect(large.systems.length).toBeGreaterThan(small.systems.length);
  });

  it('字号越大，谱面在屏幕上的实际宽度仍不超过容器宽度', () => {
    for (const fontSize of FONT_SIZE_STEPS) {
      const layout = layoutScore(sampleScore(fontSize), containerWidth);
      expect(scaledSize(layout).width).toBeLessThanOrEqual(containerWidth + 1);
    }
  });

  it('scaledSize = 排版尺寸 × 字号系数；标准字号下 1:1', () => {
    const layout = layoutScore(sampleScore(38), containerWidth);
    expect(scaledSize(layout).width).toBe(Math.round(layout.width * layout.scale));
    expect(scaledSize(layout).height).toBe(Math.round(layout.height * layout.scale));
    const standard = layoutScore(sampleScore(DEFAULT_FONT_SIZE), containerWidth);
    expect(scaledSize(standard).width).toBe(Math.round(standard.width));
  });

  it('换字号不丢小节：所有字号下排版出的小节序列一致，且每小节拍数守恒', () => {
    for (const fontSize of [MIN_FONT_SIZE, DEFAULT_FONT_SIZE, MAX_FONT_SIZE]) {
      const score = sampleScore(fontSize);
      const layout = layoutScore(score, containerWidth);
      const indices = layout.systems.flatMap((s) => s.barSlots.map((b) => b.barIndex));
      expect(indices).toEqual(score.bars.map((_, i) => i));
      const beats = measureBeats(score.meta.timeSig);
      score.bars.forEach((bar) => expect(barBeatLength(bar)).toBe(beats));
    }
  });

  it('用户设定的每行小节数在字号放大后被「装得下」的上限钳制', () => {
    const barsPerLine = 16;
    const score = sampleScore(MAX_FONT_SIZE);
    score.meta.barsPerLine = barsPerLine;
    const layout = layoutScore(score, containerWidth);
    expect(perLineOf(layout)).toBeLessThan(barsPerLine);
  });
});

describe('谱面字号：随 JSON 工程文件保存', () => {
  it('往返保持字号', () => {
    const restored = deserializeScore(serializeScore(sampleScore(38, 2)));
    expect(restored.meta.fontSize).toBe(38);
  });

  it('旧文件没有 fontSize 字段时退回标准字号', () => {
    const legacy = JSON.stringify({
      version: 1,
      meta: { title: '旧谱', tempo: 90 },
      bars: [{ events: [{ kind: 'note', degree: 1, duration: 4 }] }],
    });
    expect(deserializeScore(legacy).meta.fontSize).toBe(DEFAULT_FONT_SIZE);
  });

  it('越界 / 非法的字号值被吸附到档位表内', () => {
    const of = (fontSize: unknown) =>
      deserializeScore(JSON.stringify({ version: 1, meta: { fontSize }, bars: [] })).meta.fontSize;
    expect(of(999)).toBe(MAX_FONT_SIZE);
    expect(of(3)).toBe(MIN_FONT_SIZE);
    expect(of('36')).toBe(DEFAULT_FONT_SIZE);
    expect(of(null)).toBe(DEFAULT_FONT_SIZE);
  });
});
