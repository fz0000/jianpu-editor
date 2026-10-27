import { describe, expect, it } from 'vitest';
import { layoutScore, type SystemLayout } from '../src/core/layout';
import {
  ACCIDENTAL_W,
  DASH_W,
  DIGIT_W,
  DOT_R,
  DOTTED_DOT_DX,
  lyricWidth,
} from '../src/core/metrics';
import {
  makeBar,
  makeNote,
  makeRest,
  makeScore,
  type Bar,
  type Degree,
  type Meta,
} from '../src/core/model';

/**
 * 列宽模型回归：列宽由「相邻记号墨迹不相撞」给出，而不是「每个记号都要撑满自己那格」。
 * 短音符（32 分 / 16 分）只占 1/8、1/4 拍份，按时值摊算会把全曲列宽撑到 4–8 倍；
 * 现在它们只要与邻居的墨迹不撞即可，稀疏小节也不再被整小节撑宽。
 * 见 layout.ts 的 columnMins / centerGap / isStrictBox。
 */

const meta: Partial<Meta> = {
  timeSig: { num: 4, den: 4 },
  showLyrics: true,
  showBarNumbers: false,
  barsPerLine: 0,
  fontSize: 30,
};

/** 重复同一小节 n 遍：让「每行尽可能多的小节」由自然宽度决定，而不是小节总数 */
function rep(bar: Bar, n = 24): Bar[] {
  return Array.from({ length: n }, () => bar);
}

/**
 * 一行里相邻记号的**最小墨迹余量**：中心距 - 两侧墨迹所需中心距。
 * 记号墨迹相对数字中心：左半边 = max(升降号 + 半个数字, 半个音节)，
 * 右半边 = max(半个数字, 半个音节) + 附点（真写出附点时才算）。延长线记号取 DASH_W 半宽。
 * 跨小节的相邻记号也查（小节线两侧的留白同样要够）。
 */
function minInkClearance(systems: SystemLayout[]): number {
  let worst = Infinity;
  for (const system of systems) {
    const marks = system.blocks.map((b) => {
      const lw = b.lyric ? lyricWidth(b.lyric) : 0;
      const acc = b.kind === 'note' && b.accidental !== 'natural' ? ACCIDENTAL_W : 0;
      if (b.kind === 'dash') return { cx: b.cx, left: DASH_W / 2, right: DASH_W / 2 };
      return {
        cx: b.cx,
        left: Math.max(acc + DIGIT_W / 2, lw / 2),
        right: Math.max(DIGIT_W / 2, lw / 2) + (b.dotted ? DOTTED_DOT_DX + DOT_R : 0),
      };
    });
    for (let i = 0; i + 1 < marks.length; i += 1) {
      worst = Math.min(
        worst,
        marks[i + 1].cx - marks[i].cx - (marks[i].right + marks[i + 1].left),
      );
    }
  }
  return worst;
}

/** 同一行里相邻记号的最小中心距 */
function minCenterGap(systems: SystemLayout[]): number {
  let worst = Infinity;
  for (const system of systems) {
    for (let i = 0; i + 1 < system.blocks.length; i += 1) {
      worst = Math.min(worst, system.blocks[i + 1].cx - system.blocks[i].cx);
    }
  }
  return worst;
}

describe('短时值音符的列宽（墨迹相撞模型）', () => {
  it('整小节 32 分音符：不撑宽全曲列宽，每行装得下更多小节', () => {
    const bar = makeBar(Array.from({ length: 8 }, () => makeNote(1 as Degree, 32)));
    const layout = layoutScore(makeScore(meta, rep(bar)), 1200);
    const first = layout.systems[0];

    // 旧模型：32 分音符占 1/8 拍份 → 列宽下限 = DIGIT_W / 0.125 = 112，四列 → 小节自然宽 456
    // → 1200px 容器每行只 2 小节。新模型：8 个 32 分音符只需各占一个数字宽（+留白）。
    expect(first.barSlots.length).toBeGreaterThanOrEqual(8);
    // 记号自身仍装得下：盒宽 >= 数字宽，相邻数字中心距 >= 一个数字宽
    for (const b of first.blocks.filter((x) => x.duration === 32)) {
      expect(b.width).toBeGreaterThanOrEqual(DIGIT_W - 1e-6);
    }
    expect(minCenterGap(layout.systems)).toBeGreaterThanOrEqual(DIGIT_W - 1e-6);
    expect(minInkClearance(layout.systems)).toBeGreaterThanOrEqual(0);
  });

  it('32 分音符带歌词：音节宽度决定中心距，音节之间不压字', () => {
    const bar = makeBar(Array.from({ length: 8 }, () => makeNote(1 as Degree, 32, { lyric: '啦' })));
    const layout = layoutScore(makeScore(meta, rep(bar)), 1200);
    const syllable = lyricWidth('啦');
    const blocks = layout.systems[0].blocks;
    for (let i = 0; i + 1 < blocks.length; i += 1) {
      expect(blocks[i + 1].cx - blocks[i].cx).toBeGreaterThanOrEqual(syllable - 1e-6);
    }
    expect(minInkClearance(layout.systems)).toBeGreaterThanOrEqual(0);
  });

  it('右邻带升降号：为升降号的墨迹腾出位置（回归：升降号压在左邻数字上）', () => {
    // 十六分音符对：前一个无升降号、后一个带升号。升号写在数字**左侧**，相对数字中心
    // 往左 ACCIDENTAL_W，故中心距下限 = 半个数字 +（升降号 + 半个数字）。
    const bar = makeBar([
      makeNote(1 as Degree, 16),
      makeNote(2 as Degree, 16, { accidental: 'sharp' }),
      makeNote(3 as Degree, 4),
      makeNote(4 as Degree, 4),
    ]);
    const layout = layoutScore(makeScore(meta, rep(bar)), 1200);
    const need = DIGIT_W / 2 + (ACCIDENTAL_W + DIGIT_W / 2);
    for (const system of layout.systems) {
      const b = system.blocks;
      const i = b.findIndex((x) => x.accidental === 'sharp');
      expect(b[i].cx - b[i - 1].cx).toBeGreaterThanOrEqual(need - 1e-6);
    }
    expect(minInkClearance(layout.systems)).toBeGreaterThanOrEqual(0);
  });

  it('升降号 + 汉字歌词的十六分音符：按墨迹摊算列宽，不与后面的休止符相撞', () => {
    // 真实样本 x.json 里的形状：带升号、带音节的十六分音符紧跟十六分休止符
    const bar = makeBar([
      makeNote(5 as Degree, 16, { accidental: 'sharp', lyric: '踏' }),
      makeRest(16),
      makeNote(1 as Degree, 4),
      makeNote(2 as Degree, 4),
    ]);
    const layout = layoutScore(makeScore(meta, rep(bar)), 1200);
    const first = layout.systems[0];
    const need = lyricWidth('踏') / 2 + DIGIT_W / 2;
    expect(first.blocks[1].cx - first.blocks[0].cx).toBeGreaterThanOrEqual(need - 1e-6);
    expect(minInkClearance(layout.systems)).toBeGreaterThanOrEqual(0);
  });

  it('拉丁长音节：相邻音节宽度之和决定中心距，长音节不压字', () => {
    const bar = makeBar([
      makeNote(1 as Degree, 8, { lyric: 'zhong' }),
      makeNote(2 as Degree, 8, { lyric: 'jian' }),
      makeNote(3 as Degree, 4, { lyric: 'dan' }),
      makeNote(4 as Degree, 4, { lyric: 'zi' }),
    ]);
    const layout = layoutScore(makeScore(meta, rep(bar)), 1200);
    const blocks = layout.systems[0].blocks;
    const need = (lyricWidth('zhong') + lyricWidth('jian')) / 2;
    expect(blocks[1].cx - blocks[0].cx).toBeGreaterThanOrEqual(need - 1e-6);
    expect(minInkClearance(layout.systems)).toBeGreaterThanOrEqual(0);
  });

  it('附点音符：附点墨迹计入右半宽，不与右邻相撞', () => {
    const bar = makeBar([
      makeNote(1 as Degree, 16, { dotted: true }),
      makeNote(2 as Degree, 16),
      makeNote(3 as Degree, 4),
      makeNote(4 as Degree, 4),
    ]);
    const layout = layoutScore(makeScore(meta, rep(bar)), 1200);
    expect(minInkClearance(layout.systems)).toBeGreaterThanOrEqual(0);
  });

  it('稀疏小节不被撑宽：全音符 / 休止符小节每行排满', () => {
    const bars = [
      ...rep(makeBar([makeNote(1 as Degree, 1)])),
      ...rep(makeBar([makeRest(1)])),
      ...rep(makeBar([makeRest(2), makeRest(2)])),
    ];
    const layout = layoutScore(makeScore(meta, bars), 1200);
    expect(layout.systems[0].barSlots.length).toBeGreaterThanOrEqual(12);
    expect(minInkClearance(layout.systems)).toBeGreaterThanOrEqual(0);
  });

  it('拆分的二分 / 全休止符仍各占一拍（严格盒：撑满自己那格）', () => {
    const layout = layoutScore(makeScore(meta, rep(makeBar([makeRest(1)]), 8)), 1200);
    const slot = layout.systems[0].barSlots[0];
    const slots = layout.systems[0].blocks[0].restSlots;
    expect(slots).toBeDefined();
    expect(slots!.length).toBe(4);
    // 四个「0」落在四个拍份列上：相邻间距 = 该列列宽
    for (let i = 0; i + 1 < slots!.length; i += 1) {
      expect(slots![i + 1] - slots![i]).toBeCloseTo(slot.slotWidths[0], 6);
    }
  });

});
