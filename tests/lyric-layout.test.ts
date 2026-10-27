import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { layoutScore, type SystemLayout } from '../src/core/layout';
import {
  BARLINE_LYRIC_GAP,
  BARLINE_MIN_BELOW,
  BARLINE_TOP_ABOVE,
  belowStack,
  CAP_HEIGHT,
  FONT_SIZE,
  LYRIC_CLEARANCE,
  LYRIC_FONT_SIZE,
  LYRIC_OFFSET,
  lyricBaseline,
  lyricWidth,
} from '../src/core/metrics';
import { makeBar, makeNote, makeScore, type Degree } from '../src/core/model';

/** 歌词与音符的几何关系：字号比例 + 基线让位 + 行高 + 横向不压字 */

/** 歌词顶边（相对数字中心）：基线是 central，故基线就是字面中心 */
const lyricTop = (offset: number) => offset - LYRIC_FONT_SIZE / 2;

describe('歌词字号：与数字成比例，且不被 CSS 覆盖', () => {
  it('歌词字号是数字字号的 0.55 ~ 0.7 倍（汉字音节读得清，又不抢数字）', () => {
    const ratio = LYRIC_FONT_SIZE / FONT_SIZE;
    expect(ratio).toBeGreaterThanOrEqual(0.55);
    expect(ratio).toBeLessThanOrEqual(0.7);
  });

  it('styles.css 不给谱面字形写 px 字号（CSS 压过呈现属性，字号就不随谱面缩放）', () => {
    const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
    const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const glyphClasses = ['jp-lyric', 'jp-accidental', 'jp-triplet', 'jp-bar-number', 'jp-digit'];
    const re = /([^{}]+)\{([^{}]*)\}/g;
    let rule: RegExpExecArray | null;
    let checked = 0;
    while ((rule = re.exec(stripped)) !== null) {
      const hit = glyphClasses.find((cls) => rule![1].includes(`.${cls}`));
      if (!hit) continue;
      checked += 1;
      expect(rule[2], `.${hit} 的 CSS 规则里出现了 font-size`).not.toMatch(/font-size/);
    }
    expect(checked).toBeGreaterThan(0);
  });
});

describe('lyricBaseline：歌词基线给下划线与低音点让位', () => {
  it('没有下划线 / 低音点时取最小距离 LYRIC_OFFSET', () => {
    expect(lyricBaseline(0, 0)).toBe(LYRIC_OFFSET);
  });

  it('任何下划线 / 低音点组合下，歌词顶边都在堆叠记号之下留出净空', () => {
    for (let u = 0; u <= 3; u += 1) {
      for (let d = 0; d <= 2; d += 1) {
        const stack = belowStack(u, d);
        expect(lyricTop(lyricBaseline(u, d))).toBeGreaterThanOrEqual(stack + LYRIC_CLEARANCE - 1e-9);
      }
    }
  });

  it('下划线越多 / 八度点越低，基线只降不升（单调）', () => {
    for (let u = 0; u <= 3; u += 1) {
      for (let d = 0; d <= 2; d += 1) {
        expect(lyricBaseline(u + 1, d)).toBeGreaterThanOrEqual(lyricBaseline(u, d));
        expect(lyricBaseline(u, d + 1)).toBeGreaterThanOrEqual(lyricBaseline(u, d));
      }
    }
    // 十六分音符 + 两个低音点：明显低于普通四分音符
    expect(lyricBaseline(2, 2)).toBeGreaterThan(lyricBaseline(0, 0) + 5);
  });
});

describe('layoutScore：歌词参与记号盒与行高', () => {
  const meta = { timeSig: { num: 4, den: 4 }, showLyrics: true, showBarNumbers: false };

  it('十六分低音音符的歌词往下让位：整行音节共用一条基线，行高取到歌词底边', () => {
    const score = makeScore(meta, [
      makeBar([
        makeNote(5 as Degree, 16, { octave: -1, lyric: '字' }),
        // 没有歌词的低音十六分音符：它的八度点也必须落在歌词行之上（否则压字）
        makeNote(6 as Degree, 16, { octave: -1 }),
        makeNote(1 as Degree, 4, { lyric: '个' }),
        makeNote(2 as Degree, 4, { lyric: '瞬' }),
      ]),
    ]);
    const layout = layoutScore(score, 900);
    const system = layout.systems[0];
    const low = system.blocks.find((b) => b.lyric === '字');
    const plain = system.blocks.find((b) => b.lyric === '个');
    const bare = system.blocks.find((b) => !b.lyric && b.dotsBelow > 0);
    expect(low).toBeTruthy();
    expect(plain).toBeTruthy();
    expect(bare).toBeTruthy();

    // 下划线 2 根 + 低音八度点 1 个堆叠的底边（相对数字中心）
    const stack = belowStack(2, 1);
    expect(low!.lyricOffset).toBe(lyricBaseline(2, 1));
    expect(lyricTop(low!.lyricOffset)).toBeGreaterThanOrEqual(stack + LYRIC_CLEARANCE - 1e-9);
    // 同一行所有音节共用一条基线（歌词成行，不阶梯）
    expect(plain!.lyricOffset).toBe(low!.lyricOffset);
    // 没有歌词的邻居记号：堆叠整体在歌词顶边之上
    expect(lyricTop(low!.lyricOffset)).toBeGreaterThanOrEqual(
      belowStack(bare!.underlines, bare!.dotsBelow) + LYRIC_CLEARANCE - 1e-9,
    );
    // 行高容得下歌词底边
    expect(low!.bottomExtent).toBeGreaterThanOrEqual(
      CAP_HEIGHT / 2 + low!.lyricOffset + LYRIC_FONT_SIZE / 2 - 1e-9,
    );
    expect(system.bottomPad).toBeGreaterThanOrEqual(low!.bottomExtent);
  });

  it('歌词越宽记号盒越宽：相邻音节中心相距至少两个音节半宽之和', () => {
    const words = ['chóng', '中', '国', '人', '民', '一', '切', '都'];
    const bars = Array.from({ length: 6 }, (_, bi) =>
      makeBar(
        Array.from({ length: 8 }, (_, i) =>
          makeNote((((bi * 8 + i) % 7) + 1) as Degree, 16, {
            lyric: words[(bi * 8 + i) % words.length],
          }),
        ),
      ),
    );
    const layout = layoutScore(makeScore(meta, bars), 900);
    for (const system of layout.systems) {
      for (let i = 1; i < system.blocks.length; i += 1) {
        const a = system.blocks[i - 1];
        const b = system.blocks[i];
        if (a.barIndex !== b.barIndex) continue;
        if (!a.lyric || !b.lyric) continue;
        const gap = b.cx - a.cx - (lyricWidth(a.lyric) + lyricWidth(b.lyric)) / 2;
        expect(gap).toBeGreaterThanOrEqual(-1e-6);
      }
    }
  });

  it('关闭「显示歌词」时不占行高、不占列宽', () => {
    const bars = [
      makeBar([
        makeNote(5 as Degree, 16, { octave: -1, lyric: '字' }),
        makeNote(6 as Degree, 4, { lyric: '一' }),
      ]),
    ];
    const on = layoutScore(makeScore(meta, bars), 900);
    const off = layoutScore(makeScore({ ...meta, showLyrics: false }, bars), 900);
    expect(on.systems[0].blocks[0].lyricOffset).toBeGreaterThan(0);
    expect(off.systems[0].blocks[0].lyricOffset).toBe(0);
    expect(off.systems[0].height).toBeLessThan(on.systems[0].height);
  });
});

/** 歌词顶边在 system 坐标里的 y（lyricOffset 相对数字底边，数字中心在 system.centerY） */
function lyricSystemY(system: SystemLayout, offset: number): number {
  return system.centerY + CAP_HEIGHT / 2 + lyricTop(offset);
}

/** 本行最深的「下划线 + 低音八度点」堆叠底边（相对数字中心） */
function noteDepth(system: SystemLayout): number {
  return Math.max(
    CAP_HEIGHT / 2,
    ...system.blocks.map((b) => CAP_HEIGHT / 2 + belowStack(b.underlines, b.dotsBelow)),
  );
}

describe('小节线长度：只覆盖音符区，不伸进歌词带', () => {
  const meta = { timeSig: { num: 4, den: 4 }, showLyrics: true, showBarNumbers: true };
  const words = ['闪', '亮', '晶', '晶', '的', '星', '光', '在'];
  const bars = Array.from({ length: 8 }, (_, bi) =>
    makeBar(
      Array.from({ length: 16 }, (_, i) =>
        makeNote((((bi * 16 + i) % 7) + 1) as Degree, 16, {
          octave: i % 4 === 0 ? -1 : 0,
          lyric: words[(bi * 16 + i) % words.length],
        }),
      ),
    ),
  );
  const layout = layoutScore(makeScore(meta, bars), 900);
  const systems = layout.systems.filter((s) => s.barlines.length > 0);

  it('谱面上有小节线（回归前提）', () => {
    expect(systems.length).toBeGreaterThan(0);
  });

  it('小节线底端止于歌词顶边之上：竖线不穿过汉字', () => {
    for (const system of systems) {
      const lyric = system.blocks.filter((b) => b.lyric);
      if (lyric.length === 0) continue;
      const line = Math.max(...lyric.map((b) => b.lyricOffset));
      for (const bl of system.barlines) {
        expect(bl.bottom).toBeLessThanOrEqual(lyricSystemY(system, line) - BARLINE_LYRIC_GAP + 1e-9);
      }
    }
  });

  it('小节线覆盖数字顶边与本行最深的下划线 / 低音八度点', () => {
    for (const system of systems) {
      const depth = noteDepth(system);
      for (const bl of system.barlines) {
        expect(bl.top).toBeLessThanOrEqual(system.centerY - CAP_HEIGHT / 2 + 1e-9);
        expect(bl.bottom).toBeGreaterThanOrEqual(system.centerY + depth - 1e-9);
      }
    }
  });

  it('同一行小节线等长（竖向齐平），落在行内且明显短于整行', () => {
    for (const system of systems) {
      expect(new Set(system.barlines.map((bl) => bl.bottom)).size).toBe(1);
      const bl = system.barlines[0];
      expect(bl.top).toBeGreaterThan(0);
      expect(bl.bottom).toBeLessThanOrEqual(system.height);
      expect(bl.bottom - bl.top).toBeGreaterThan(CAP_HEIGHT);
      // 旧版是 8 → height-8 的整行竖线；现在行顶留白与歌词带都在线外
      expect(system.height - (bl.bottom - bl.top)).toBeGreaterThanOrEqual(14);
    }
  });

  it('没有歌词的行同样只覆盖音符区（底端不贴到行底）', () => {
    const plainBars = [
      makeBar([makeNote(1 as Degree, 4), makeNote(2 as Degree, 4), makeNote(3 as Degree, 2)]),
      makeBar([makeNote(5 as Degree, 4), makeNote(6 as Degree, 4), makeNote(7 as Degree, 2)]),
    ];
    const plain = layoutScore(makeScore({ ...meta, showLyrics: false }, plainBars), 900);
    const system = plain.systems[0];
    expect(system.barlines.length).toBeGreaterThan(0);
    const bl = system.barlines[0];
    expect(bl.bottom).toBeCloseTo(system.centerY + BARLINE_MIN_BELOW, 6);
    expect(bl.top).toBeCloseTo(system.centerY - CAP_HEIGHT / 2 - BARLINE_TOP_ABOVE, 6);
    expect(bl.bottom).toBeLessThanOrEqual(system.height);
  });
});
