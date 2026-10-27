import { describe, expect, it } from 'vitest';
import { layoutScore, slotPosition } from '../src/core/layout';
import { BAR_PADDING, DIGIT_W, LEFT_MARGIN, lyricWidth, RIGHT_MARGIN } from '../src/core/metrics';
import { makeBar, makeDash, makeNote, makeScore, type Degree } from '../src/core/model';
import { parseJianpuText } from '../src/core/jianpu-text';
import { odeToJoyScore } from '../src/samples';

/** 6/8 示例曲：小节时值长短不一（含 5 拍小节），用来检验全局节拍网格 */
const SAMPLE_TEXT = [
  '1 1 5 5 | 5 5 | 6 6 | 5 - | 4 4 | 3 3 | 2 2 | 1 - |',
  '1 1 5 5 | 5 5 | 6 6 | 5 - | 4 4 | 3 3 | 2 2 | 1 - |',
  '1 5 | 5 5 | 6 5 | 4 3 | 3 1 | 2 2 | 1 5 | 5 5 |',
  '6 5 | 4 3 | 1 5 | 5 5 | 6 5 | 4 3 | 2 1 | 1 - |',
  '1 1 5 5 | 5 5 | 6 6 | 5 - | 4 4 | 3 3 | 2 2 | 1 - |',
  '1 1 5 5 | 5 5 | 6 6 | 5 - | 4 4 | 3 3 | 2 2 | 1 - |',
  '6 5 4 3 | 2 1 5 | 5 5 6 5 | 4 3 2 1 | 1 5 | 5 5 |',
  '6 5 | 4 3 | 1 5 | 5 5 | 6 5 | 4 3 | 2 1 | 1 - |',
].join('\n');

function sampleScore(showLyrics: boolean) {
  const parsed = parseJianpuText(SAMPLE_TEXT);
  return makeScore(
    { timeSig: { num: 6, den: 8 }, showLyrics, showBarNumbers: true },
    parsed.bars,
  );
}

/** 每小节的记号盒（按小节分组，保持文档顺序） */
function blocksByBar(system: ReturnType<typeof layoutScore>['systems'][number]) {
  const byBar = new Map<number, typeof system.blocks>();
  for (const b of system.blocks) {
    const list = byBar.get(b.barIndex) ?? [];
    list.push(b);
    byBar.set(b.barIndex, list);
  }
  return byBar;
}

describe('全局节拍网格排版', () => {
  it('整页共用同一套拍份列宽：同一拍在每一行、每一小节横向位置一致', () => {
    const layout = layoutScore(sampleScore(true), 945);
    const grid = layout.systems[0].barSlots[0].slotWidths;
    // 拍份列 = 八分音符：示例小节最长 4 个四分音符 = 8 个拍份 → 全曲 8 列
    expect(grid.length).toBeGreaterThanOrEqual(6);

    for (const system of layout.systems) {
      for (const slot of system.barSlots) {
        expect(slot.slotWidths).toEqual(grid);
      }
    }

    // 同一拍份坐标在不同小节里映射到同样的相对位置
    const slots = layout.systems[0].barSlots;
    for (const t of [0, 1, 2, 3, 4, 5]) {
      const offsets = slots.map((s) => slotPosition(s, t));
      for (const off of offsets) expect(off).toBeCloseTo(offsets[0], 6);
    }
  });

  it('记号盒互不重叠、不越出小节边界', () => {
    const layout = layoutScore(sampleScore(true), 945);
    for (const system of layout.systems) {
      const byBar = blocksByBar(system);
      for (const slot of system.barSlots) {
        const blocks = byBar.get(slot.barIndex) ?? [];
        const left = slot.x + BAR_PADDING;
        const right = slot.x + slot.width - BAR_PADDING;
        for (let i = 0; i < blocks.length; i += 1) {
          const b = blocks[i];
          expect(b.x).toBeGreaterThanOrEqual(left - 1e-6);
          expect(b.x + b.width).toBeLessThanOrEqual(right + 1e-6);
          if (i > 0) {
            // 相邻记号中心距至少一个数字宽
            expect(b.cx - blocks[i - 1].cx).toBeGreaterThanOrEqual(DIGIT_W - 1e-6);
          }
        }
      }
    }
  });

  it('每行尽可能多的小节：行宽铺满容器，窄小节不再被整小节撑宽', () => {
    const containerWidth = 945;
    const available = containerWidth - LEFT_MARGIN - RIGHT_MARGIN;
    const layout = layoutScore(sampleScore(true), containerWidth);
    const first = layout.systems[0];
    const perLine = first.barSlots.length;

    // 行宽铺满容器（不再出现「整页只排三小节 + 右侧大片空白」）
    expect(perLine * first.barSlots[0].width).toBeCloseTo(available, 6);
    expect(layout.width).toBeCloseTo(containerWidth, 6);
    // 6/8 稀疏小节：整小节平分拍份宽度时只能排 3 小节，现按记号自然宽度排满
    expect(perLine).toBeGreaterThanOrEqual(6);
  });

  it('歌词音节居中在数字下方，相邻音节互不重叠', () => {
    const syllables = ['中', '国', '人', '民', '伟', '大', '的', '一', '切', '都', '属', '于', '我'];
    const bars = Array.from({ length: 12 }, (_, bi) =>
      makeBar(
        Array.from({ length: 6 }, (_, i) =>
          makeNote((((bi * 6 + i) % 7) + 1) as Degree, 8, {
            lyric: syllables[(bi * 6 + i) % syllables.length],
          }),
        ),
      ),
    );
    const layout = layoutScore(makeScore({ timeSig: { num: 3, den: 4 }, showLyrics: true }, bars), 945);
    for (const system of layout.systems) {
      const byBar = blocksByBar(system);
      for (const [, blocks] of byBar) {
        for (let i = 0; i + 1 < blocks.length; i += 1) {
          const a = blocks[i];
          const b = blocks[i + 1];
          if (!a.lyric || !b.lyric) continue;
          const gap = b.cx - a.cx - (lyricWidth(a.lyric) + lyricWidth(b.lyric)) / 2;
          expect(gap).toBeGreaterThanOrEqual(-1e-6);
        }
      }
    }
  });

  it('稀疏小节只占自己那几列：不足拍号的小节不被撑满整行', () => {
    const full = makeBar([1, 2, 3, 4].map((d) => makeNote(d as Degree, 4)));
    const pickup = makeBar([makeNote(5 as Degree, 4), makeNote(6 as Degree, 4)]);
    const bars = [pickup, full, full, full, full, full, full, full];
    const layout = layoutScore(
      makeScore({ timeSig: { num: 4, den: 4 }, showLyrics: false, showBarNumbers: false }, bars),
      945,
    );
    const system = layout.systems[0];
    const slot = system.barSlots[0];
    const contentWidth = slot.width - BAR_PADDING * 2;
    const blocks = blocksByBar(system).get(slot.barIndex) ?? [];
    expect(blocks.length).toBe(2);
    // 两个四分音符只占前两拍 → 末记号右缘不超过小节内容宽的一半
    expect(blocks[1].x + blocks[1].width).toBeLessThanOrEqual(
      slot.x + BAR_PADDING + contentWidth / 2 + 1e-6,
    );
    // 整小节（四拍）铺满自己那小节的内容宽
    const fullSlot = system.barSlots[1];
    const fullBlocks = blocksByBar(system).get(fullSlot.barIndex) ?? [];
    expect(fullBlocks.length).toBe(4);
    expect(fullBlocks[3].x + fullBlocks[3].width).toBeCloseTo(
      fullSlot.x + BAR_PADDING + fullSlot.width - BAR_PADDING * 2,
      6,
    );
  });

  it('同时值记号处处等宽：密集小节决定全谱拍份宽度，四分音符不被拉宽', () => {
    // 第 2 小节混进一个八分音符（占半拍）。逐列各取需求会把那一列撑成两倍宽
    // （需求 = 记号宽 / 0.5 拍），于是别的小节里同一列的四分音符跟着变宽。
    const bars = [
      makeBar([3, 3, 4, 5].map((d) => makeNote(d as Degree, 4))),
      makeBar([
        makeNote(3 as Degree, 4, { dotted: true }),
        makeNote(2 as Degree, 8),
        makeNote(2 as Degree, 4),
        makeDash(),
      ]),
      makeBar([1, 1, 2, 3].map((d) => makeNote(d as Degree, 4))),
    ];
    const layout = layoutScore(
      makeScore({ timeSig: { num: 4, den: 4 }, showLyrics: false, showBarNumbers: false }, bars),
      945,
    );
    const grid = layout.systems[0].barSlots[0].slotWidths;

    // 全曲同一套列宽，且每一列等宽
    for (const slot of layout.systems[0].barSlots) expect(slot.slotWidths).toEqual(grid);
    expect(new Set(grid.map((w) => +w.toFixed(6))).size).toBe(1);

    // 四分音符在任何小节里都同样宽
    const quarterWidths = new Set(
      layout.systems[0].blocks
        .filter((b) => b.kind === 'note' && b.duration === 4 && !b.dotted)
        .map((b) => +b.width.toFixed(6)),
    );
    expect(quarterWidths.size).toBe(1);

    // 密集小节里的八分音符仍装得下自己：盒宽 ≥ 数字宽，相邻记号不重叠
    const eighth = layout.systems[0].blocks.find((b) => b.kind === 'note' && b.duration === 8);
    expect(eighth?.width).toBeGreaterThanOrEqual(DIGIT_W - 1e-6);
  });

  it('自带示例「欢乐颂」：四分音符处处等宽（回归：八分音符撑宽整列）', () => {
    for (const containerWidth of [700, 945, 1200]) {
      const layout = layoutScore(odeToJoyScore(), containerWidth);
      const widths = new Set<number>();
      for (const system of layout.systems) {
        for (const b of system.blocks) {
          if (b.kind === 'note' && b.duration === 4 && !b.dotted) widths.add(+b.width.toFixed(4));
        }
      }
      expect([...widths]).toHaveLength(1);
      // 四分音符宽度不小于一个数字宽（记号不挤压）
      expect([...widths][0]).toBeGreaterThanOrEqual(DIGIT_W - 1e-6);
    }
  });

});
