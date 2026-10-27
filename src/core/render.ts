import {
  arcLift,
  scaledSize,
  type Arc,
  type Barline,
  type HeaderLayout,
  type LayoutResult,
  type NoteBlock,
  type SystemLayout,
} from './layout';
import type { Score } from './model';
import {
  BAR_NUMBER_FONT,
  CAP_HEIGHT,
  DASH_W,
  DIGIT_W,
  DOTTED_DOT_DX,
  DOT_GAP,
  DOT_OFFSET,
  DOT_R,
  FONT_SIZE,
  LEFT_MARGIN,
  LYRIC_FONT_SIZE,
  SYSTEM_GAP,
  TRIPLET_UP,
  UNDERLINE_GAP,
  UNDERLINE_OFFSET,
} from './metrics';

export const SVG_NS = 'http://www.w3.org/2000/svg';

export function svgEl<K extends keyof SVGElementTagNameMap>(
  name: K,
  attrs: Record<string, string | number> = {},
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

function appendText(
  parent: Element,
  attrs: Record<string, string | number>,
  text: string,
): void {
  const node = svgEl('text', attrs);
  node.textContent = text;
  parent.appendChild(node);
}

/** 休止符「0」：居中落在给定 x 上 */
function appendRestDigit(parent: Element, x: number): void {
  appendText(
    parent,
    {
      class: 'jp-digit',
      x,
      y: 0,
      'text-anchor': 'middle',
      'dominant-baseline': 'central',
      'font-size': FONT_SIZE,
    },
    '0',
  );
}

function underlineY(level: number): number {
  return CAP_HEIGHT / 2 + UNDERLINE_OFFSET + level * UNDERLINE_GAP;
}

/**
 * 延长线（横线）长度：固定一根普通短横，不随拍份宽度拉伸。
 * 横线中心取自排版层的拍份网格（显式延长线的 cx / 补出横线的 dashSlots），
 * 与该拍上普通数字的中心同一位置 → 谱面上横线与音符上下对齐。
 */
const DASH_LEN = DASH_W - 4;

function dashLeft(block: NoteBlock): number {
  return block.cx - DASH_LEN / 2;
}

function dashRight(block: NoteBlock): number {
  return block.cx + DASH_LEN / 2;
}

/** 一根横线：居中落在给定 x 上 */
function appendDashLine(parent: Element, center: number, len: number): void {
  parent.appendChild(
    svgEl('line', {
      class: 'jp-dash-line',
      x1: center - len / 2,
      x2: center + len / 2,
      y1: 0,
      y2: 0,
    }),
  );
}

function underlineLeft(block: NoteBlock): number {
  if (block.kind === 'dash') return dashLeft(block);
  return block.cx - DIGIT_W / 2;
}

function underlineRight(block: NoteBlock): number {
  if (block.kind === 'dash') return dashRight(block);
  return block.cx + DIGIT_W / 2 + (block.dotted ? DOTTED_DOT_DX : 0);
}

function renderBlock(g: SVGGElement, block: NoteBlock, centerY: number): void {
  const group = svgEl('g', {
    class: `jp-block jp-${block.kind}`,
    'data-event-id': block.eventId,
    'data-bar': block.barIndex,
    'data-index': block.eventIndex,
    transform: `translate(0, ${centerY})`,
  });

  // 命中区域（透明），便于点击选中
  group.appendChild(
    svgEl('rect', {
      class: 'jp-hit',
      x: block.x - 1,
      y: -block.topExtent - 4,
      width: block.width + 2,
      height: block.topExtent + block.bottomExtent + 8,
    }),
  );

  if (block.kind === 'dash') {
    appendDashLine(group, block.cx, DASH_LEN);
    for (let i = 0; i < block.underlines; i += 1) {
      const y = underlineY(i);
      group.appendChild(
        svgEl('line', {
          class: 'jp-underline',
          x1: underlineLeft(block),
          x2: underlineRight(block),
          y1: y,
          y2: y,
        }),
      );
    }
    g.appendChild(group);
    return;
  }

  if (block.kind === 'rest') {
    // 二分 / 全休止符：排版层已把它们拆成若干四分休止符的位置（对齐节拍网格），
    // 逐个落笔；其余休止符（含附点休止符）只有一个「0」，落在记号盒左端的 cx。
    const slots = block.restSlots;
    if (slots && slots.length > 1) {
      for (const sx of slots) appendRestDigit(group, sx);
    } else {
      appendRestDigit(group, block.cx);
    }
  } else {
    appendText(
      group,
      {
        class: 'jp-digit',
        x: block.cx,
        y: 0,
        'text-anchor': 'middle',
        'dominant-baseline': 'central',
        'font-size': FONT_SIZE,
      },
      String(block.degree),
    );
  }
  // 二分/全音符：模型里只有一个事件，横线（延长线）在此按拍数补画。
  // 落笔 x 由排版层给出（dashSlots）：每根横线各占一拍，取该拍上普通音符的记号位置，
  // 故横线与上下小节同一拍的音符竖向对齐；长度与显式延长线记号同长，不随拍份宽度拉伸
  if (block.kind === 'note' && block.dashes > 0) {
    const unit = block.width / (block.dashes + 1);
    const len = Math.min(DASH_LEN, unit - 4);
    if (len > 0) {
      for (let i = 0; i < block.dashes; i += 1) {
        appendDashLine(group, block.dashSlots?.[i] ?? block.x + unit * (i + 1.5), len);
      }
    }
  }

  if (block.kind === 'note' && block.accidental !== 'natural') {
    appendText(
      group,
      {
        class: 'jp-accidental',
        x: block.cx - DIGIT_W / 2 - 4,
        y: -(CAP_HEIGHT / 2 + 5),
        'text-anchor': 'middle',
        'dominant-baseline': 'central',
        'font-size': 17,
      },
      block.accidental === 'sharp' ? '#' : 'b',
    );
  }

  if (block.triplet) {
    appendText(
      group,
      {
        class: 'jp-triplet',
        x: block.cx,
        y: -(CAP_HEIGHT / 2 + TRIPLET_UP),
        'text-anchor': 'middle',
        'dominant-baseline': 'central',
        'font-size': 14,
      },
      '3',
    );
  }

  for (let i = 0; i < block.dotsAbove; i += 1) {
    group.appendChild(
      svgEl('circle', {
        class: 'jp-octave-dot',
        cx: block.cx,
        cy: -(CAP_HEIGHT / 2 + DOT_OFFSET + i * DOT_GAP),
        r: DOT_R,
      }),
    );
  }

  for (let i = 0; i < block.underlines; i += 1) {
    group.appendChild(
      svgEl('line', {
        class: 'jp-underline',
        x1: underlineLeft(block),
        x2: underlineRight(block),
        y1: underlineY(i),
        y2: underlineY(i),
      }),
    );
  }

  for (let i = 0; i < block.dotsBelow; i += 1) {
    const y =
      CAP_HEIGHT / 2 +
      UNDERLINE_OFFSET +
      block.underlines * UNDERLINE_GAP +
      DOT_OFFSET +
      i * DOT_GAP;
    group.appendChild(
      svgEl('circle', { class: 'jp-octave-dot', cx: block.cx, cy: y, r: DOT_R }),
    );
  }

  if (block.dotted) {
    group.appendChild(
      svgEl('circle', {
        class: 'jp-dotted-dot',
        cx: block.cx + DIGIT_W / 2 + DOTTED_DOT_DX,
        cy: 0,
        r: DOT_R,
      }),
    );
  }

  if (block.lyric) {
    // 基线由排版层给出（block.lyricOffset）：音符带下划线 / 低音八度点时歌词往下让位，
    // 字号写进属性（用户单位）随谱面字号整体缩放 —— 见 metrics.ts 的 lyricBaseline
    appendText(
      group,
      {
        class: 'jp-lyric',
        x: block.cx,
        y: CAP_HEIGHT / 2 + block.lyricOffset,
        'text-anchor': 'middle',
        'dominant-baseline': 'central',
        'font-size': LYRIC_FONT_SIZE,
      },
      block.lyric,
    );
  }

  g.appendChild(group);
}

/**
 * 小节线：长度由排版层给出（barline.top / barline.bottom），只覆盖音符区，
 * 不伸进歌词带 —— 歌词行里竖线穿过汉字会读成表格线（见 layout.ts 排版步骤 5）。
 */
function renderBarline(g: SVGGElement, barline: Barline): void {
  const { x, kind, top: y1, bottom: y2 } = barline;
  const cy = (y1 + y2) / 2;
  if (kind === 'normal') {
    g.appendChild(svgEl('line', { class: 'jp-barline', x1: x, x2: x, y1, y2 }));
    return;
  }
  if (kind === 'final') {
    g.appendChild(svgEl('line', { class: 'jp-barline', x1: x - 3.5, x2: x - 3.5, y1, y2 }));
    g.appendChild(svgEl('line', { class: 'jp-barline jp-barline-thick', x1: x, x2: x, y1, y2 }));
    return;
  }
  if (kind === 'repeat-start') {
    g.appendChild(svgEl('line', { class: 'jp-barline jp-barline-thick', x1: x, x2: x, y1, y2 }));
    g.appendChild(svgEl('line', { class: 'jp-barline', x1: x + 2, x2: x + 2, y1, y2 }));
    g.appendChild(svgEl('circle', { class: 'jp-repeat-dot', cx: x + 4.2, cy: cy - 7, r: 2 }));
    g.appendChild(svgEl('circle', { class: 'jp-repeat-dot', cx: x + 4.2, cy: cy + 7, r: 2 }));
    return;
  }
  if (kind === 'repeat-end') {
    g.appendChild(svgEl('line', { class: 'jp-barline', x1: x - 2, x2: x - 2, y1, y2 }));
    g.appendChild(svgEl('line', { class: 'jp-barline jp-barline-thick', x1: x, x2: x, y1, y2 }));
    g.appendChild(svgEl('circle', { class: 'jp-repeat-dot', cx: x - 4.2, cy: cy - 7, r: 2 }));
    g.appendChild(svgEl('circle', { class: 'jp-repeat-dot', cx: x - 4.2, cy: cy + 7, r: 2 }));
  }
}

function renderArc(g: SVGGElement, system: SystemLayout, arc: Arc): void {
  // 弧线画在数字上方；若组内音符带高八度点则再抬高，避免与八度点重叠
  const clearance = arc.clearance > 0 ? DOT_OFFSET + arc.clearance * DOT_GAP + 3 : 6;
  const base = system.centerY - CAP_HEIGHT / 2 - clearance;
  const lift = arcLift(arc);
  const midX = (arc.x1 + arc.x2) / 2;
  const d = `M ${arc.x1} ${base} Q ${midX} ${base - lift * 2} ${arc.x2} ${base}`;
  g.appendChild(
    svgEl('path', {
      class: `jp-arc jp-arc-${arc.kind}${arc.partial !== 'none' ? ' jp-arc-partial' : ''}`,
      d,
      fill: 'none',
      'data-note-count': arc.noteCount,
    }),
  );
}

/**
 * 下划线连接：把相邻记号（同一视觉行、同一小节、同一拍份）的下划线按每深度级成一条
 * 连续线段，而不是每记号单独短线段。不同拍份（及小节线）下划线不连接，符合简谱惯例。
 */
function renderUnderlineConnectors(g: SVGGElement, system: SystemLayout): void {
  const blocks = system.blocks;
  for (let i = 1; i < blocks.length; i += 1) {
    const prev = blocks[i - 1];
    const curr = blocks[i];
    if (prev.barIndex !== curr.barIndex) continue;
    if (prev.beatIndex !== curr.beatIndex) continue;
    if (prev.eventIndex + 1 !== curr.eventIndex) continue;

    const shared = Math.min(prev.underlines, curr.underlines);
    if (shared <= 0) continue;

    const left = underlineRight(prev);
    const right = underlineLeft(curr);
    if (right <= left + 0.5) continue;

    for (let level = 0; level < shared; level += 1) {
      const y = system.centerY + underlineY(level);
      g.appendChild(
        svgEl('line', {
          class: 'jp-underline',
          x1: left,
          x2: right,
          y1: y,
          y2: y,
        }),
      );
    }
  }
}

function renderSystem(g: SVGGElement, system: SystemLayout): void {
  const sysGroup = svgEl('g', {
    class: 'jp-system',
    'data-system': system.index,
    transform: `translate(${LEFT_MARGIN}, 0)`,
  });

  // 小节空白命中区（点击空白槽 -> 光标移到该小节末尾）
  for (const slot of system.barSlots) {
    sysGroup.appendChild(
      svgEl('rect', {
        class: 'jp-bar-hit',
        x: slot.x,
        y: 0,
        width: slot.width,
        height: system.height,
        'data-bar': slot.barIndex,
      }),
    );
  }

  for (const barline of system.barlines) {
    renderBarline(sysGroup, barline);
  }

  for (const label of system.barNumbers) {
    appendText(
      sysGroup,
      {
        class: 'jp-bar-number',
        x: label.x,
        y: 12,
        'text-anchor': 'start',
        'dominant-baseline': 'central',
        'font-size': BAR_NUMBER_FONT,
      },
      `${label.barIndex + 1}.`,
    );
  }

  for (const arc of system.arcs) renderArc(sysGroup, system, arc);

  const blocksGroup = svgEl('g', { class: 'jp-blocks' });
  for (const block of system.blocks) renderBlock(blocksGroup, block, system.centerY);
  sysGroup.appendChild(blocksGroup);
  renderUnderlineConnectors(sysGroup, system);

  g.appendChild(sysGroup);
}

/**
 * 页眉（歌曲信息）：标题 / 副标题 / 演唱 / 调号拍号 / 速度 / 词曲作者。
 * 坐标由排版层 layoutHeader 给出（整页坐标，y 为基线），渲染层只落笔；
 * 画在 SVG 里 => 编辑器、导出 SVG / PNG、打印四处版式完全一致。
 */
function renderHeader(g: SVGGElement, header: HeaderLayout): void {
  const group = svgEl('g', { class: 'jp-header' });
  for (const item of header.items) {
    const attrs: Record<string, string | number> = {
      class: `jp-${item.role}`,
      x: item.x,
      y: item.y,
      'text-anchor': item.anchor,
      'font-size': item.fontSize,
    };
    if (item.tracking > 0) attrs['letter-spacing'] = item.tracking;
    appendText(group, attrs, item.text);
  }
  g.appendChild(group);
}

/**
 * 渲染整份乐谱到给定 <svg> 元素。
 * 内容按标准字号的用户单位绘制；viewBox 取排版尺寸，width/height 取「排版尺寸 × 字号系数」，
 * 浏览器据此整体缩放矢量内容 => 谱面字号改变时数字、下划线、八度点、歌词、线宽等比缩放。
 */
export function renderScore(svg: SVGSVGElement, layout: LayoutResult): void {
  while (svg.firstChild) svg.removeChild(svg.firstChild);

  const size = scaledSize(layout);
  svg.setAttribute('width', String(size.width));
  svg.setAttribute('height', String(size.height));
  svg.setAttribute('viewBox', `0 0 ${Math.round(layout.width)} ${Math.round(layout.height)}`);
  svg.setAttribute('class', 'jp-score');

  const root = svgEl('g', { class: 'jp-root' });
  svg.appendChild(root);

  renderHeader(root, layout.header);

  let offset = layout.header.height;
  for (const system of layout.systems) {
    const wrapper = svgEl('g', { transform: `translate(0, ${offset})` });
    renderSystem(wrapper, system);
    root.appendChild(wrapper);
    offset += system.height + SYSTEM_GAP;
  }
}

/** 生成独立可保存的 SVG 文本 */
export function scoreToSvgString(score: Score, layout: LayoutResult): string {
  const clone = document.createElementNS(SVG_NS, 'svg');
  renderScore(clone, layout);
  clone.setAttribute('xmlns', SVG_NS);
  clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
  const meta = score.meta;
  const title = meta.title || '简谱';
  const header = `${title}${meta.composer ? ' — ' + meta.composer : ''}`;
  const style = `
  <style>
    .jp-score { background: #ffffff; }
    .jp-digit, .jp-accidental, .jp-triplet, .jp-lyric, .jp-bar-number {
      font-family: 'SFMono-Regular', 'Menlo', 'Consolas', 'Liberation Mono', 'Courier New', 'Noto Sans Mono CJK SC', 'Microsoft YaHei', monospace;
      fill: #111111;
    }
    .jp-digit { font-weight: 600; }
    .jp-lyric { fill: #333333; }
    .jp-bar-number { fill: #888888; }
    .jp-title, .jp-subtitle, .jp-singer, .jp-key, .jp-tempo, .jp-credit {
      font-family: 'Songti SC', 'STSong', 'SimSun', 'Noto Serif CJK SC', 'Source Han Serif SC', 'Microsoft YaHei', serif;
      fill: #111111;
    }
    .jp-title { font-weight: 700; }
    .jp-subtitle, .jp-singer, .jp-key, .jp-tempo, .jp-credit { fill: #222222; }
    .jp-singer, .jp-credit { font-style: italic; }
    .jp-underline, .jp-dash-line { stroke: #111111; stroke-width: 1.6; stroke-linecap: round; }
    .jp-octave-dot, .jp-dotted-dot, .jp-repeat-dot { fill: #111111; }
    .jp-barline { stroke: #111111; stroke-width: 1.2; }
    .jp-barline-thick { stroke-width: 3; }
    .jp-arc { stroke: #111111; stroke-width: 1.3; }
    .jp-hit, .jp-bar-hit { fill: transparent; }
  </style>`;
  const inner = clone.innerHTML;
  const size = scaledSize(layout);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="${SVG_NS}" width="${size.width}" height="${size.height}" viewBox="0 0 ${Math.round(layout.width)} ${Math.round(layout.height)}">${style}${inner}</svg>\n<!-- ${header} -->\n`;
}
