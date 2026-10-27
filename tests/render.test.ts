// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { layoutScore } from '../src/core/layout';
import {
  BARLINE_LYRIC_GAP,
  CAP_HEIGHT,
  LYRIC_FONT_SIZE,
  LYRIC_OFFSET,
  lyricBaseline,
  TITLE_TRACKING,
} from '../src/core/metrics';
import { renderScore, scoreToSvgString, SVG_NS } from '../src/core/render';
import { makeBar, makeNote, makeScore, type Score } from '../src/core/model';

/** 四个带歌词音节的音符 */
function scoreWithLyrics(showLyrics: boolean): Score {
  return makeScore(
    { timeSig: { num: 2, den: 4 }, showLyrics, showBarNumbers: false },
    [
      makeBar([makeNote(1, 4, { lyric: '起' }), makeNote(2, 4, { lyric: '来' })]),
      makeBar([makeNote(3, 4, { lyric: '中' }), makeNote(4, 4, { lyric: '国' })]),
    ],
  );
}

function render(showLyrics: boolean): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  renderScore(svg, layoutScore(scoreWithLyrics(showLyrics), 900));
  return svg;
}

const textsOf = (nodes: Array<Element>) => nodes.map((n) => n.textContent);

describe('renderScore：歌词随「显示歌词」开关', () => {
  it('开启时每个音节渲染一个 .jp-lyric，文本与顺序一致', () => {
    expect(textsOf(Array.from(render(true).querySelectorAll('.jp-lyric')))).toEqual([
      '起',
      '来',
      '中',
      '国',
    ]);
  });

  it('关闭时谱面上没有任何 .jp-lyric，数字照常渲染', () => {
    const svg = render(false);
    expect(svg.querySelectorAll('.jp-lyric').length).toBe(0);
    expect(svg.querySelectorAll('.jp-digit').length).toBe(4);
  });

  it('开启时歌词落在数字下方 LYRIC_OFFSET 处', () => {
    const first = render(true).querySelector('.jp-lyric');
    expect(Number(first?.getAttribute('y'))).toBeCloseTo(CAP_HEIGHT / 2 + LYRIC_OFFSET, 6);
  });

  it('十六分低音音符：歌词基线让开低音点，字号写成属性（随谱面缩放）', () => {
    const score = makeScore(
      { timeSig: { num: 4, den: 4 }, showLyrics: true, showBarNumbers: false },
      [makeBar([makeNote(5, 16, { octave: -1, lyric: '字' }), makeNote(6, 4, { lyric: '一' })])],
    );
    const svg = document.createElementNS(SVG_NS, 'svg');
    renderScore(svg, layoutScore(score, 900));

    const block = svg.querySelector('.jp-block');
    const lyric = block?.querySelector('.jp-lyric');
    expect(lyric?.textContent).toBe('字');
    expect(Number(lyric?.getAttribute('y'))).toBeCloseTo(CAP_HEIGHT / 2 + lyricBaseline(2, 1), 6);
    // 字号必须是排版层写进 text 的属性（用户单位）：CSS 里写 px 字号会压过它，
    // 歌词便固定成屏幕像素、既不随谱面字号缩放，也与排版预留的位置对不上
    expect(Number(lyric?.getAttribute('font-size'))).toBe(LYRIC_FONT_SIZE);

    // 低音八度点（含半径）整体在歌词顶边之上
    const dots = Array.from(block?.querySelectorAll('.jp-octave-dot') ?? []);
    expect(dots.length).toBeGreaterThan(0);
    const dotBottom = Math.max(
      ...dots.map((d) => Number(d.getAttribute('cy')) + Number(d.getAttribute('r'))),
    );
    const lyricTop = Number(lyric?.getAttribute('y')) - LYRIC_FONT_SIZE / 2;
    expect(lyricTop).toBeGreaterThan(dotBottom);
  });

  it('关闭时整行高度收缩，渲染出的 SVG 高度与排版一致', () => {
    const on = layoutScore(scoreWithLyrics(true), 900);
    const off = layoutScore(scoreWithLyrics(false), 900);
    expect(off.systems[0].height).toBeLessThan(on.systems[0].height);
    expect(Number(render(false).getAttribute('height'))).toBe(Math.round(off.height));
    expect(Number(render(true).getAttribute('height'))).toBe(Math.round(on.height));
  });

  it('小节线只画音符区：y1/y2 取排版的 top/bottom，止于歌词顶边之上', () => {
    const layout = layoutScore(scoreWithLyrics(true), 900);
    const svg = document.createElementNS(SVG_NS, 'svg');
    renderScore(svg, layout);
    const system = layout.systems[0];
    const bl = system.barlines[0];
    expect(bl).toBeTruthy();
    const lines = Array.from(svg.querySelectorAll('.jp-barline'));
    expect(lines.length).toBeGreaterThan(0);

    const lyricBlock = system.blocks.find((b) => b.lyric)!;
    // 歌词 y 写在 block 组内（相对数字中心），小节线写在 system 组内
    const lyricTopY =
      system.centerY + CAP_HEIGHT / 2 + lyricBlock.lyricOffset - LYRIC_FONT_SIZE / 2;
    for (const line of lines) {
      expect(Number(line.getAttribute('y1'))).toBeCloseTo(bl.top, 6);
      expect(Number(line.getAttribute('y2'))).toBeCloseTo(bl.bottom, 6);
      expect(Number(line.getAttribute('y2'))).toBeLessThanOrEqual(
        lyricTopY - BARLINE_LYRIC_GAP + 1e-9,
      );
    }
    // 旧版是整行竖线（8 → height-8），现在明显短于一行
    expect(bl.bottom - bl.top).toBeLessThan(system.height - 14);
  });

  it('导出的独立 SVG 文本同样遵守开关', () => {
    const of = (showLyrics: boolean) => {
      const score = scoreWithLyrics(showLyrics);
      return scoreToSvgString(score, layoutScore(score, 900));
    };
    // 样式表里恒有 .jp-lyric 规则，故只数实际的文本节点
    expect(of(true).split('class="jp-lyric"').length - 1).toBe(4);
    expect(of(false)).not.toContain('class="jp-lyric"');
  });
});

/** 带完整歌曲信息（标题 / 副标题 / 演唱 / 词曲作者）的谱面 */
function scoreWithMeta(): Score {
  return makeScore(
    {
      title: '茉莉花',
      subtitle: '江苏民歌',
      singer: '邓丽君',
      composer: '张三',
      lyricist: '李四',
      timeSig: { num: 2, den: 4 },
    },
    [makeBar([makeNote(1, 4), makeNote(2, 4)])],
  );
}

function renderOf(score: Score): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  renderScore(svg, layoutScore(score, 900));
  return svg;
}

describe('renderScore：页眉（歌曲信息）画进 SVG，四处导出共用同一版式', () => {
  it('标题 / 副标题 / 演唱 / 调号拍号 / 速度 / 词曲作者各渲染一条 text', () => {
    const svg = renderOf(scoreWithMeta());
    expect(textsOf(Array.from(svg.querySelectorAll('.jp-title')))).toEqual(['茉莉花']);
    expect(textsOf(Array.from(svg.querySelectorAll('.jp-subtitle')))).toEqual(['江苏民歌']);
    expect(textsOf(Array.from(svg.querySelectorAll('.jp-singer')))).toEqual(['演唱  邓丽君']);
    expect(textsOf(Array.from(svg.querySelectorAll('.jp-key')))).toEqual(['1=C 2/4']);
    expect(textsOf(Array.from(svg.querySelectorAll('.jp-tempo')))).toEqual(['♩=100']);
    expect(textsOf(Array.from(svg.querySelectorAll('.jp-credit')))).toEqual(['李四 作词', '张三 作曲']);
    const title = svg.querySelector('.jp-title');
    expect(title?.getAttribute('text-anchor')).toBe('middle');
    expect(title?.getAttribute('letter-spacing')).toBe(String(TITLE_TRACKING));
  });

  it('页眉在谱表上方：第一行谱表整体从 header.height 起排', () => {
    const score = scoreWithMeta();
    const layout = layoutScore(score, 900);
    const transform = renderOf(score).querySelector('g.jp-system')?.parentElement?.getAttribute('transform');
    const match = /translate\(\s*0,\s*([-\d.]+)\s*\)/.exec(transform ?? '');
    expect(Number(match?.[1])).toBeCloseTo(layout.header.height, 6);
  });

  it('没填的项不渲染：空谱面只剩调号拍号与速度', () => {
    const svg = renderOf(makeScore({ timeSig: { num: 2, den: 4 } }, [makeBar([makeNote(1, 4)])]));
    expect(svg.querySelector('.jp-title')).toBeNull();
    expect(svg.querySelector('.jp-subtitle')).toBeNull();
    expect(svg.querySelector('.jp-singer')).toBeNull();
    expect(svg.querySelector('.jp-credit')).toBeNull();
    expect(svg.querySelectorAll('.jp-key').length).toBe(1);
  });

  it('导出的独立 SVG 带页眉文本与页眉样式', () => {
    const score = scoreWithMeta();
    const text = scoreToSvgString(score, layoutScore(score, 900));
    expect(text).toContain('class="jp-title"');
    expect(text).toContain('演唱  邓丽君');
    expect(text).toContain('.jp-title');
  });
});
