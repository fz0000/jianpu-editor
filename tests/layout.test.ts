import { describe, expect, it } from 'vitest';
import { layoutScore, slotPosition } from '../src/core/layout';
import { ACCIDENTAL_W, BAR_PADDING, BEAT_SLOT_W, DASH_W, DIGIT_W, LEFT_MARGIN, RIGHT_MARGIN } from '../src/core/metrics';
import { makeBar, makeDash, makeNote, makeRest, makeScore, type Bar, type Degree } from '../src/core/model';
import { odeToJoyScore, twinkleScore } from '../src/samples';

function eventCount(score: ReturnType<typeof twinkleScore>): number {
  return score.bars.reduce((acc, bar) => acc + bar.events.length, 0);
}

describe('layoutScore', () => {
  it('为每个事件生成一个块，为每个小节生成一个槽位', () => {
    const score = twinkleScore();
    const layout = layoutScore(score, 900);

    expect(layout.systems.length).toBeGreaterThan(0);
    expect(layout.width).toBeGreaterThan(0);
    expect(layout.height).toBeGreaterThan(0);

    const slots = layout.systems.reduce((acc, s) => acc + s.barSlots.length, 0);
    const blocks = layout.systems.reduce((acc, s) => acc + s.blocks.length, 0);
    expect(slots).toBe(score.bars.length);
    expect(blocks).toBe(eventCount(score));
  });

  it('系统宽度不超过容器宽度', () => {
    const score = odeToJoyScore();
    const layout = layoutScore(score, 420);
    expect(layout.systems.length).toBeGreaterThan(1);
    for (const system of layout.systems) {
      expect(system.width).toBeLessThanOrEqual(420);
      expect(system.height).toBeGreaterThan(0);
      expect(system.barSlots.length).toBeGreaterThan(0);
    }
  });

  it('小节槽位按顺序递增且不重叠', () => {
    const layout = layoutScore(twinkleScore(), 900);
    for (const system of layout.systems) {
      let prevEnd = -1;
      for (const slot of system.barSlots) {
        expect(slot.width).toBeGreaterThan(0);
        expect(slot.x).toBeGreaterThanOrEqual(prevEnd - 1e-6);
        prevEnd = slot.x + slot.width;
      }
    }
  });

  it('小节号标签按间隔生成，关闭后不生成', () => {
    const score = twinkleScore();
    score.meta.showBarNumbers = true;
    const withNumbers = layoutScore(score, 900);
    score.meta.showBarNumbers = false;
    const without = layoutScore(score, 900);

    const labeled = withNumbers.systems.flatMap((s) => s.barNumbers.map((n) => n.barIndex));
    const unlabeled = without.systems.reduce((acc, s) => acc + s.barNumbers.length, 0);
    expect(labeled).toEqual([0, 4]);
    expect(unlabeled).toBe(0);
  });

  it('歌词随「显示歌词」开关：关闭时块内不带歌词，行高也不留歌词位置', () => {
    const build = (showLyrics: boolean) =>
      makeScore({ timeSig: { num: 2, den: 4 }, showLyrics }, [
        makeBar([makeNote(1, 4, { lyric: '起' }), makeNote(2, 4, { lyric: '来' })]),
        makeBar([makeNote(3, 4, { lyric: '中' }), makeNote(4, 4, { lyric: '国' })]),
      ]);

    const lyricsOf = (layout: ReturnType<typeof layoutScore>) =>
      layout.systems.flatMap((s) => s.blocks.map((b) => b.lyric));

    const on = layoutScore(build(true), 900);
    const off = layoutScore(build(false), 900);

    // 渲染层只画 block.lyric（render.ts），所以关闭后谱面上不应有任何歌词音节
    expect(lyricsOf(on)).toEqual(['起', '来', '中', '国']);
    expect(lyricsOf(off)).toEqual(['', '', '', '']);
    // 关闭时不留歌词的下方留白（行高更矮），开启时留足
    expect(off.systems[0].height).toBeLessThan(on.systems[0].height);
  });

  it('连音线弧线考虑八度点高度（clearance）并抬高顶部留白', () => {
    const build = (tie: boolean) =>
      makeScore(
        { timeSig: { num: 2, den: 4 }, showLyrics: false },
        [
          makeBar([makeNote(1, 4, { octave: 2 }), makeDash()]),
          makeBar([makeNote(1, 4, { octave: 2, tie }), makeDash()]),
        ],
      );

    const plain = layoutScore(build(false), 900);
    const tied = layoutScore(build(true), 900);

    const arcs = tied.systems[0].arcs;
    expect(arcs.length).toBe(1);
    expect(arcs[0].kind).toBe('tie');
    expect(arcs[0].partial).toBe('none');
    expect(arcs[0].clearance).toBeGreaterThanOrEqual(2);
    expect(arcs[0].x2).toBeGreaterThan(arcs[0].x1);
    expect(tied.systems[0].topPad).toBeGreaterThan(plain.systems[0].topPad);
  });

  it('跨行连音线拆分为 end / start 两段', () => {
    const buildBars = (count: number) =>
      Array.from({ length: count }, (_, i) =>
        makeBar([
          makeNote(1, 4, { tie: i > 0 }),
          makeNote(2, 4),
          makeNote(3, 4),
          makeNote(4, 4),
        ]),
      );
    const meta = { timeSig: { num: 4, den: 4 }, showLyrics: false, showBarNumbers: false };

    const wide = layoutScore(makeScore(meta, buildBars(4)), 1200);
    expect(wide.systems.length).toBe(1);
    expect(wide.systems[0].arcs.length).toBe(3);
    expect(wide.systems[0].arcs.every((a) => a.partial === 'none')).toBe(true);

    const narrow = layoutScore(makeScore(meta, buildBars(8)), 420);
    expect(narrow.systems.length).toBeGreaterThan(1);
    const ends = narrow.systems.flatMap((s) => s.arcs.filter((a) => a.partial === 'end'));
    const starts = narrow.systems.flatMap((s) => s.arcs.filter((a) => a.partial === 'start'));
    expect(ends.length).toBeGreaterThan(0);
    expect(starts.length).toBe(ends.length);
    expect(ends[0].kind).toBe('tie');
    expect(starts[0].kind).toBe('tie');
  });

  it('延长线块独立成块并排在前一个音符之后', () => {
    const score = makeScore({ timeSig: { num: 2, den: 4 } }, [
      makeBar([makeNote(5, 4, { octave: 1 }), makeDash(), makeDash()]),
    ]);
    const layout = layoutScore(score, 900);
    const blocks = layout.systems[0].blocks;
    expect(blocks.length).toBe(3);
    expect(blocks[0].kind).toBe('note');
    expect(blocks[1].kind).toBe('dash');
    expect(blocks[2].kind).toBe('dash');
    expect(blocks[0].degree).toBe(5);
    expect(blocks[0].octave).toBe(1);
    expect(blocks[1].cx).toBeGreaterThan(blocks[0].cx);
    expect(blocks[2].cx).toBeGreaterThan(blocks[1].cx);
  });

  it('休止符块与音符块区分', () => {
    const score = makeScore({ timeSig: { num: 4, den: 4 } }, [
      makeBar([makeNote(1, 4), makeNote(2, 4), makeRest(4), makeNote(3, 4)]),
    ]);
    const layout = layoutScore(score, 900);
    const kinds = layout.systems[0].blocks.map((b) => b.kind);
    expect(kinds).toEqual(['note', 'note', 'rest', 'note']);
  });

  it('二分 / 全休止符拆成四分休止符，与四分休止符落在同一拍份位置', () => {
    const meta = {
      timeSig: { num: 4, den: 4 },
      showLyrics: false,
      showBarNumbers: false,
      barsPerLine: 4,
    };
    const bars = [
      // 基准小节：四个四分休止符（休止符对齐的参照）
      makeBar([makeRest(4), makeRest(4), makeRest(4), makeRest(4)]),
      // 八分音符撑宽第 2 列 → 各列宽度不等（把记号盒均分就会错位的场景）
      makeBar([makeNote(1, 8), makeNote(2, 8), makeNote(3, 4), makeRest(2)]),
      makeBar([makeRest(1)]),
      makeBar([makeRest(2), makeNote(1, 4), makeNote(2, 4)]),
    ];
    const system = layoutScore(makeScore(meta, bars), 900).systems[0];
    const blocksOf = (barIndex: number) => system.blocks.filter((b) => b.barIndex === barIndex);
    const slotOf = (barIndex: number) =>
      system.barSlots.find((s) => s.barIndex === barIndex) ?? system.barSlots[barIndex];
    // 拍份 t 上的四分记号位置（与四分休止符 / 四分音符同一记号位置）
    const gridAt = (barIndex: number, t: number) =>
      slotOf(barIndex).x + BAR_PADDING + slotPosition(slotOf(barIndex), t) + DIGIT_W / 2;
    // 相对各自小节左缘的位置：跨小节比较同一拍份上的记号
    const rel = (slotIndex: number, values: number[]) =>
      values.map((v) => Number((v - system.barSlots[slotIndex].x).toFixed(6)));

    const quarters = blocksOf(0);
    expect(quarters).toHaveLength(4);
    for (const b of quarters) expect(b.restSlots).toBeUndefined();

    // 二分休止符（第 3 拍起）：两个「0」= 本小节第 3、4 个四分休止符的位置
    const half = blocksOf(1)[3];
    expect(half.kind).toBe('rest');
    expect(half.restSlots).toHaveLength(2);
    expect(half.restSlots![0]).toBeCloseTo(gridAt(1, 2), 3);
    expect(half.restSlots![1]).toBeCloseTo(gridAt(1, 3), 3);
    expect(rel(1, half.restSlots!)).toEqual(rel(0, quarters.slice(2).map((b) => b.cx)));

    // 全休止符：四个「0」占满四个拍份
    const whole = blocksOf(2)[0];
    expect(whole.restSlots).toHaveLength(4);
    for (let i = 0; i < 4; i += 1) expect(whole.restSlots![i]).toBeCloseTo(gridAt(2, i), 3);
    expect(rel(2, whole.restSlots!)).toEqual(rel(0, quarters.map((b) => b.cx)));

    // 二分休止符位于小节开头：对齐前两拍
    const leading = blocksOf(3)[0];
    expect(leading.restSlots).toHaveLength(2);
    expect(leading.restSlots![0]).toBeCloseTo(gridAt(3, 0), 3);
    expect(leading.restSlots![1]).toBeCloseTo(gridAt(3, 1), 3);
  });

  it('x/2 拍号（一拍 = 二分音符）：休止符仍按四分休止符拆分且不重叠', () => {
    const meta = {
      timeSig: { num: 2, den: 2 },
      showLyrics: false,
      showBarNumbers: false,
      barsPerLine: 2,
    };
    const bars = [makeBar([makeRest(2), makeRest(2)]), makeBar([makeRest(1)])];
    const system = layoutScore(makeScore(meta, bars), 900).systems[0];
    const halves = system.blocks.filter((b) => b.barIndex === 0);
    const whole = system.blocks.filter((b) => b.barIndex === 1)[0];

    expect(halves[0].restSlots).toHaveLength(2);
    expect(halves[1].restSlots).toHaveLength(2);
    expect(whole.restSlots).toHaveLength(4);

    // 全休止符铺满整小节：四个「0」均分（此处两列等宽，均分 = 拍份位置）
    const slot = system.barSlots[1];
    const left = slot.x + BAR_PADDING;
    const contentWidth = slot.width - BAR_PADDING * 2;
    for (let i = 0; i < 4; i += 1) {
      expect(whole.restSlots![i]).toBeCloseTo(left + (contentWidth * i) / 4 + DIGIT_W / 2, 3);
    }
    for (let i = 0; i + 1 < 4; i += 1) {
      expect(whole.restSlots![i + 1] - whole.restSlots![i]).toBeGreaterThanOrEqual(DIGIT_W - 1e-6);
    }
  });

  it('附点休止符不拆分：单个「0」加附点', () => {
    const meta = { timeSig: { num: 4, den: 4 }, showLyrics: false, showBarNumbers: false };
    const blocks = layoutScore(
      makeScore(meta, [makeBar([makeRest(2, true), makeNote(1, 4)])]),
      900,
    ).systems[0].blocks;
    expect(blocks[0].kind).toBe('rest');
    expect(blocks[0].restSlots).toBeUndefined();
    expect(blocks[0].dotted).toBe(true);
    expect(blocks[0].cx).toBeCloseTo(blocks[0].x + DIGIT_W / 2, 3);
  });

  it('圆滑线覆盖三个以上音符时只生成一条弧线', () => {
    const score = makeScore({ timeSig: { num: 4, den: 4 }, showLyrics: false, showBarNumbers: false }, [
      makeBar([
        makeNote(1, 4),
        makeNote(2, 4, { slur: true }),
        makeNote(3, 4, { slur: true }),
        makeNote(4, 4, { slur: true }),
      ]),
    ]);
    const layout = layoutScore(score, 900);
    const arcs = layout.systems[0].arcs;
    const blocks = layout.systems[0].blocks;

    expect(arcs.length).toBe(1);
    expect(arcs[0].kind).toBe('slur');
    expect(arcs[0].noteCount).toBe(4);
    expect(arcs[0].partial).toBe('none');
    expect(arcs[0].x1).toBeCloseTo(blocks[0].cx);
    expect(arcs[0].x2).toBeCloseTo(blocks[3].cx);
  });

  it('跨行的圆滑线按行分段续接（end / both / start）', () => {
    const bars: Bar[] = [];
    let first = true;
    for (let b = 0; b < 9; b += 1) {
      const events = Array.from({ length: 3 }, (_, i) => {
        const slur = !(first && i === 0);
        first = false;
        return makeNote((((b * 3 + i) % 7) + 1) as Degree, 4, { slur });
      });
      bars.push(makeBar(events));
    }
    const layout = layoutScore(
      makeScore(
        { timeSig: { num: 3, den: 4 }, showLyrics: false, showBarNumbers: false, barsPerLine: 3 },
        bars,
      ),
      300,
    );

    expect(layout.systems.length).toBe(3);
    expect(layout.systems.map((s) => s.arcs.map((a) => a.partial))).toEqual(
      [['end'], ['both'], ['start']],
    );

    const middle = layout.systems[1].arcs[0];
    expect(middle.kind).toBe('slur');
    // 每行内 3 小节内（250px 内宽内 3/4 内）→ 中间行内 9 音符内
    expect(middle.noteCount).toBe(9);
    expect(middle.x1).toBe(0);
    expect(middle.x2).toBeCloseTo(layout.systems[1].width);
  });

  it('圆滑线组内任意音符的八度点都会抬高整条弧线', () => {
    const score = makeScore({ timeSig: { num: 3, den: 4 }, showLyrics: false }, [
      makeBar([makeNote(1, 4), makeNote(2, 4, { slur: true, octave: 2 }), makeNote(3, 4, { slur: true })]),
    ]);
    const layout = layoutScore(score, 900);
    const arcs = layout.systems[0].arcs;
    expect(arcs.length).toBe(1);
    expect(arcs[0].clearance).toBe(2);
  });

  it('未标记圆滑线的音会把长圆滑线分成两组', () => {
    const score = makeScore({ timeSig: { num: 6, den: 4 }, showLyrics: false }, [
      makeBar([
        makeNote(1, 4),
        makeNote(2, 4, { slur: true }),
        makeNote(3, 4, { slur: true }),
        makeNote(4, 4),
        makeNote(5, 4, { slur: true }),
        makeNote(6, 4, { slur: true }),
      ]),
    ]);
    const arcs = layoutScore(score, 900).systems[0].arcs;
    expect(arcs.length).toBe(2);
    expect(arcs.map((a) => a.noteCount)).toEqual([3, 3]);
  });

  it('barsPerLine 固定每行小节数', () => {
    const bars = Array.from({ length: 7 }, (_, i) =>
      makeBar([
        makeNote(1, 4),
        makeNote(2, 4),
        makeNote(3, 4),
        makeNote(((i % 7) + 1) as 1 | 2 | 3 | 4 | 5 | 6 | 7, 4),
      ]),
    );
    const score = makeScore(
      { timeSig: { num: 4, den: 4 }, showLyrics: false, showBarNumbers: false, barsPerLine: 3 },
      bars,
    );
    const layout = layoutScore(score, 900);
    expect(layout.systems.length).toBe(3);
    expect(layout.systems.map((s) => s.barSlots.length)).toEqual([3, 3, 1]);
  });

  it('延长线继承前一个音符的下划线数量', () => {
    const score = makeScore({ timeSig: { num: 2, den: 4 } }, [
      makeBar([makeNote(1, 8), makeDash(), makeNote(2, 4), makeDash()]),
    ]);
    const blocks = layoutScore(score, 900).systems[0].blocks;
    expect(blocks.map((b) => b.underlines)).toEqual([1, 1, 0, 0]);
  });

  it('小节宽度按行内平分：每行内小节宽度相同、拍份宽度相同', () => {
    const meta = { timeSig: { num: 4, den: 4 }, showLyrics: false, showBarNumbers: false };
    const score = makeScore(meta, [
      makeBar([makeNote(1, 4), makeNote(2, 4), makeNote(3, 4), makeNote(4, 4)]),
      makeBar([makeNote(1, 16), makeNote(2, 16), makeNote(3, 16), makeNote(4, 16)]),
      makeBar([makeNote(5, 8), makeNote(6, 8), makeNote(7, 4), makeNote(1, 4)]),
    ]);
    const layout = layoutScore(score, 900);
    const slots = layout.systems.flatMap((s) => s.barSlots);
    const available = 900 - LEFT_MARGIN - RIGHT_MARGIN;
    // 最密集小节（16 分音符）决定拍份下限 → 小节自然宽度 4×(DIGIT_W/0.25)+2×BAR_PADDING
    // 可用宽度 / 自然宽度 = 3 → 三小节同处一行，行宽度按小节数平分
    expect(layout.systems.map((s) => s.barSlots.length)).toEqual([3]);
    expect(slots.length).toBe(3);

    // 行宽度按小节数平分 → 每行内小节宽度相同（且所有行内一致）
    const barWidth = available / 3;
    for (const slot of slots) expect(slot.width).toBeCloseTo(barWidth, 3);
    expect(layout.systems[0].width).toBeCloseTo(available, 6);

    // 拍份宽度按拍份数平分 → 每小节内节拍宽度相同，最密集小节内（16 分音符）内不溢出
    for (const slot of slots) {
      expect(slot.slotWidth).toBeCloseTo((barWidth - BAR_PADDING * 2) / 4, 3);
    }
    expect(slots[0].slotWidth).toBeGreaterThanOrEqual(DIGIT_W / 0.25 - 1e-6);

    // 记号内不溢出：相邻记号内至少记号宽度 apart
    for (const system of layout.systems) {
      for (let i = 0; i + 1 < system.blocks.length; i += 1) {
        expect(system.blocks[i + 1].cx - system.blocks[i].cx).toBeGreaterThanOrEqual(DIGIT_W - 1e-6);
      }
    }
  });

  it('小节宽度按行内平分：升降号 / 附点 / 延长线内自然宽度内不溢出', () => {
    const meta = { timeSig: { num: 4, den: 4 }, showLyrics: false, showBarNumbers: false };
    const bar = makeBar([
      makeNote(1, 4, { accidental: 'sharp' }),
      makeNote(2, 4, { dotted: true }),
      makeNote(3, 4),
      makeDash(),
    ]);
    const layout = layoutScore(makeScore(meta, [bar, bar]), 900);
    const slots = layout.systems[0].barSlots;
    const blocks = layout.systems[0].blocks;
    const slotWidth = slots[0].slotWidth;
    const available = 900 - LEFT_MARGIN - RIGHT_MARGIN;

    // 超量小节内（4.5 拍）→ 拍份数 5；行内 2 小节内宽度按行内宽度平分
    expect(layout.systems.length).toBe(1);
    expect(slots.length).toBe(2);
    const barWidth = available / 2;
    for (const slot of slots) expect(slot.width).toBeCloseTo(barWidth, 3);
    expect(slotWidth).toBeCloseTo((barWidth - BAR_PADDING * 2) / 5, 3);

    // 拍份下限内记号内自然宽度（含升降号预留）→ 记号内不溢出
    expect(slotWidth).toBeGreaterThanOrEqual(DIGIT_W + ACCIDENTAL_W - 1e-6);
    // 小节内内容内不溢出：最后记号（延长线）内内越小节右边界
    expect(blocks[3].x + DASH_W).toBeLessThan(slots[0].x + slots[0].width);
    for (let i = 0; i + 1 < blocks.length; i += 1) {
      expect(blocks[i + 1].cx - blocks[i].cx).toBeGreaterThanOrEqual(DIGIT_W - 1e-6);
    }
  });

  it('小节内按节拍对齐：小节内拍份宽度一致、记号按拍份坐标', () => {
    const meta = { timeSig: { num: 4, den: 4 }, showLyrics: false, showBarNumbers: false };
    const bar = makeBar([makeNote(1, 8), makeNote(2, 8), makeNote(3, 4), makeNote(4, 4)]);
    const layout = layoutScore(makeScore(meta, [bar, bar]), 900);
    const system = layout.systems[0];
    const slot = system.barSlots[0];
    const blocks = system.blocks.slice(0, 4);
    // 拍份坐标：两个八分共用拍份 0，随后两个四分各占一个拍份
    const starts = [0, 0.5, 1, 2];
    const spans = [0.5, 0.5, 1, 1];

    expect(blocks.map((b) => b.beatIndex)).toEqual([0, 0, 1, 2]);
    // 记号落在拍份网格上：x = 小节内容左缘 + 拍份坐标位置，宽 = 拍份坐标跨度
    blocks.forEach((b, i) => {
      const from = slotPosition(slot, starts[i]);
      expect(b.x).toBeCloseTo(slot.x + BAR_PADDING + from, 3);
      expect(b.width).toBeCloseTo(slotPosition(slot, starts[i] + spans[i]) - from, 3);
    });
    // 两个八分同占一拍：两列宽之和 = 一拍宽，记号盒各占半拍且互不重叠
    expect(blocks[1].x - blocks[0].x).toBeGreaterThanOrEqual(DIGIT_W - 1e-6);
    // 拍份内记号下划线连接，跨拍份不连接
    const pairs = [0, 1, 2].map((i) => blocks[i].beatIndex === blocks[i + 1].beatIndex);
    expect(pairs).toEqual([true, false, false]);
  });

  it('记号左对齐拍份：记号盒贴拍份左边缘', () => {
    const meta = { timeSig: { num: 4, den: 4 }, showLyrics: false, showBarNumbers: false };
    const bar = makeBar([
      makeNote(1, 4),
      makeNote(2, 8, { accidental: 'sharp' }),
      makeNote(3, 8),
      makeNote(4, 4),
    ]);
    const layout = layoutScore(makeScore(meta, [bar, bar]), 900);
    const system = layout.systems[0];
    const slot = system.barSlots[0];
    const blocks = system.blocks.slice(0, 4);

    // 小节内记号都落在拍份网格线：记号盒（含升降号预留）左边缘 = 拍份左边缘
    blocks.forEach((b) => {
      const accExtra = b.accidental !== 'natural' ? ACCIDENTAL_W : 0;
      expect(b.cx).toBeCloseTo(b.x + accExtra + DIGIT_W / 2, 3);
    });
    expect(blocks[0].x).toBeCloseTo(slot.x + BAR_PADDING, 3);
    expect(blocks.map((b) => b.beatIndex)).toEqual([0, 1, 1, 2]);
  });

  it('行内宽度平分：小节宽度按每行小节数、拍份宽度按拍份数', () => {
    const meta = { timeSig: { num: 4, den: 4 }, showLyrics: false, showBarNumbers: false };
    const bars = Array.from({ length: 12 }, () =>
      makeBar([1, 2, 3, 4].map((d) => makeNote(d as 1 | 2 | 3 | 4, 4))),
    );
    const layout = layoutScore(makeScore(meta, bars), 900);
    const available = 900 - LEFT_MARGIN - RIGHT_MARGIN;
    // 小节自然宽度 = 2 * BAR_PADDING + 4 拍份 × BEAT_SLOT_W → 每行内最多 fitPerLine 小节
    // （每行小节数不超过小节总数：12 小节宽容器内单行排完）
    const fitPerLine = Math.min(
      bars.length,
      Math.floor(available / (BAR_PADDING * 2 + 4 * BEAT_SLOT_W)),
    );
    const barWidth = available / fitPerLine;
    const expectedGroups: number[] = [];
    for (let left = bars.length; left > 0; left -= fitPerLine) {
      expectedGroups.push(Math.min(fitPerLine, left));
    }

    expect(layout.systems.map((s) => s.barSlots.length)).toEqual(expectedGroups);
    for (const system of layout.systems) {
      for (const slot of system.barSlots) {
        expect(slot.width).toBeCloseTo(barWidth, 6);
        expect(slot.slotWidth).toBeCloseTo((barWidth - BAR_PADDING * 2) / 4, 6);
      }
    }
    // 拍份下限内不记号内溢出
    expect(layout.systems[0].barSlots[0].slotWidth).toBeGreaterThanOrEqual(BEAT_SLOT_W - 1e-6);
  });

  it('每行小节数固定时行内宽度平分', () => {
    const bars = Array.from({ length: 4 }, () =>
      makeBar([1, 2, 3, 4].map((d) => makeNote(d as 1 | 2 | 3 | 4, 4))),
    );
    const score = makeScore(
      { timeSig: { num: 4, den: 4 }, showLyrics: false, showBarNumbers: false, barsPerLine: 2 },
      bars,
    );
    const layout = layoutScore(score, 1200);
    const available = 1200 - LEFT_MARGIN - RIGHT_MARGIN;

    expect(layout.systems.length).toBe(2);
    // 宽容器 + 每行只 2 小节：小节宽度按行内宽度平分（记号内拉开过整行宽度）
    for (const system of layout.systems) {
      expect(system.width).toBeCloseTo(available, 6);
      expect(system.barSlots.length).toBe(2);
      for (const slot of system.barSlots) {
        expect(slot.width).toBeCloseTo(available / 2, 6);
      }
    }
    const slotWidth = layout.systems[0].barSlots[0].slotWidth;
    expect(slotWidth).toBeCloseTo((available / 2 - BAR_PADDING * 2) / 4, 6);
    expect(slotWidth).toBeGreaterThan(BEAT_SLOT_W);
  });

  it('每行小节数超过小节总数时单行内宽度平分（内不留右侧留白）', () => {
    const meta = { timeSig: { num: 4, den: 4 }, showLyrics: false, showBarNumbers: false };
    const bars = Array.from({ length: 4 }, () =>
      makeBar([1, 2, 3, 4].map((d) => makeNote(d as 1 | 2 | 3 | 4, 4))),
    );
    const layout = layoutScore(makeScore({ ...meta, barsPerLine: 12 }, bars), 900);
    const available = 900 - LEFT_MARGIN - RIGHT_MARGIN;

    expect(layout.systems.length).toBe(1);
    expect(layout.systems[0].barSlots.length).toBe(4);
    expect(layout.width).toBeCloseTo(900, 6);
    for (const slot of layout.systems[0].barSlots) {
      expect(slot.width).toBeCloseTo(available / 4, 6);
    }
  });

  it('小节宽度内一致：所有行内小节宽度相同', () => {
    const meta = { timeSig: { num: 4, den: 4 }, showLyrics: false, showBarNumbers: false };
    const bars = Array.from({ length: 10 }, () =>
      makeBar([1, 2, 3, 4].map((d) => makeNote(d as 1 | 2 | 3 | 4, 4))),
    );
    // 窄一点的容器 → 每行 fitPerLine 小节，跨两行，验证「所有行内小节宽度相同」
    const layout = layoutScore(makeScore(meta, bars), 420);
    const available = 420 - LEFT_MARGIN - RIGHT_MARGIN;
    const fitPerLine = Math.floor(available / (BAR_PADDING * 2 + 4 * BEAT_SLOT_W));
    const barWidth = available / fitPerLine;

    expect(fitPerLine).toBeGreaterThan(1);
    expect(layout.systems.map((s) => s.barSlots.length)).toEqual([
      fitPerLine,
      bars.length - fitPerLine,
    ]);
    for (const system of layout.systems) {
      for (const slot of system.barSlots) expect(slot.width).toBeCloseTo(barWidth, 6);
    }
  });

  it('窄容器内小节内不记号内压缩：小节内自然宽度内横向滚动', () => {
    const meta = { timeSig: { num: 4, den: 4 }, showLyrics: false, showBarNumbers: false };
    const bars = [
      makeBar(Array.from({ length: 32 }, () => makeNote(1, 32))),
      makeBar(Array.from({ length: 32 }, () => makeNote(2, 32))),
    ];
    const layout = layoutScore(makeScore(meta, bars), 200);
    // 可用宽度内小于小节内自然宽度 → 每行内 1 小节，小节内自然宽度（记号内不压缩）
    const slotNatural = DIGIT_W / 0.125;
    const natural = BAR_PADDING * 2 + 4 * slotNatural;
    expect(layout.systems.map((s) => s.barSlots.length)).toEqual([1, 1]);
    for (const system of layout.systems) {
      expect(system.width).toBeCloseTo(natural, 6);
      expect(system.barSlots[0].slotWidth).toBeCloseTo(slotNatural, 6);
    }
  });
});

describe('延长线（横线）：二分 / 全音符补线', () => {
  const meta = { timeSig: { num: 4, den: 4 }, showLyrics: false, showBarNumbers: false };

  const dashesOf = (bars: Bar[], scoreMeta = meta): number[] =>
    layoutScore(makeScore(scoreMeta, bars), 900).systems[0].blocks.map((b) => b.dashes);

  it('二分音符补一根横线，全音符补三根', () => {
    expect(dashesOf([makeBar([makeNote(5, 2), makeNote(3, 1)])])).toEqual([1, 3]);
  });

  it('附点二分补两根；附点四分不补（写作「5.」）', () => {
    const bars = [makeBar([makeNote(5, 2, { dotted: true }), makeNote(3, 4, { dotted: true })])];
    expect(dashesOf(bars)).toEqual([2, 0]);
  });

  it('附点二分不写附点（「5 - -」），附点四分照旧写附点（「3.」）', () => {
    const bars = [makeBar([makeNote(5, 2, { dotted: true }), makeNote(3, 4, { dotted: true })])];
    const blocks = layoutScore(makeScore(meta, bars), 900).systems[0].blocks;
    // 附点的那半拍由第三根时值单位（横线）表达，记号盒里不再画附点
    expect(blocks[0].dashes).toBe(2);
    expect(blocks[0].dotted).toBe(false);
    // 不足两拍的音符没有横线，附点必须写出来
    expect(blocks[1].dashes).toBe(0);
    expect(blocks[1].dotted).toBe(true);
  });

  it('附点全音符同样不写附点；附点休止符仍写附点', () => {
    const blocks = layoutScore(
      makeScore(meta, [makeBar([makeNote(1, 1, { dotted: true }), makeRest(4, true)])]),
      900,
    ).systems[0].blocks;
    expect(blocks[0].dashes).toBe(5);
    expect(blocks[0].dotted).toBe(false);
    expect(blocks[1].dotted).toBe(true);
  });

  it('八分及更短时值不补横线', () => {
    const bars = [makeBar([makeNote(1, 8), makeNote(2, 16), makeNote(3, 32)])];
    expect(dashesOf(bars)).toEqual([0, 0, 0]);
  });

  it('休止符与显式延长线块不补横线', () => {
    const bars = [makeBar([makeRest(2), makeNote(5, 4), makeDash()])];
    expect(dashesOf(bars)).toEqual([0, 0, 0]);
  });

  it('复合拍子 x/8：一拍是附点四分音符，附点二分补一根', () => {
    const bars = [makeBar([makeNote(5, 4, { dotted: true }), makeNote(3, 2, { dotted: true })])];
    expect(dashesOf(bars, { ...meta, timeSig: { num: 6, den: 8 } })).toEqual([0, 1]);
  });

  it('横线记号盒宽 = 完整时值（数字 + 横线）', () => {
    const blocks = layoutScore(
      makeScore(meta, [makeBar([makeNote(5, 2), makeNote(1, 4)])]),
      900,
    ).systems[0].blocks;
    const half = blocks[0];
    const quarter = blocks[1];
    expect(half.dashes).toBe(1);
    // 二分音符占两拍，记号盒是四分音符（一拍）的两倍宽
    expect(half.width).toBeCloseTo(quarter.width * 2, 6);
  });
  it('全音符记号盒为四拍宽，横线区每根不塌陷', () => {
    const blocks = layoutScore(
      makeScore(meta, [makeBar([makeNote(3, 1), makeNote(1, 4)])]),
      260,
    ).systems[0].blocks;
    const whole = blocks[0];
    const quarter = blocks[1];
    expect(whole.dashes).toBe(3);
    expect(whole.width).toBeCloseTo(quarter.width * 4, 6);
    // 渲染层每根横线居中落在数字之后的各拍里：一拍单位宽 = 记号盒宽 / (横线数 + 1)，
    // 须大于 4 才画得出短横
    const unit = whole.width / (whole.dashes + 1);
    expect(unit).toBeGreaterThan(4);
  });

  it('补出的横线落在拍份网格上：与同拍的普通音符同一记号位置', () => {
    const meta = {
      timeSig: { num: 4, den: 4 },
      showLyrics: false,
      showBarNumbers: false,
      barsPerLine: 4,
    };
    const bars = [
      // 基准小节：四个四分音符（记号位置的参照）
      makeBar([makeNote(1, 4), makeNote(2, 4), makeNote(3, 4), makeNote(4, 4)]),
      // 八分音符撑宽网格（各列不等宽时居中摊会错位）+ 二分音符补一根 + 四分音符
      makeBar([makeNote(1, 8), makeNote(2, 8), makeNote(5, 2), makeNote(6, 4)]),
      // 全音符补三根
      makeBar([makeNote(1, 1)]),
      // 显式延长线：与补出的横线取同一记号位置
      makeBar([makeNote(5, 4), makeDash(), makeNote(1, 4), makeNote(2, 4)]),
    ];
    const system = layoutScore(makeScore(meta, bars), 900).systems[0];
    const blocksOf = (barIndex: number) => system.blocks.filter((b) => b.barIndex === barIndex);
    const slotOf = (barIndex: number) => system.barSlots[barIndex];
    // 拍份 t 上的记号位置（四分音符 / 四分休止符同一位置）
    const gridAt = (barIndex: number, t: number) =>
      slotOf(barIndex).x + BAR_PADDING + slotPosition(slotOf(barIndex), t) + DIGIT_W / 2;
    // 相对各自小节左缘的位置：跨小节比较同一拍份上的记号
    const rel = (barIndex: number, values: number[]) =>
      values.map((v) => Number((v - system.barSlots[barIndex].x).toFixed(6)));

    const quarters = blocksOf(0);
    for (const b of quarters) expect(b.dashSlots).toBeUndefined();

    // 二分音符（第 3 拍上的横线）＝ 基准小节第 3 个四分音符的位置
    const half = blocksOf(1)[2];
    expect(half.dashes).toBe(1);
    expect(half.dashSlots).toHaveLength(1);
    expect(half.dashSlots![0]).toBeCloseTo(gridAt(1, 2), 3);
    expect(rel(1, half.dashSlots!)).toEqual(rel(0, [quarters[2].cx]));

    // 全音符的三根横线铺在后三拍上
    const whole = blocksOf(2)[0];
    expect(whole.dashes).toBe(3);
    for (let i = 0; i < 3; i += 1) expect(whole.dashSlots![i]).toBeCloseTo(gridAt(2, i + 1), 3);
    expect(rel(2, whole.dashSlots!)).toEqual(rel(0, quarters.slice(1).map((b) => b.cx)));

    // 显式延长线：落在第 2 拍的记号位置
    const explicit = blocksOf(3)[1];
    expect(explicit.kind).toBe('dash');
    expect(explicit.cx).toBeCloseTo(gridAt(3, 1), 3);
    expect(rel(3, [explicit.cx])).toEqual(rel(0, [quarters[1].cx]));
  });

  it('复合拍子 x/8：横线落在附点一拍的网格上', () => {
    const meta = {
      timeSig: { num: 6, den: 8 },
      showLyrics: false,
      showBarNumbers: false,
      barsPerLine: 2,
    };
    const bars = [
      // 参照：六个八分音符（一拍 = 三个八分拍份）
      makeBar([1, 2, 3, 4, 5, 6].map((d) => makeNote(d as Degree, 8))),
      // 附点二分（6/8 里占满整小节 = 两拍）补一根：横线落在第 2 拍（三个八分拍份）上
      makeBar([makeNote(3, 2, { dotted: true })]),
    ];
    const system = layoutScore(makeScore(meta, bars), 900).systems[0];
    const slot = system.barSlots[1];
    const eighths = system.blocks.filter((b) => b.barIndex === 0);
    const half = system.blocks.filter((b) => b.barIndex === 1)[0];

    expect(half.dashes).toBe(1);
    expect(half.dashSlots![0]).toBeCloseTo(
      slot.x + BAR_PADDING + slotPosition(slot, 3) + DIGIT_W / 2,
      3,
    );
    const rel = (slotIndex: number, values: number[]) =>
      values.map((v) => Number((v - system.barSlots[slotIndex].x).toFixed(6)));
    expect(rel(1, half.dashSlots!)).toEqual(rel(0, [eighths[3].cx]));
  });
});

