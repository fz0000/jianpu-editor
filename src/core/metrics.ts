/** 简谱排版度量常量（SVG 用户单位） */

export const FONT_SIZE = 30;
export const CAP_HEIGHT = 22;
export const DIGIT_W = 14;
export const DASH_W = 16;
export const DOT_R = 2.4;
export const DOT_GAP = 5;
export const DOT_OFFSET = 8;
export const UNDERLINE_GAP = 5;
export const UNDERLINE_OFFSET = 6;
export const ACCIDENTAL_W = 8;
export const ACCIDENTAL_UP = 11;
export const DOTTED_DOT_W = 7;
export const DOTTED_DOT_DX = 5;
export const BAR_PADDING = 4;
export const BEAT_SLOT_W = DIGIT_W;
/**
 * 长时值音符（二分 / 全音符）每根延长线（横线）至少占的拍份宽度。
 * 排版层据此把「数字 + 横线」的整体自然宽度摊到该音符跨越的拍份列上，
 * 保证紧凑网格下渲染层仍画得出一根根短横（见 render.ts 的 unit / len）。
 */
export const DASH_UNIT_W = DIGIT_W;
/**
 * 歌词字号 = 数字字号的 0.6 倍（30 → 18）：汉字音节要读得清，又不与数字争视觉重心。
 *
 * 字号由渲染层写成 text 元素的 font-size **属性**（用户单位），随 SVG 的
 * width/height × viewBox 整体缩放 —— styles.css 里不得再给 .jp-lyric 写 px 字号：
 * CSS 声明压过呈现属性，歌词会固定成屏幕像素大小，既不随谱面字号缩放，
 * 也与排版层预留的位置对不上（编辑器与导出 SVG / PNG / 打印还会互不一致）。
 */
export const LYRIC_FONT_SIZE = 18;
/**
 * 歌词基线相对**数字底边**的最小距离（音符没有下划线、没有低音点时；渲染时加 CAP_HEIGHT/2
 * 落到数字中心下方，见 render.ts）。
 * 汉字音节近乎满框，视觉顶边紧贴 em 顶，故最小距离要给到数字高度的一半以上
 * （36 = 数字高 22 的 1.6 倍），否则歌词读起来像贴在数字下方的又一道横线。
 */
export const LYRIC_OFFSET = 36;
/** 歌词顶边与上方「下划线 / 低音八度点」堆叠之间的最小净空 */
export const LYRIC_CLEARANCE = 8;
/**
 * 歌词（音节）估算宽度：音节居中落在数字下方，相邻音节不得重叠，
 * 因此排版层把歌词宽度计入记号盒的自然宽度（见 layout.ts blockNaturalWidth）。
 * 汉字 / 全角字符按一字宽计，拉丁字母按半宽估算。
 */
export const LYRIC_CJK_W = LYRIC_FONT_SIZE;
export const LYRIC_LATIN_W = LYRIC_FONT_SIZE * 0.55;
const CJK_RANGE =
  /[\u2E80-\u303F\u3040-\u30FF\u3130-\u318F\u31C0-\u31EF\u31F0-\u31FF\u3200-\u33FF\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\uFF00-\uFF60\uFFE0-\uFFEF]/;

/** 拉丁字母 / 数字的半宽比例（等宽字体的数字与字母约半个汉字宽） */
const LATIN_RATIO = 0.55;

/**
 * 记号墨迹相对「数字中心」的左半宽（排版层算相邻记号的最小中心距，见 layout.ts columnMins）。
 * 数字宽 DIGIT_W；歌词音节居中落在数字下方，音节比数字宽时向两侧长出，故取半个音节宽。
 */
export function inkHalfLeft(lyricW: number): number {
  return Math.max(DIGIT_W / 2, lyricW / 2);
}

/**
 * 同上取右半宽：附点写在数字右侧 DOTTED_DOT_DX 之外、半径 DOT_R（render.ts 的 jp-dotted-dot），
 * 只有真写出附点时（满两拍以上的音符把附点摊进延长线，不写附点）才计入。
 */
export function inkHalfRight(lyricW: number, dotted: boolean): number {
  return inkHalfLeft(lyricW) + (dotted ? DOTTED_DOT_DX + DOT_R : 0);
}

/**
 * 文本估算宽度（SVG 用户单位）：汉字 / 全角字符按一字宽（= fontSize），
 * 拉丁字母、数字、空格按半宽计；tracking 为逐字符追加的字距（SVG 的 letter-spacing
 * 在每个字符后都追加一份，故末尾也算，渲染时按半个字距补偿居中偏移）。
 * 页眉（标题 / 演唱 / 词曲作者 / 调号拍号速度）排版用它决定居中与左右栏是否相撞。
 */
export function textWidth(text: string, fontSize: number, tracking = 0): number {
  let w = 0;
  for (const ch of text) {
    if (!ch) continue;
    w += (CJK_RANGE.test(ch) ? fontSize : fontSize * LATIN_RATIO) + tracking;
  }
  return w;
}

/** 歌词字符串的估算宽度（SVG 用户单位） */
export function lyricWidth(lyric: string): number {
  let w = 0;
  for (const ch of lyric) {
    if (!ch || ch === ' ') continue;
    w += CJK_RANGE.test(ch) ? LYRIC_CJK_W : LYRIC_LATIN_W;
  }
  return w;
}

/**
 * 数字下方「下划线 + 低音八度点」堆叠的底边（相对**数字底边** = CAP_HEIGHT/2，无则 0）。
 * 与 render.ts 的 underlineY() / 低音点 cy 同一套换算（它们都从数字中心起算，含 CAP_HEIGHT/2）：
 * 第 i 根下划线在 UNDERLINE_OFFSET + i * UNDERLINE_GAP（线宽留 2 的余量），
 * 第 i 个低音点在 UNDERLINE_OFFSET + 下划线数 * UNDERLINE_GAP + DOT_OFFSET + i * DOT_GAP（加半径）。
 */
export function belowStack(underlines: number, dotsBelow: number): number {
  let h = 0;
  if (underlines > 0) h = UNDERLINE_OFFSET + (underlines - 1) * UNDERLINE_GAP + 2;
  if (dotsBelow > 0) {
    h = Math.max(
      h,
      UNDERLINE_OFFSET +
        underlines * UNDERLINE_GAP +
        DOT_OFFSET +
        (dotsBelow - 1) * DOT_GAP +
        DOT_R,
    );
  }
  return h;
}

/**
 * 歌词基线（相对数字底边，排版层与渲染层共用）。
 *
 * 不能是一个常数：八分 / 十六分音符的下划线、低音的八度点都往数字下方长，
 * 固定基线会让歌词压在这些记号上（十六分音符 + 低音点的点正好落在字面中央）。
 * 于是取「最小距离」与「堆叠底部 + 净空 + 半个字高」的较大者 ——
 * 歌词顶边始终在堆叠之下留出 LYRIC_CLEARANCE，行高（bottomExtent）随之长高。
 */
export function lyricBaseline(underlines: number, dotsBelow: number): number {
  return Math.max(
    LYRIC_OFFSET,
    belowStack(underlines, dotsBelow) + LYRIC_CLEARANCE + LYRIC_FONT_SIZE / 2,
  );
}

export const SYSTEM_GAP = 30;
export const SYSTEM_TOP_PAD = 14;
export const LEFT_MARGIN = 36;
export const RIGHT_MARGIN = 14;
/**
 * 小节线只覆盖**音符区**，不伸进歌词带（否则一行里竖线穿过汉字，读起来像表格线）：
 * 顶端高出数字顶边 BARLINE_TOP_ABOVE，底端取到本行最深的「下划线 + 低音八度点」堆叠
 * （至少 BARLINE_MIN_BELOW，与 bottomPad 的下限一致），有歌词的行再止于歌词顶边之上
 * BARLINE_LYRIC_GAP。具体坐标由排版层算出，写进 Barline.top / Barline.bottom。
 */
export const BARLINE_TOP_ABOVE = 6;
export const BARLINE_MIN_BELOW = 18;
export const BARLINE_LYRIC_GAP = 4;
export const TRIPLET_UP = 19;
export const ARC_LIFT = 12;
export const BAR_NUMBER_FONT = 12;

/**
 * 页眉（歌曲信息）度量：自上而下三行 —— 标题独占一行（居中 + 字距），
 * 其下居中排副标题 / 「演唱 ×××」，再往下是信息带：左栏「1=bE 2/4」「♩=80」，
 * 右栏「×× 作词 / ×× 作曲」右对齐 —— 见 layout.ts layoutHeader。
 * 字号是标准字号下的用户单位，随谱面字号整体缩放（渲染层乘 scale）。
 */
export const TITLE_FONT_SIZE = 34;
/** 标题字距：简谱歌名惯用宽字距（「甜 蜜 蜜」），SVG letter-spacing 同值 */
export const TITLE_TRACKING = 8;
export const SUBTITLE_FONT_SIZE = 18;
export const HEADER_META_FONT_SIZE = 16;
/** 基线相对字号的位置比例（CJK 文字视觉居中用，避免逐字体量测基线） */
export const HEADER_BASELINE_RATIO = 0.8;
export const HEADER_TOP_PAD = 12;
/**
 * 标题到下一行（副标题 / 演唱）的行距。标题是页眉的视觉重心，必须**独占一行**：
 * 行距给到 16（旧版 10 时标题与演唱贴成一块，读起来挤），标题下方才透得出气。
 */
export const TITLE_LINE_GAP = 16;
export const HEADER_LINE_GAP = 6;
/**
 * 居中栏（标题 / 副标题 / 演唱）与下方「信息带」之间的间距：
 * 调号拍号、速度、词曲作者一律下移到居中栏之下，不与标题、演唱同线。
 */
export const HEADER_BLOCK_GAP = 16;
/** 左右两栏之间的最小水平间距；不足时右栏整体下移 */
export const HEADER_SIDE_GAP = 14;
/** 页眉带与第一行谱表之间的间距 */
export const HEADER_BOTTOM_PAD = 18;

/**
 * 谱面字号档位（数字「1-7」的字号，SVG 用户单位）；FONT_SIZE = 30 为标准档。
 *
 * 字号是「整张谱面」的等比缩放，不是只改数字大小：
 * 排版层按「容器宽度 / 字号系数」排版（字号越大，每行装得下的小节越少，自动重排），
 * 渲染层把 SVG 的 width/height 按系数放大而 viewBox 保持标准字号下的用户单位，
 * 于是数字、下划线、延长线、八度点、歌词、小节号、线宽全部一起缩放。
 */
export const FONT_SIZE_STEPS: number[] = [18, 22, 26, 30, 34, 38, 44, 48];
export const DEFAULT_FONT_SIZE = FONT_SIZE;
export const MIN_FONT_SIZE = FONT_SIZE_STEPS[0];
export const MAX_FONT_SIZE = FONT_SIZE_STEPS[FONT_SIZE_STEPS.length - 1];

const FONT_SIZE_NAMES: Record<number, string> = {
  18: '极小',
  22: '小',
  26: '偏小',
  30: '标准',
  34: '偏大',
  38: '大',
  44: '特大',
  48: '极大',
};

/** 档位的中文名（UI 下拉用）；不在档位表里时退回数字本身 */
export function fontSizeLabel(value: number): string {
  return FONT_SIZE_NAMES[value] ?? `${value}`;
}

/** 把任意字号吸附到最近的档位：导入的 JSON 里可能有越界值或非档位值 */
export function snapFontSize(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_FONT_SIZE;
  let best = DEFAULT_FONT_SIZE;
  let bestGap = Math.abs(value - best);
  for (const step of FONT_SIZE_STEPS) {
    const gap = Math.abs(value - step);
    if (gap < bestGap) {
      best = step;
      bestGap = gap;
    }
  }
  return best;
}

/** 字号 -> 缩放系数（标准字号为 1）；排版层用它换算可用宽度，渲染层用它放大整张谱面 */
export function fontScaleFor(value: number): number {
  return snapFontSize(value) / FONT_SIZE;
}