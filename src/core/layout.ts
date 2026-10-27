import {
  barBeatLength,
  durationBeats,
  isNote,
  makeBar,
  measureBeats,
  noteBeats,
  restBeats,
  type Accidental,
  type Bar,
  type BarlineKind,
  type Degree,
  type Duration,
  type NoteEvent,
  type Score,
  type ScoreEvent,
  type TimeSignature,
} from './model';
import { formatTonic } from './constants';
import {
  ACCIDENTAL_UP,
  ACCIDENTAL_W,
  ARC_LIFT,
  BARLINE_LYRIC_GAP,
  BARLINE_MIN_BELOW,
  BARLINE_TOP_ABOVE,
  BAR_PADDING,
  belowStack,
  CAP_HEIGHT,
  DASH_UNIT_W,
  DASH_W,
  DIGIT_W,
  DOTTED_DOT_W,
  DOT_GAP,
  DOT_OFFSET,
  DOT_R,
  fontScaleFor,
  HEADER_BASELINE_RATIO,
  HEADER_BLOCK_GAP,
  HEADER_BOTTOM_PAD,
  HEADER_LINE_GAP,
  HEADER_META_FONT_SIZE,
  HEADER_SIDE_GAP,
  HEADER_TOP_PAD,
  inkHalfRight,
  LEFT_MARGIN,
  LYRIC_FONT_SIZE,
  lyricBaseline,
  lyricWidth,
  RIGHT_MARGIN,
  SUBTITLE_FONT_SIZE,
  SYSTEM_GAP,
  SYSTEM_TOP_PAD,
  textWidth,
  TITLE_FONT_SIZE,
  TITLE_LINE_GAP,
  TITLE_TRACKING,
  TRIPLET_UP,
  UNDERLINE_GAP,
  UNDERLINE_OFFSET,
} from './metrics';

export interface NoteBlock {
  eventId: string;
  barIndex: number;
  eventIndex: number;
  /**
   * 延长线（横线）根数：模型里二分/全音符只是一个事件，简谱却写作
   * 「数字 + 横线」，横线由排版层按拍数补出，渲染层据此落笔。
   */
  dashes: number;

  kind: 'note' | 'rest' | 'dash';
  /** 块左边缘（system 内坐标） */
  x: number;
  width: number;
  /** 数字（或延长线）中心 x */
  cx: number;
  /**
   * 二分 / 全休止符按「拆成若干四分休止符」排开后，每个「0」的中心 x
   * （其余记号为 undefined）。位置取自拍份网格，所以休止符与别处小节里的
   * 四分休止符落在同一横向位置，节拍网格处处对齐。
   */
  restSlots?: number[];
  /**
   * 长时值音符（二分 / 全音符）补出的每根延长线的中心 x（其余记号为 undefined）。
   * 位置取自拍份网格，与「落在同一拍上的普通音符」是同一记号位置
   * （拍份左边缘 + 半个数字宽），故横线与上下小节的音符竖向对齐。
   */
  dashSlots?: number[];
  /** 块所属拍份（0-based，同一小节内），用于下划线连接 */
  beatIndex: number;
  degree: Degree;
  octave: number;
  accidental: Accidental;
  duration: Duration;
  dotted: boolean;
  triplet: boolean;
  lyric: string;
  /**
   * 歌词基线（相对数字中心，用户单位）；无歌词时为 0。
   * 由 metrics.ts 的 lyricBaseline() 给出：音符带下划线 / 低音八度点时往下让位，
   * 渲染层直接用它落笔（render.ts），排版层用它撑行高（bottomExtent）。
   */
  lyricOffset: number;
  underlines: number;
  dotsAbove: number;
  dotsBelow: number;
  topExtent: number;
  bottomExtent: number;
}

export interface BarSlot {
  barIndex: number;
  x: number;
  /** 小节宽度：行内宽度按每行小节数平分（每行内小节宽度相同） */
  width: number;
  /**
   * 拍份列宽（拍份单位：四分音符 = 1 列，八分音符 = 0.5 拍份）。
   * 全曲所有小节共用同一套列宽 → 节拍网格在整页处处对齐。
   */
  slotWidths: number[];
  /** 平均拍份宽度 = 小节内容宽 / 拍份数（列宽不等宽时只是均值，定位请用 slotPosition） */
  slotWidth: number;
  leftBarline: BarlineKind;
  rightBarline: BarlineKind;
}

/**
 * 小节内拍份坐标 t（四分音符 = 1，可含小数）→ 相对小节内容左边缘的 x 偏移。
 * 列宽非等宽，故按列累加、列内线性插值。
 */
export function slotPosition(slot: BarSlot, t: number): number {
  const count = slot.slotWidths.length;
  if (count === 0) return 0;
  const j = Math.max(0, Math.min(count - 1, Math.floor(t + 1e-9)));
  let x = 0;
  for (let k = 0; k < j; k += 1) x += slot.slotWidths[k];
  return x + (Math.min(t, count) - j) * slot.slotWidths[j];
}

export interface Barline {
  x: number;
  kind: BarlineKind;
  /** 顶端 y（相对 system 顶部）：数字顶边之上 BARLINE_TOP_ABOVE */
  top: number;
  /** 底端 y：本行最深的下划线 / 低音八度点，且不伸进歌词带（见排版步骤 5） */
  bottom: number;
}

export interface Arc {
  kind: 'tie' | 'slur';
  x1: number;
  x2: number;
  /** 跨行断开的续接弧线：'both' 表示两端都续接（整段都在别的行里） */
  partial: 'none' | 'start' | 'end' | 'both';
  /** 弧线两端（或整组音符）的最高八度点数量，用于抬高弧线避免重叠 */
  clearance: number;
  /** 弧线覆盖的音符数：连音线恒为 2，圆滑线可以是 3 个以上 */
  noteCount: number;
}

/** 圆滑线覆盖的音符越多，弧线略微抬高，读起来是一条而不是一串短线 */
export function arcLift(arc: Arc): number {
  if (arc.kind !== 'slur' || arc.noteCount <= 2) return ARC_LIFT;
  return ARC_LIFT + Math.min(12, (arc.noteCount - 2) * 2.5);
}

export interface BarNumberLabel {
  barIndex: number;
  x: number;
}

export interface SystemLayout {
  index: number;
  startBarIndex: number;
  barSlots: BarSlot[];
  blocks: NoteBlock[];
  barlines: Barline[];
  arcs: Arc[];
  barNumbers: BarNumberLabel[];
  topPad: number;
  bottomPad: number;
  height: number;
  width: number;
  /** system 内容中心线相对 system 顶部的偏移 */
  centerY: number;
}

/** 页眉一行文字的角色：渲染层据此落 class（jp-title / jp-subtitle / jp-singer / jp-key / jp-tempo / jp-credit） */
export type HeaderRole = 'title' | 'subtitle' | 'singer' | 'key' | 'tempo' | 'credit';

/** 页眉里的一段文字：坐标是整页坐标（含左边距），y 为基线 */
export interface HeaderText {
  role: HeaderRole;
  text: string;
  x: number;
  y: number;
  fontSize: number;
  anchor: 'start' | 'middle' | 'end';
  /** 字距（渲染为 SVG letter-spacing），标题用 */
  tracking: number;
}

export interface HeaderLayout {
  items: HeaderText[];
  /** 页眉带总高（含顶部留白与到第一行谱表的间距） */
  height: number;
}

export interface LayoutResult {
  systems: SystemLayout[];
  /** 页眉（标题 / 演唱 / 词曲作者 / 调号拍号速度）：第一行谱表从 header.height 开始 */
  header: HeaderLayout;
  /** 谱面宽 / 高：标准字号下的 SVG 用户单位（屏幕像素 = 本值 × scale，见 scaledSize） */
  width: number;
  height: number;
  /** 字号缩放系数（meta.fontSize / FONT_SIZE）：渲染层按它整体放大谱面 */
  scale: number;
}

/**
 * 谱面在屏幕上的实际尺寸（CSS 像素）：排版尺寸（标准字号单位）× 字号系数。
 * SVG 的 viewBox 用 width/height（标准单位），width/height 属性用本结果，
 * 浏览器便整体缩放矢量内容——数字、线宽、八度点、歌词等比放大。
 */
export function scaledSize(layout: LayoutResult): { width: number; height: number } {
  return {
    width: Math.max(1, Math.round(layout.width * layout.scale)),
    height: Math.max(1, Math.round(layout.height * layout.scale)),
  };
}

/** 页眉一行的行高 */
function headerLineHeight(fontSize: number): number {
  return fontSize + HEADER_LINE_GAP;
}

/** 一行的基线 y：顶边 + 字号 × 比例（不量字体度量，CJK / 拉丁都按同一比例取） */
function headerBaseline(top: number, fontSize: number): number {
  return top + fontSize * HEADER_BASELINE_RATIO;
}

/** 一行的底部：基线 + 字号余量（降部） */
function headerBottom(baseline: number, fontSize: number): number {
  return baseline + fontSize * (1 - HEADER_BASELINE_RATIO);
}

/** 左右侧栏：整栏一起定位、整体下移 */
interface HeaderColumn {
  lines: { role: HeaderRole; text: string }[];
  /** 首行顶边 y（改它就整栏下移） */
  top: number;
  /** anchor 对应的 x：左栏 = 左边缘，右栏 = 右边缘 */
  x: number;
  anchor: 'start' | 'end';
  width: number;
}

/** 侧栏底部（最后一行的底部）；空栏退回顶边，不参与高度计算 */
function columnBottom(col: HeaderColumn): number {
  if (col.lines.length === 0) return col.top;
  const lastTop = col.top + (col.lines.length - 1) * headerLineHeight(HEADER_META_FONT_SIZE);
  return headerBottom(headerBaseline(lastTop, HEADER_META_FONT_SIZE), HEADER_META_FONT_SIZE);
}

/** 把侧栏逐行写进 items（行高固定为 HEADER_META_FONT_SIZE + HEADER_LINE_GAP） */
function pushColumn(items: HeaderText[], col: HeaderColumn): void {
  col.lines.forEach((line, i) => {
    const top = col.top + i * headerLineHeight(HEADER_META_FONT_SIZE);
    items.push({
      role: line.role,
      text: line.text,
      x: col.x,
      y: headerBaseline(top, HEADER_META_FONT_SIZE),
      fontSize: HEADER_META_FONT_SIZE,
      anchor: col.anchor,
      tracking: 0,
    });
  });
}

/**
 * 页眉排版（纯计算）：歌曲信息排在第一行谱表上方，版式取自印刷简谱歌本——
 *   第 1 行：标题（居中 + 宽字距），**独占一行**，左右两侧不放任何文字；
 *   第 2 行起（居中）：副标题 → 「演唱 ×××」；
 *   居中栏之下空出 HEADER_BLOCK_GAP 的「信息带」：左栏「1=bE 2/4」「♩=80」贴左边距，
 *   右栏「×× 作词」「×× 作曲」贴右边距，两栏同一水平带。
 * 调号 / 速度 / 词曲作者一律下移到居中栏之下，于是标题与演唱都不必跟小字抢同一行
 * （旧版把词曲作者压在标题基线、把调号速度压在演唱基线，整块页眉读起来很挤）。
 * 窄页下左右两栏彼此相撞时把右栏整栏下移到左栏之下，页眉带随之变高，
 * 谱表整体下移 —— 不裁剪、不重叠。
 */
export function layoutHeader(score: Score, pageWidth: number): HeaderLayout {
  const meta = score.meta;
  const items: HeaderText[] = [];
  const cx = pageWidth / 2;

  // 1) 居中栏：标题独占一行 → 副标题 → 演唱
  let centerY = HEADER_TOP_PAD;

  const title = meta.title.trim();
  if (title) {
    // letter-spacing 在每个字符后都追加一份字距（含末尾），居中时补回半个字距
    items.push({
      role: 'title',
      text: title,
      x: cx + TITLE_TRACKING / 2,
      y: headerBaseline(centerY, TITLE_FONT_SIZE),
      fontSize: TITLE_FONT_SIZE,
      anchor: 'middle',
      tracking: TITLE_TRACKING,
    });
    centerY += TITLE_FONT_SIZE + TITLE_LINE_GAP;
  }

  const subtitle = meta.subtitle.trim();
  if (subtitle) {
    items.push({
      role: 'subtitle',
      text: subtitle,
      x: cx,
      y: headerBaseline(centerY, SUBTITLE_FONT_SIZE),
      fontSize: SUBTITLE_FONT_SIZE,
      anchor: 'middle',
      tracking: 0,
    });
    centerY += SUBTITLE_FONT_SIZE + HEADER_LINE_GAP;
  }

  const singer = meta.singer.trim();
  if (singer) {
    const text = `演唱  ${singer}`;
    items.push({
      role: 'singer',
      text,
      x: cx,
      y: headerBaseline(centerY, SUBTITLE_FONT_SIZE),
      fontSize: SUBTITLE_FONT_SIZE,
      anchor: 'middle',
      tracking: 0,
    });
    centerY += SUBTITLE_FONT_SIZE + HEADER_LINE_GAP;
  }
  const centerBottom = centerY;

  // 2) 信息带顶边：居中栏之下。没有任何居中内容时（只有调号拍号与速度）不额外留白，
  //    否则空谱面的页眉会凭空多出一段空白。
  const bandTop = centerBottom > HEADER_TOP_PAD ? centerBottom + HEADER_BLOCK_GAP : HEADER_TOP_PAD;

  // 3) 左栏：调号 + 拍号、速度
  const left: HeaderColumn = {
    lines: [
      { role: 'key', text: `1=${formatTonic(meta.tonic)} ${meta.timeSig.num}/${meta.timeSig.den}` },
      { role: 'tempo', text: `♩=${meta.tempo}` },
    ],
    top: bandTop,
    x: LEFT_MARGIN,
    anchor: 'start',
    width: 0,
  };
  left.width = left.lines.reduce((acc, l) => Math.max(acc, textWidth(l.text, HEADER_META_FONT_SIZE)), 0);

  // 4) 右栏：词曲作者（与信息带左栏同一水平带）
  const credits: { role: HeaderRole; text: string }[] = [];
  if (meta.lyricist.trim()) credits.push({ role: 'credit', text: `${meta.lyricist.trim()} 作词` });
  if (meta.composer.trim()) credits.push({ role: 'credit', text: `${meta.composer.trim()} 作曲` });
  const right: HeaderColumn = {
    lines: credits,
    top: bandTop,
    x: pageWidth - RIGHT_MARGIN,
    anchor: 'end',
    width: credits.reduce((acc, l) => Math.max(acc, textWidth(l.text, HEADER_META_FONT_SIZE)), 0),
  };

  // 5) 冲突处理：窄页下右栏压到左栏时，右栏整栏下移到左栏之下，页眉带随之变高
  const rightLeft = right.x - right.width;
  const hitsLeft = right.lines.length > 0 && rightLeft < left.x + left.width + HEADER_SIDE_GAP;
  if (hitsLeft) {
    right.top = Math.max(bandTop, columnBottom(left) + HEADER_LINE_GAP);
  }

  pushColumn(items, left);
  pushColumn(items, right);

  const bottom = Math.max(centerBottom, columnBottom(left), columnBottom(right));
  return { items, height: bottom + HEADER_BOTTOM_PAD };
}

interface BlockInfo {
  system: number;
  block: NoteBlock;
}

/** 按文档顺序列出所有音符（休止符与延长线不打断圆滑线） */
interface NoteRef {
  id: string;
  barIndex: number;
  eventIndex: number;
  note: NoteEvent;
}

/** 记号自然宽度（glyph box），用于拍份列宽下限 */
function blockNaturalWidth(e: ScoreEvent, dashBeats: number, showLyrics: boolean): number {
  if (e.kind === 'dash') return DASH_W;
  if (e.kind === 'rest') {
    // 全休止符占满整小节、二分休止符占两拍：自然宽度须随时值放大，
    // 否则窄容器里整小节会被压到装不下休止符记号
    if (e.duration === 1) return DIGIT_W * 4;
    if (e.duration === 2) return DIGIT_W * 2;
    return DIGIT_W;
  }
  const dashes = dashCount(noteBeats(e), dashBeats);
  let w = DIGIT_W;
  // 满两拍的音符写作「数字 + 延长线」，附点的那半拍也由横线表达 → 不写附点
  if (e.dotted && dashes === 0) w += DOTTED_DOT_W;
  if (e.accidental !== 'natural') w += ACCIDENTAL_W;
  // 长时值音符写作「数字 + 延长线」：每根横线至少占一个拍份单位，
  // 否则紧凑网格下渲染层的横线区会塌陷成一小段
  w += dashes * DASH_UNIT_W;
  // 歌词音节居中落在数字中心（= 盒左边缘 + 升降号宽 + 半个数字宽）下方：
  // ① 音节的右半边要留在盒内；② 相邻音节的中心相距正好等于记号盒宽（两者中心都取
  // 各自盒子的同一偏移），所以盒宽还须 >= 整个音节宽，相邻音节才不会互相压字。
  // 只有「记号盒必须撑住记号」的场合才用到这两项（见 isStrictBox）；
  // 其余场合由 columnMins 的相邻记号中心距约束给出，短音符不必为歌词撑宽整张谱面。
  if (showLyrics && e.lyric) {
    const accExtra = e.accidental !== 'natural' ? ACCIDENTAL_W : 0;
    const lw = lyricWidth(e.lyric);
    w = Math.max(w, accExtra + DIGIT_W / 2 + lw / 2, lw);
  }
  return w;
}

/** 记号拍数（以四分音符 = 1 拍）；延长线继承前一个音符基础时值 */
function eventBeats(e: ScoreEvent, lastNote: NoteEvent | null): number {
  if (e.kind === 'note') return noteBeats(e);
  if (e.kind === 'rest') return restBeats(e);
  return lastNote ? durationBeats(lastNote.duration) : 1;
}

/** 每小节的拍份数：拍号分子拍数，但至少容纳超量小节内容（所有小节共用同一拍份数） */
function beatCountOfBars(bars: Bar[], ts: TimeSignature): number {
  const beatSize = 4 / ts.den;
  let maxBeats = measureBeats(ts);
  for (const bar of bars) maxBeats = Math.max(maxBeats, barBeatLength(bar));
  return Math.max(1, Math.max(ts.num, Math.ceil(maxBeats / beatSize - 1e-9)));
}

interface BarPlan {
  /** 每记号起始拍份（拍份 = 拍号 denominator unit） */
  start: number[];
  /** 每记号拍份长度 */
  span: number[];
  /** 每记号所属拍份序号（0-based，同一小节内） */
  beat: number[];
  /** 每记号自然宽度（glyph box） */
  natural: number[];
  /** 每记号升降号占位：记号整体右移量（数字中心 = 盒左缘 + 本值 + 半个数字宽） */
  acc: number[];
  /** 每记号歌词音节宽度（不显示歌词时全为 0） */
  lyricW: number[];
  /** 该记号是否真写出附点（满两拍以上的音符把附点摊进延长线，不写附点） */
  dotted: boolean[];
  /** 该记号的记号盒必须撑住记号本身（列宽须按时值摊算），见 columnMins */
  strict: boolean[];
}

/** 把小节记号按拍份坐标：拍份边界 = 累计拍数 / 拍份大小 */
function planBar(
  bar: Bar,
  beatCount: number,
  beatSize: number,
  dashBeats: number,
  showLyrics: boolean,
): BarPlan {
  const start: number[] = [];
  const span: number[] = [];
  const beat: number[] = [];
  const natural: number[] = [];
  const acc: number[] = [];
  const lyricW: number[] = [];
  const dotted: boolean[] = [];
  const strict: boolean[] = [];
  let cursor = 0;
  let lastNote: NoteEvent | null = null;
  const events = bar.events;
  events.forEach((e, i) => {
    const beats = eventBeats(e, lastNote) / beatSize;
    const len = beats > 0 ? beats : 0.25;
    const dashes = e.kind === 'note' ? dashCount(noteBeats(e), dashBeats) : 0;
    start.push(cursor);
    span.push(len);
    beat.push(Math.max(0, Math.min(beatCount - 1, Math.floor(cursor + 1e-9))));
    natural.push(blockNaturalWidth(e, dashBeats, showLyrics));
    acc.push(e.kind === 'note' && e.accidental !== 'natural' ? ACCIDENTAL_W : 0);
    lyricW.push(showLyrics && e.kind === 'note' ? lyricWidth(e.lyric) : 0);
    dotted.push(e.kind !== 'dash' && e.dotted && dashes === 0);
    strict.push(isStrictBox(e, dashes, i, events.length));
    cursor += len;
    if (e.kind === 'note') lastNote = e;
    else if (e.kind === 'rest') lastNote = null;
  });
  return { start, span, beat, natural, acc, lyricW, dotted, strict };
}

/**
 * 记号盒「必须撑住记号」的场合（列宽须按该记号的时值摊算）：
 * ① 小节末记号——盒宽不足会越出小节线（顺带保证跨小节的两个记号中心距 >= 一个数字宽 + 留白）；
 * ② 带延长线的长音与显式延长线——每根横线各占一拍（`dashSplitSlots` 落在拍份网格上）；
 * ③ 拆成若干「0」的二分 / 全休止符——每个「0」各占一拍（`restSplitSlots`）。
 * 其余记号只受「相邻记号墨迹不相撞」约束（见 columnMins），不必撑满自己那格。
 */
function isStrictBox(e: ScoreEvent, dashes: number, index: number, count: number): boolean {
  if (index === count - 1) return true;
  if (e.kind === 'dash' || dashes > 0) return true;
  return e.kind === 'rest' && !e.dotted && restSplitParts(e.duration) > 1;
}

/**
 * 相邻两个记号（plan 的第 i、i+1 个）的**拍份间距**下限，使两侧墨迹不相撞。
 *
 * 记号左对齐拍份，数字中心 = 盒左缘 + 升降号宽 + 半个数字宽，故
 * 中心距 = 拍份间距 + acc[i+1] - acc[i]。墨迹需求按中心算：
 *   中心距 >= 左记号右半墨迹 + 右记号左半墨迹，
 * 其中右记号的左半墨迹要算上升降号（它写在数字**左侧**，相对数字中心再往左 ACCIDENTAL_W），
 * 歌词音节居中落在数字下方（与升降号无关），取两者更长的一侧；
 * 再把「acc[i+1] - acc[i]」这一项从拍份间距里补回来（左边带升降号的记号整体右移，
 * 得为它的升降号腾出位置）。
 */
function centerGap(plan: BarPlan, i: number): number {
  const leftOfNext = Math.max(plan.acc[i + 1] + DIGIT_W / 2, plan.lyricW[i + 1] / 2);
  return inkHalfRight(plan.lyricW[i], plan.dotted[i]) + leftOfNext + plan.acc[i] - plan.acc[i + 1];
}

/**
 * 拍份列宽需求（每列一个数），两类约束取最大：
 * ① 记号盒需求（`isStrictBox` 的场合）：自然宽度 / 它占的拍份数；
 * ② 相邻记号墨迹不相撞：中心距下限 / 两者的拍份间距，摊到两者之间的每一列。
 *
 * ② 取代旧版「每个记号都要撑满自己那格」的按时值摊算：32 分音符只占 1/8 拍份，
 * 照 ① 摊算会把全曲的拍份列宽撑到 8 倍（一个带长歌词音节的八分音符同理：
 * 音节宽 49.5 / 半拍 = 99），而它后面跟着的四分音符根本用不着那么宽——
 * 简谱里短时值音符靠下划线连成紧凑的一串，读作一串而不是各占一格。
 * 未被任何记号触及的列需求为 0 → 稀疏小节不被整小节撑宽，每行装得下更多小节。
 * 注意：这里只是「每列各自的需求」，layoutScore 会取全局最大值统一成全曲同一套列宽。
 */
function columnMins(plans: BarPlan[], beatCount: number): number[] {
  const mins = new Array<number>(beatCount).fill(0);
  const col = (t: number): number => Math.max(0, Math.min(beatCount - 1, Math.floor(t + 1e-9)));
  const cover = (from: number, to: number, per: number): void => {
    for (let j = from; j < to; j += 1) mins[j] = Math.max(mins[j], per);
  };
  for (const plan of plans) {
    const n = plan.start.length;
    for (let i = 0; i < n; i += 1) {
      if (!plan.strict[i]) continue;
      // planBar 保证 span > 0（空时值记为 0.25），记号至少触及一列
      const from = col(plan.start[i]);
      const to = Math.max(
        from + 1,
        Math.min(beatCount, Math.ceil(plan.start[i] + plan.span[i] - 1e-9)),
      );
      cover(from, to, plan.natural[i] / plan.span[i]);
    }
    for (let i = 0; i + 1 < n; i += 1) {
      // 相邻记号的拍份间距 = 前一个记号的盒宽（planBar 按累计拍数排开，不会重合）
      const delta = plan.start[i + 1] - plan.start[i];
      if (delta <= 1e-9) continue;
      const from = col(plan.start[i]);
      cover(from, Math.max(from + 1, Math.min(beatCount, col(plan.start[i + 1]) + 1)),
        centerGap(plan, i) / delta);
    }
  }
  return mins;
}

function underlinesFor(d: Duration): number {
  switch (d) {
    case 8:
      return 1;
    case 16:
      return 2;
    case 32:
      return 3;
    default:
      return 0;
  }
}

/**
 * 延长线根数：简谱里时值满两拍及以上的音符写作「数字 + 横线」，
 * 一根横线代表一拍；复合拍子（x/8）里一拍是附点四分音符。
 * 拍数换算不成整数拍时（如 6/8 里的四分音符）不补横线。
 */
function dashCount(beats: number, dashBeats: number): number {
  if (dashBeats <= 0) return 0;
  const units = beats / dashBeats;
  if (!Number.isInteger(units) || units < 2) return 0;
  return units - 1;
}

/** 休止符按四分休止符拆开的份数：全休止符 4 份、二分休止符 2 份，其余不拆 */
function restSplitParts(d: Duration): number {
  if (d === 1) return 4;
  if (d === 2) return 2;
  return 1;
}

/**
 * 二分 / 全休止符的拆分位置：简谱里它们写作若干四分休止符（「0 0」/「0 0 0 0」），
 * 因此每个「0」都落在自己那一份四分拍份的左边缘（与四分休止符同一记号位置），
 * 而不是居中摊在整段时值里——这样休止符也参与全局节拍网格的对齐。
 * 每份的拍份宽 = 记号盒拍份跨度 / 份数，故任意拍号（含 x/2、x/8）都成立。
 */
function restSplitSlots(
  e: ScoreEvent,
  plan: BarPlan,
  eventIndex: number,
  systemX: number,
  slotAt: (t: number) => number,
): number[] | undefined {
  if (e.kind !== 'rest' || e.dotted) return undefined;
  const parts = restSplitParts(e.duration);
  if (parts <= 1) return undefined;
  const start = plan.start[eventIndex];
  const step = plan.span[eventIndex] / parts;
  const slots: number[] = [];
  for (let i = 0; i < parts; i += 1) {
    slots.push(systemX + BAR_PADDING + slotAt(start + step * i) + DIGIT_W / 2);
  }
  return slots;
}

/**
 * 长时值音符的延长线位置：简谱里「数字 + 横线」每根横线占一拍，位置取自拍份网格——
 * 与落在同一拍上的普通音符取同一记号位置（拍份左边缘 + 半个数字宽），
 * 而不是居中摊在拍份里（那样横线会比同拍的音符右移半个拍份，谱面上下对不齐）。
 * 每根的拍份步长 = 记号盒拍份跨度 / (横线数 + 1) = 一拍（x/8 里是附点一拍），
 * 故任意拍号下横线都落在拍份边界上。
 */
function dashSplitSlots(
  e: ScoreEvent,
  plan: BarPlan,
  eventIndex: number,
  dashes: number,
  systemX: number,
  slotAt: (t: number) => number,
): number[] | undefined {
  if (e.kind !== 'note' || dashes <= 0) return undefined;
  const start = plan.start[eventIndex];
  const step = plan.span[eventIndex] / (dashes + 1);
  const slots: number[] = [];
  for (let i = 1; i <= dashes; i += 1) {
    slots.push(systemX + BAR_PADDING + slotAt(start + step * i) + DIGIT_W / 2);
  }
  return slots;
}

function computeExtents(
  kind: 'note' | 'rest' | 'dash',
  opts: {
    accidental: Accidental;
    underlines: number;
    dotsAbove: number;
    dotsBelow: number;
    triplet: boolean;
    lyric: string;
    showLyrics: boolean;
  },
): { top: number; bottom: number; lyricOffset: number } {
  let top = CAP_HEIGHT / 2;
  let bottom = CAP_HEIGHT / 2;
  if (kind === 'note') {
    if (opts.accidental !== 'natural') top = Math.max(top, CAP_HEIGHT / 2 + ACCIDENTAL_UP);
    if (opts.triplet) top = Math.max(top, CAP_HEIGHT / 2 + TRIPLET_UP);
  }
  if (opts.dotsAbove > 0) {
    top = Math.max(top, CAP_HEIGHT / 2 + DOT_OFFSET + (opts.dotsAbove - 1) * DOT_GAP + DOT_R);
  }
  if (opts.underlines > 0) {
    bottom = Math.max(
      bottom,
      CAP_HEIGHT / 2 + UNDERLINE_OFFSET + (opts.underlines - 1) * UNDERLINE_GAP + 2,
    );
  }
  if (opts.dotsBelow > 0) {
    bottom = Math.max(
      bottom,
      CAP_HEIGHT / 2 +
        UNDERLINE_OFFSET +
        opts.underlines * UNDERLINE_GAP +
        DOT_OFFSET +
        (opts.dotsBelow - 1) * DOT_GAP +
        DOT_R,
    );
  }
  let lyricOffset = 0;
  if (opts.showLyrics && opts.lyric) {
    // 歌词基线随下划线 / 低音点下移，行高（bottomExtent）取到歌词底边，
    // 于是相邻两行也不会压住歌词
    lyricOffset = lyricBaseline(opts.underlines, opts.dotsBelow);
    bottom = Math.max(bottom, CAP_HEIGHT / 2 + lyricOffset + LYRIC_FONT_SIZE / 2);
  }
  return { top, bottom, lyricOffset };
}

/**
 * 排版引擎：把 bar 序列按可用宽度切成若干视觉行（system）。
 * 全曲共用一套拍份列宽 → 节拍网格在整页处处对齐；
 * 小节宽度 = 行宽度 / 每行小节数（每行内小节宽度相同）；
 * 每行小节数 = 可用宽度 / 小节自然宽度，即每行尽可能多的小节。
 */
export function layoutScore(score: Score, containerWidth: number): LayoutResult {
  const bars = score.bars.length > 0 ? score.bars : [makeBar([])];
  const ts = score.meta.timeSig;
  // 谱面字号：排版在「容器宽度 / 字号系数」内进行，单位仍是标准字号下的用户单位，
  // 于是字号越大每行装得下的小节越少（谱面自动重排）；渲染层再把整张谱面按系数整体
  // 放大（见 render.ts 的 scaledSize），排版与渲染的几何逻辑不必随字号改动。
  const fontScale = fontScaleFor(score.meta.fontSize);
  const available = Math.max(240, containerWidth / fontScale - LEFT_MARGIN - RIGHT_MARGIN);

  // 0) 拍份网格：所有小节共用同一拍份数与同一套列宽（每小节内节拍宽度相同）
  const beatSize = 4 / ts.den;
  const beatCount = beatCountOfBars(bars, ts);
  // 一拍对应的四分音符拍数：复合拍子（x/8）里一拍是附点四分音符
  const dashBeats = ts.den % 8 === 0 ? 1.5 : beatSize;

  const plans: BarPlan[] = bars.map((bar) =>
    planBar(bar, beatCount, beatSize, dashBeats, score.meta.showLyrics),
  );
  // 列宽需求 = 落在该列的记号自然宽度 / 跨越列数（记号内不溢出）；
  // 无记号触及的列为 0 → 小节自然宽度只随实际记号增长，稀疏小节不被整小节撑宽
  const colReq = columnMins(plans, beatCount);
  // 全曲统一列宽：任一密集小节决定整谱的拍份宽度。
  // 逐列各取所需会让「混进八分 / 十六分音符的那一列」被拉宽数倍（八分音符占半拍，
  // 需求 = 记号宽 / 0.5 = 两倍），于是同一时值的四分音符在不同小节里宽度不一——
  // 欢乐颂第 4 小节「3. 2/」里的八分音符把第 2 列撑成第 1、3 列的两倍宽即是此例。
  // 取全局最大值后：同时值记号处处等宽，节拍网格在整页处处对齐。
  const uniformCol = colReq.reduce((acc, w) => Math.max(acc, w), 0);
  const colMin = colReq.map((w) => (w > 0 ? uniformCol : 0));
  const contentNatural = colMin.reduce((sum, w) => sum + w, 0);
  // 小节自然宽度 = 各列下限之和 + 左右小节线留白
  const barNatural = BAR_PADDING * 2 + contentNatural;

  const barsPerLine = Math.max(0, Math.round(score.meta.barsPerLine || 0));
  // 每行小节数上限：按可用宽度 / 小节自然宽度，记号内不溢出
  const fitPerLine = Math.max(1, Math.floor(available / barNatural));
  // 每行小节数：用户设置（不超过上限）或按可用宽度取最大；不超过小节总数
  const perLine =
    Math.max(1, Math.min(barsPerLine > 0 ? barsPerLine : fitPerLine, fitPerLine, bars.length));

  // 1) 切行：每行固定小节数（用户设置或按可用宽度），小节宽度按行内宽度平分
  const groups: number[][] = [];
  for (let i = 0; i < bars.length; i += perLine) {
    const group: number[] = [];
    const end = Math.min(i + perLine, bars.length);
    for (let j = i; j < end; j += 1) group.push(j);
    groups.push(group);
  }

  // 小节宽度：行宽度按每行小节数平分（每行内小节宽度相同）
  // 窄容器内（小节自然宽度超过可用时）小节内不记号内溢出 → 允许横向滚动
  const barWidth = Math.max(available / perLine, barNatural);
  // 拍份列宽：小节内容宽度按各列自然下限等比放大（记号盒宽与时值成正比），
  // 全曲共用同一套 → 同一拍在整页每一行、每一小节都落在同一横向位置
  const contentWidth = barWidth - BAR_PADDING * 2;
  const scale = contentNatural > 0 ? contentWidth / contentNatural : 0;
  const even = contentNatural > 0 ? 0 : contentWidth / beatCount;
  const colW: number[] = [];
  const colX: number[] = [];
  let colAcc = 0;
  for (let j = 0; j < beatCount; j += 1) {
    const w = contentNatural > 0 ? colMin[j] * scale : even;
    colW.push(w);
    colX.push(colAcc);
    colAcc += w;
  }
  // 拍份坐标 t（四分音符 = 1，可含小数）→ 小节内容内的 x 偏移（按列累加 + 列内插值）
  const slotAt = (t: number): number => {
    const j = Math.max(0, Math.min(beatCount - 1, Math.floor(t + 1e-9)));
    return colX[j] + (Math.min(t, beatCount) - j) * colW[j];
  };

  const systems: SystemLayout[] = [];
  const blockIndexById = new Map<string, BlockInfo>();
  let lastNoteDuration: Duration = 4;
  let lastNoteUnderlines = 0;

  for (let s = 0; s < groups.length; s += 1) {
    const group = groups[s];
    const barSlots: BarSlot[] = [];
    const blocks: NoteBlock[] = [];
    const barlines: Barline[] = [];
    const barNumbers: BarNumberLabel[] = [];

    let x = 0;
    group.forEach((barIndex, slotIdx) => {
      const bar = bars[barIndex];
      const plan = plans[barIndex];
      const isFirst = slotIdx === 0;
      const isLast = slotIdx === group.length - 1;

      bar.events.forEach((e, eventIndex) => {
        const beat = plan.beat[eventIndex];
        const bx = x + BAR_PADDING + slotAt(plan.start[eventIndex]);
        const bw =
          slotAt(plan.start[eventIndex] + plan.span[eventIndex]) - slotAt(plan.start[eventIndex]);
        const kind: NoteBlock['kind'] =
          e.kind === 'note' ? 'note' : e.kind === 'rest' ? 'rest' : 'dash';

        // 记号左对齐拍份：记号盒贴拍份左边缘，小节内记号都落在拍份网格线
        // （简谱惯例：记号在左侧，延长线 / 剩余时值向右）
        const accExtra = e.kind === 'note' && e.accidental !== 'natural' ? ACCIDENTAL_W : 0;
        const cx = bx + accExtra + DIGIT_W / 2;
        // 二分 / 全休止符：拆成若干四分休止符，每个「0」各就各位（见 restSplitSlots）
        const restSlots = restSplitSlots(e, plan, eventIndex, x, slotAt);

        const degree = e.kind === 'note' ? e.degree : (0 as Degree);
        const octave = e.kind === 'note' ? e.octave : 0;
        const accidental: Accidental = e.kind === 'note' ? e.accidental : 'natural';
        let duration: Duration;
        let underlines: number;
        if (e.kind === 'dash') {
          // 延长线继承前一个音符的时值与下划线数量（render.ts 按下划线数量连接相邻记号）
          duration = lastNoteDuration;
          underlines = lastNoteUnderlines;
        } else {
          duration = e.duration;
          underlines = underlinesFor(duration);
          lastNoteDuration = duration;
          // 休止符自身有下划线，但其后的延长线不继承（休止符后不接延长线）
          lastNoteUnderlines = kind === 'note' ? underlines : 0;
        }
        // 二分/全音符等长时值：模型里只有一个事件，横线由排版层按拍数补出
        const dashes = e.kind === 'note' ? dashCount(noteBeats(e), dashBeats) : 0;
        // 补出的横线各就各位：落在其后各拍的记号网格上（与普通音符同一位置）
        const dashSlots = dashSplitSlots(e, plan, eventIndex, dashes, x, slotAt);

        // 简谱里满两拍的音符写作「数字 + 延长线」，附点的那半拍同样落在横线上，
        // 所以有延长线时不再写附点：附点二分音符是「5 - -」，不是「5. - -」
        const dotted = e.kind !== 'dash' && e.dotted && dashes === 0;
        const triplet = e.kind === 'note' && e.triplet;
        // 歌词只在「显示歌词」开启时交给渲染层（与 showBarNumbers 同法：排版层决定画什么，
        // 渲染层只画排版给出的东西）。关闭时既不占列宽、也不占行高，谱面上不会出现歌词。
        const lyric = score.meta.showLyrics && e.kind === 'note' ? e.lyric : '';
        const dotsAbove = kind === 'note' && octave > 0 ? octave : 0;
        const dotsBelow = kind === 'note' && octave < 0 ? -octave : 0;

        const extents = computeExtents(kind, {
          accidental,
          underlines,
          dotsAbove,
          dotsBelow,
          triplet,
          lyric,
          showLyrics: score.meta.showLyrics,
        });

        const blockWidth = kind === 'dash' ? DASH_W : bw;
        // 显式延长线与普通音符取同一记号位置（拍份左边缘 + 半个数字宽），
        // 这样「5 - -」里的横线与同拍上的音符竖向对齐
        const blockCx = kind === 'dash' ? bx + DIGIT_W / 2 : cx;

        const block: NoteBlock = {
          eventId: e.id,
          barIndex,
          eventIndex,
          kind,
          x: bx,
          width: blockWidth,
          cx: blockCx,
          restSlots,
          dashSlots,
          beatIndex: beat,
          degree,
          octave,
          accidental,
          duration,
          dotted,
          triplet,
          lyric,
          lyricOffset: extents.lyricOffset,
          underlines,
          dashes,

          dotsAbove,
          dotsBelow,
          topExtent: extents.top,
          bottomExtent: extents.bottom,
        };
        blocks.push(block);
        blockIndexById.set(e.id, { system: systems.length, block });
      });

      barSlots.push({
        barIndex,
        x,
        width: barWidth,
        slotWidths: colW,
        slotWidth: contentWidth / beatCount,
        leftBarline: bar.left,
        rightBarline: bar.right,
      });

      if (isFirst && bar.left === 'repeat-start') {
        barlines.push({ x, kind: 'repeat-start', top: 0, bottom: 0 });
      }
      // 每小节右侧画小节线；行末普通小节线省略
      if (!isLast || bar.right === 'repeat-end' || bar.right === 'final') {
        barlines.push({
          x: x + barWidth,
          kind: bar.right === 'none' ? 'normal' : bar.right,
          top: 0,
          bottom: 0,
        });
      }

      if (score.meta.showBarNumbers && (barIndex % 4 === 0 || isFirst)) {
        barNumbers.push({ barIndex, x: x + 2 });
      }

      x += barWidth;
    });

    systems.push({
      index: systems.length,
      startBarIndex: group[0],
      barSlots,
      blocks,
      barlines,
      arcs: [],
      barNumbers,
      topPad: 0,
      bottomPad: 0,
      height: 0,
      width: x,
      centerY: 0,
    });
  }

  // 2) 弧线：连音线逐对连接；圆滑线把连续标记的音符合并成一组，共用一条弧线
  const notes = collectNotes(bars);

  // 2a) 连音线（tie）：始终只连接相邻两个音
  for (const ref of notes) {
    if (!ref.note.tie) continue;
    const prev = findPrevNote(bars, ref.barIndex, ref.eventIndex);
    if (!prev) continue;
    const from = blockIndexById.get(prev.id);
    const to = blockIndexById.get(ref.id);
    if (!from || !to) continue;
    pushPairArc(systems, from, to, 'tie');
  }

  // 2b) 圆滑线（slur）：一组三个以上音符共用一条弧线，跨行时按行分段续接
  for (const group of slurGroups(notes)) {
    const infos = group
      .map((ref) => blockIndexById.get(ref.id))
      .filter((info): info is BlockInfo => info !== undefined);
    if (infos.length < 2) continue;

    let start = 0;
    while (start < infos.length) {
      const systemIndex = infos[start].system;
      let end = start;
      while (end + 1 < infos.length && infos[end + 1].system === systemIndex) end += 1;

      const segment = infos.slice(start, end + 1);
      const system = systems[systemIndex];
      const clearance = segment.reduce((acc, item) => Math.max(acc, item.block.dotsAbove), 0);
      const firstSegment = start === 0;
      const lastSegment = end === infos.length - 1;
      const x1 = firstSegment ? segment[0].block.cx : 0;
      const x2 = lastSegment ? segment[segment.length - 1].block.cx : system.width;
      const partial: Arc['partial'] =
        firstSegment && lastSegment
          ? 'none'
          : firstSegment
            ? 'end'
            : lastSegment
              ? 'start'
              : 'both';

      system.arcs.push({ kind: 'slur', x1, x2, partial, clearance, noteCount: segment.length });
      start = end + 1;
    }
  }

  // 3) 歌词基线：同一行所有音节共用一条基线（歌词成行，不阶梯），
  //    并让开本行**所有**记号（含没有歌词的音符）的下划线 / 低音八度点堆叠 ——
  //    否则低音点会正好落在邻居音节的字面上。
  for (const system of systems) {
    let line = 0;
    let hasLyric = false;
    for (const b of system.blocks) {
      if (b.lyric) hasLyric = true;
      line = Math.max(line, lyricBaseline(b.underlines, b.dotsBelow));
    }
    if (!hasLyric) continue;
    for (const b of system.blocks) {
      if (!b.lyric) continue;
      b.lyricOffset = line;
      b.bottomExtent = Math.max(b.bottomExtent, CAP_HEIGHT / 2 + line + LYRIC_FONT_SIZE / 2);
    }
  }

  // 4) 上下留白：取本行所有记号与弧线的最大高度
  for (const system of systems) {
    let topPad = 0;
    let bottomPad = 0;
    for (const b of system.blocks) {
      topPad = Math.max(topPad, b.topExtent);
      bottomPad = Math.max(bottomPad, b.bottomExtent);
    }
    for (const arc of system.arcs) {
      const clearance = arc.clearance > 0 ? DOT_OFFSET + arc.clearance * DOT_GAP + 3 : 6;
      topPad = Math.max(topPad, CAP_HEIGHT / 2 + clearance + arcLift(arc) + 4);
    }
    topPad = Math.max(topPad, 18) + SYSTEM_TOP_PAD;
    bottomPad = Math.max(bottomPad, 18);
    system.topPad = topPad;
    system.bottomPad = bottomPad;
    system.height = topPad + bottomPad;
    system.centerY = topPad;
  }

  // 5) 小节线长度：只覆盖音符区（数字 + 下划线 + 低音八度点），不伸进歌词带。
  //    歌词行里所有音节共用一条基线，故整行小节线取同一长度，竖向齐平。
  //    歌词顶边始终在「下划线 / 低音点堆叠」之下留出 LYRIC_CLEARANCE（见 lyricBaseline），
  //    于是「止于歌词之上」永远不会把小节线压缩到盖不住低音点。
  for (const system of systems) {
    if (system.barlines.length === 0) continue;
    let noteBottom = CAP_HEIGHT / 2;
    let lyricTop = Infinity;
    for (const b of system.blocks) {
      noteBottom = Math.max(noteBottom, CAP_HEIGHT / 2 + belowStack(b.underlines, b.dotsBelow));
      if (b.lyric) {
        lyricTop = Math.min(
          lyricTop,
          system.centerY + CAP_HEIGHT / 2 + b.lyricOffset - LYRIC_FONT_SIZE / 2,
        );
      }
    }
    const top = system.centerY - CAP_HEIGHT / 2 - BARLINE_TOP_ABOVE;
    let bottom = system.centerY + Math.max(noteBottom, BARLINE_MIN_BELOW);
    if (Number.isFinite(lyricTop)) bottom = Math.min(bottom, lyricTop - BARLINE_LYRIC_GAP);
    for (const bl of system.barlines) {
      bl.top = top;
      bl.bottom = bottom;
    }
  }

  const maxWidth = systems.reduce((acc, s) => Math.max(acc, s.width), 0);
  const pageWidth = maxWidth + LEFT_MARGIN + RIGHT_MARGIN;
  // 页眉（歌曲信息）占一条带，谱表整体从 header.height 起排；页眉宽度取整页宽度，
  // 于是标题居中于谱面、左右栏分别贴左右边距（与图例的歌本版式一致）
  const header = layoutHeader(score, pageWidth);
  const totalHeight = systems.reduce((acc, s) => acc + s.height, 0) + Math.max(0, systems.length - 1) * SYSTEM_GAP;

  return {
    systems,
    header,
    width: pageWidth,
    // header.height 已含顶部留白；末尾 12 是谱面底部留白
    height: header.height + totalHeight + 12,
    scale: fontScale,
  };
}

function findPrevNote(bars: Bar[], barIndex: number, eventIndex: number) {
  let b = barIndex;
  let i = eventIndex - 1;
  for (;;) {
    if (b < 0) return null;
    const bar = bars[b];
    while (i >= 0) {
      const e = bar.events[i];
      if (isNote(e)) return e;
      i -= 1;
    }
    b -= 1;
    if (b < 0) return null;
    i = bars[b].events.length - 1;
  }
}

/** 按文档顺序收集所有音符 */
function collectNotes(bars: Bar[]): NoteRef[] {
  const out: NoteRef[] = [];
  bars.forEach((bar, barIndex) => {
    bar.events.forEach((event, eventIndex) => {
      if (isNote(event)) out.push({ id: event.id, barIndex, eventIndex, note: event });
    });
  });
  return out;
}

/**
 * 圆滑线分组：组内第一个音之后的每个音只要标记了 slur，就并入同一组。
 * 因此连续标记三个、四个……音符会得到一条覆盖整组的弧线。
 */
function slurGroups(notes: NoteRef[]): NoteRef[][] {
  const groups: NoteRef[][] = [];
  let current: NoteRef[] = [];
  for (const ref of notes) {
    if (current.length > 0 && ref.note.slur) {
      current.push(ref);
      continue;
    }
    if (current.length > 1) groups.push(current);
    current = [ref];
  }
  if (current.length > 1) groups.push(current);
  return groups;
}

/** 相邻两个音之间的弧线（连音线专用），跨行时拆成 end / start 两段 */
function pushPairArc(
  systems: SystemLayout[],
  from: BlockInfo,
  to: BlockInfo,
  kind: Arc['kind'],
): void {
  if (from.system === to.system) {
    systems[from.system].arcs.push({
      kind,
      x1: from.block.cx,
      x2: to.block.cx,
      partial: 'none',
      clearance: Math.max(from.block.dotsAbove, to.block.dotsAbove),
      noteCount: 2,
    });
    return;
  }

  const prevSystem = systems[from.system];
  prevSystem.arcs.push({
    kind,
    x1: from.block.cx,
    x2: prevSystem.width,
    partial: 'end',
    clearance: from.block.dotsAbove,
    noteCount: 2,
  });
  systems[to.system].arcs.push({
    kind,
    x1: 0,
    x2: to.block.cx,
    partial: 'start',
    clearance: to.block.dotsAbove,
    noteCount: 2,
  });
}
