/**
 * 「简化连音线」：把小节内同音高的连音线链改写成更长的时值。
 *
 * 导入 MIDI、解析文本简谱、或手工编辑时都可能留下一长串同音连音线，
 * 例如 3 拍写成「六个八分音符 + 五条连音线」。简谱里它本该是「四分音符 + 两条增时线」，
 * 一条连音线都不用。这个后处理就是做这种改写：
 *
 * - 只在**同一小节内**合并：跨小节的长音必须靠小节线两侧的连音线表达，保持原样。
 * - 时值拼写复用 core/spelling 的规则（优先长时值、增时线不超过 3 条、
 *   附点后不接增时线），所以合并结果与量化导入的写法一致。
 * - 只要「时值能精确表示 + 合并后连音线严格变少」就改写：3 拍写成「3 - -」，
 *   而不是「3:4. 3:4~」；链本身已经无连音线时原样保留。
 * - 链上带歌词、圆滑线、三连音标记的音符不参与合并，避免丢歌词、改分句。
 */
import {
  durationBeats,
  isDash,
  isNote,
  makeDash,
  makeNote,
  noteBeats,
  type Bar,
  type NoteEvent,
  type ScoreEvent,
} from './model';
import {
  EPS,
  MAX_DASHES,
  bestSpelling,
  representDuration,
  segmentEventCount,
  segmentTieCount,
  type Segment,
} from './spelling';

/** 默认量化网格：十六分，允许附点八分 / 附点四分等常见写法 */
export const DEFAULT_COMPACT_GRID = 0.25;

export interface CompactTieOptions {
  /** 量化网格，以四分音符 = 1 拍计：0.5=八分, 0.25=十六分。决定可用时值与附点 */
  grid?: number;
}

export interface CompactTieStats {
  /** 被合并掉的连音线数量 */
  tiesRemoved: number;
  /** 被移除的事件数量，即谱面短了多少个记号 */
  eventsRemoved: number;
  /** 被改写的小节数 */
  barsChanged: number;
}

interface Chain {
  /** 链尾事件下标（含） */
  end: number;
  notes: NoteEvent[];
  beats: number;
  ties: number;
}

function pitchKey(n: NoteEvent): string {
  return `${n.degree}|${n.octave}|${n.accidental}`;
}

/** 从 start 起收集一条同音连音线链（含链内的延长线）；不足两个音时返回 null */
function collectChain(events: ScoreEvent[], start: number): Chain | null {
  const head = events[start];
  if (!isNote(head)) return null;
  if (head.triplet || head.slur) return null;

  const key = pitchKey(head);
  const notes: NoteEvent[] = [head];
  let beats = noteBeats(head);
  let lastBase = durationBeats(head.duration);
  let ties = 0;
  let end = start;

  for (let i = start + 1; i < events.length; i += 1) {
    const ev = events[i];
    // 延长线继承前一个音符的基础时值，属于链的一部分
    if (isDash(ev)) {
      beats += lastBase;
      end = i;
      continue;
    }
    if (!isNote(ev)) break;
    if (!ev.tie || pitchKey(ev) !== key) break;
    if (ev.triplet || ev.slur || ev.lyric !== '') break;

    notes.push(ev);
    beats += noteBeats(ev);
    lastBase = durationBeats(ev.duration);
    ties += 1;
    end = i;
  }

  return ties > 0 ? { end, notes, beats, ties } : null;
}

/** 按拼写结果生成事件：链首沿用原 id / 歌词 / 跨小节连音线，其余写成增时线或连音音符 */
function buildEvents(segments: Segment[], head: NoteEvent, notes: NoteEvent[]): ScoreEvent[] {
  const velocity = notes.reduce((acc, n) => Math.max(acc, n.velocity), 1);
  const out: ScoreEvent[] = [];

  segments.forEach((seg, index) => {
    const isFirst = index === 0;
    const note = makeNote(head.degree, seg.duration, {
      octave: head.octave,
      accidental: head.accidental,
      dotted: seg.dotted,
      // 链首若连着前一小节，合并后这条连音线照旧
      tie: isFirst ? head.tie : true,
      lyric: isFirst ? head.lyric : '',
      velocity,
    });
    if (isFirst) note.id = head.id;
    out.push(note);

    for (let d = 0; d < seg.dashes; d += 1) {
      // 附点音符后面不能接增时线，那几拍只能写成同音连音音符
      if (seg.dotted) {
        out.push(
          makeNote(head.degree, seg.duration, {
            octave: head.octave,
            accidental: head.accidental,
            tie: true,
            velocity,
          }),
        );
      } else {
        out.push(makeDash());
      }
    }
  });

  return out;
}

function compactBar(bar: Bar, grid: number): { events: ScoreEvent[]; tiesRemoved: number; eventsRemoved: number } {
  const out: ScoreEvent[] = [];
  let tiesRemoved = 0;
  let eventsRemoved = 0;
  let i = 0;

  while (i < bar.events.length) {
    const head = bar.events[i];
    const chain = isNote(head) ? collectChain(bar.events, i) : null;
    if (!chain || !isNote(head)) {
      out.push(head);
      i += 1;
      continue;
    }

    // 先求「连音线最少、记号最少」的拼写；网格太细 / 拍数不在网格上时退回贪心
    const segments =
      bestSpelling(chain.beats, grid, true) ?? representDuration(chain.beats, grid, true);
    const covered = segments.reduce((acc, s) => acc + s.covered, 0);
    const span = chain.end - i + 1;
    const newTies = segments.reduce((acc, s, idx) => acc + segmentTieCount(s, idx === 0), 0);
    const newEvents = segments.reduce((acc, s) => acc + segmentEventCount(s), 0);
    const exact = Math.abs(covered - chain.beats) < EPS;

    // 目标是连音线更少：能精确表示、且连音线确实减少，就改写成规范写法
    // （3 拍写成「3 - -」而不是「3:4. 3:4~」）。事件数最多允许多出 MAX_DASHES 个，
    // 防止极端拍号下把两个音摊成一长串增时线。
    if (!exact || newTies >= chain.ties || newEvents > span + MAX_DASHES) {
      out.push(head);
      i += 1;
      continue;
    }

    out.push(...buildEvents(segments, head, chain.notes));
    tiesRemoved += chain.ties - newTies;
    eventsRemoved += span - newEvents;
    i = chain.end + 1;
  }

  return { events: out, tiesRemoved, eventsRemoved };
}

/**
 * 全谱简化连音线。返回新的小节数组（未改动的小节沿用原对象）与统计。
 * 拍数逐小节守恒，播放计划不变。
 */
export function compactTieChains(
  bars: Bar[],
  opts: CompactTieOptions = {},
): { bars: Bar[]; stats: CompactTieStats } {
  const grid = opts.grid && opts.grid > 0 ? opts.grid : DEFAULT_COMPACT_GRID;
  const stats: CompactTieStats = { tiesRemoved: 0, eventsRemoved: 0, barsChanged: 0 };

  const next = bars.map((bar) => {
    const { events, tiesRemoved, eventsRemoved } = compactBar(bar, grid);
    if (tiesRemoved === 0) return bar;
    stats.tiesRemoved += tiesRemoved;
    stats.eventsRemoved += eventsRemoved;
    stats.barsChanged += 1;
    return { ...bar, events };
  });

  return { bars: next, stats };
}
