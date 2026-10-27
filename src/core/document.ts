import { History } from './history';
import { compactTieChains, type CompactTieOptions } from './tie-compact';
import { compactRestRuns, type CompactRestOptions } from './rest-compact';
import { shiftTonic } from './constants';
import { transposeBars, type TransposeMode, type TransposeStats } from './transpose';
import {
  isNote,
  makeBar,
  makeDash,
  makeNote,
  makeRest,
  type Accidental,
  type Bar,
  type BarlineKind,
  type Degree,
  type Duration,
  type Meta,
  type NoteEvent,
  type Score,
  type ScoreEvent,
} from './model';

export interface CursorState {
  barIndex: number;
  /** 0..events.length，等于 events.length 表示小节末尾的空槽 */
  eventIndex: number;
}

export type ChangeReason = 'edit' | 'undo' | 'redo' | 'load' | 'import' | 'meta';

export interface CursorSlot {
  barIndex: number;
  eventIndex: number;
  event: ScoreEvent | null;
}

/** 一条圆滑线覆盖的范围（含首尾音符），以音符在小节内的下标表示 */
export interface SlurSpan {
  startBar: number;
  startIndex: number;
  endBar: number;
  endIndex: number;
  /** 覆盖的音符数，>= 2 */
  noteCount: number;
}

/** 「记号精简」的选项：连音线合并与休止符合并共用量化网格 */
export interface CompactNotationOptions extends CompactTieOptions, CompactRestOptions {}

export interface CompactNotationStats {
  /** 被合并掉的连音线条数 */
  tiesRemoved: number;
  /** 被合并掉的休止符个数 */
  restsRemoved: number;
  /** 被移除的事件总数 */
  eventsRemoved: number;
  /** 被改写的小节数 */
  barsChanged: number;
}

export class ScoreStore {
  private score: Score;
  private readonly history = new History();
  private readonly listeners = new Set<(score: Score, reason: ChangeReason) => void>();

  cursor: CursorState = { barIndex: 0, eventIndex: 0 };
  insertMode = false;

  constructor(score: Score) {
    this.score = score;
    this.clampCursor();
  }

  getScore(): Score {
    return this.score;
  }

  subscribe(fn: (score: Score, reason: ChangeReason) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(reason: ChangeReason): void {
    for (const fn of this.listeners) fn(this.score, reason);
  }

  private snapshot(): void {
    this.history.push(this.score);
  }

  // ---------- 光标 ----------

  private slotCount(bar: Bar): number {
    return bar.events.length + 1;
  }

  totalSlots(): number {
    return this.score.bars.reduce((acc, b) => acc + this.slotCount(b), 0);
  }

  cursorToGlobal(): number {
    let g = 0;
    for (let i = 0; i < this.score.bars.length; i += 1) {
      const bar = this.score.bars[i];
      if (i === this.cursor.barIndex) return g + this.cursor.eventIndex;
      g += this.slotCount(bar);
    }
    return g;
  }

  globalToCursor(g: number): CursorState {
    let acc = 0;
    for (let i = 0; i < this.score.bars.length; i += 1) {
      const bar = this.score.bars[i];
      const count = this.slotCount(bar);
      if (g < acc + count) return { barIndex: i, eventIndex: g - acc };
      acc += count;
    }
    const last = this.score.bars.length - 1;
    return { barIndex: Math.max(0, last), eventIndex: this.score.bars[last]?.events.length ?? 0 };
  }

  private clampCursor(): void {
    const bars = this.score.bars;
    if (bars.length === 0) {
      this.cursor = { barIndex: 0, eventIndex: 0 };
      return;
    }
    const barIndex = Math.min(Math.max(0, this.cursor.barIndex), bars.length - 1);
    const eventIndex = Math.min(Math.max(0, this.cursor.eventIndex), bars[barIndex].events.length);
    this.cursor = { barIndex, eventIndex };
  }

  setCursor(cursor: CursorState): void {
    this.cursor = { ...cursor };
    this.clampCursor();
    this.emit('edit');
  }

  currentSlot(): CursorSlot {
    const bar = this.score.bars[this.cursor.barIndex];
    if (!bar) return { barIndex: 0, eventIndex: 0, event: null };
    return {
      barIndex: this.cursor.barIndex,
      eventIndex: this.cursor.eventIndex,
      event: bar.events[this.cursor.eventIndex] ?? null,
    };
  }

  moveCursor(delta: number): void {
    const next = Math.min(Math.max(0, this.cursorToGlobal() + delta), this.totalSlots() - 1);
    this.cursor = this.globalToCursor(next);
    this.emit('edit');
  }

  setCursorToEvent(eventId: string): boolean {
    for (let b = 0; b < this.score.bars.length; b += 1) {
      const idx = this.score.bars[b].events.findIndex((e) => e.id === eventId);
      if (idx >= 0) {
        this.cursor = { barIndex: b, eventIndex: idx };
        this.emit('edit');
        return true;
      }
    }
    return false;
  }

  /**
   * 播放起点：光标所在的那个记号。光标落在**小节末尾的空槽**（画的是光标符、没有记号）时
   * 往后找第一个记号——「从当前高亮的记号播」在空槽处最自然的落点是下一个记号，
   * 而不是跳回全曲开头。全曲一个记号都没有时返回 `null`（播放器从头播）。
   *
   * 光标在增时线上时原样返回它自己的 id：增时线不是播放计划项，`Player.play()` 会用
   * `findEventBeat` 把它换算成所在长音的拍位，从那个音的开头发声。
   */
  playStartEventId(): string | null {
    const bars = this.score.bars;
    if (bars.length === 0) return null;
    for (let b = Math.min(this.cursor.barIndex, bars.length - 1); b < bars.length; b += 1) {
      const events = bars[b].events;
      const from = b === this.cursor.barIndex ? this.cursor.eventIndex : 0;
      if (from < events.length) return events[from].id;
    }
    return null;
  }

  /**
   * 光标回到全曲开头：「停止」按钮除了淡出消音，还要把高亮送回第一个记号
   * （播放是从高亮处起播的，停完高亮留在第 100 小节，下一次播放就从第 100 小节起，
   * 用户要的「回到开头」没落到实处）。光标不在历史里，所以不 `snapshot()`。
   */
  goToStart(): void {
    this.cursor = { barIndex: 0, eventIndex: 0 };
    this.emit('edit');
  }

  private commit(reason: ChangeReason = 'edit'): void {
    this.clampCursor();
    this.emit(reason);
  }

  // ---------- 事件编辑 ----------

  insertEvent(barIndex: number, index: number, event: ScoreEvent): void {
    const bar = this.score.bars[barIndex];
    if (!bar) return;
    this.snapshot();
    bar.events.splice(Math.min(index, bar.events.length), 0, event);
    this.cursor = { barIndex, eventIndex: index + 1 };
    this.commit();
  }

  replaceEvent(barIndex: number, index: number, event: ScoreEvent): void {
    const bar = this.score.bars[barIndex];
    if (!bar || index < 0 || index >= bar.events.length) return;
    this.snapshot();
    bar.events[index] = event;
    this.cursor = { barIndex, eventIndex: index + 1 };
    this.commit();
  }

  removeEvent(barIndex: number, index: number): void {
    const bar = this.score.bars[barIndex];
    if (!bar || index < 0 || index >= bar.events.length) return;
    this.snapshot();
    bar.events.splice(index, 1);
    this.cursor = { barIndex, eventIndex: Math.min(index, bar.events.length) };
    this.commit();
  }

  patchEvent(barIndex: number, index: number, patch: Partial<ScoreEvent>): void {
    const ev = this.score.bars[barIndex]?.events[index];
    if (!ev) return;
    this.snapshot();
    Object.assign(ev, patch);
    this.commit();
  }

  patchSelected(patch: Partial<ScoreEvent>): void {
    const slot = this.currentSlot();
    if (!slot.event) return;
    this.patchEvent(slot.barIndex, slot.eventIndex, patch);
  }

  /** 在当前光标处写入音符：空槽或插入模式 -> 插入；否则覆盖当前事件 */
  inputNote(degree: Degree, duration: Duration): void {
    const slot = this.currentSlot();
    if (!slot.event || this.insertMode) {
      this.insertEvent(slot.barIndex, slot.eventIndex, makeNote(degree, duration));
      return;
    }
    const keepDuration = slot.event.kind === 'dash' ? duration : slot.event.duration;
    this.replaceEvent(slot.barIndex, slot.eventIndex, {
      ...makeNote(degree, keepDuration),
      id: slot.event.id,
    });
  }

  inputRest(duration: Duration): void {
    const slot = this.currentSlot();
    if (!slot.event || this.insertMode) {
      this.insertEvent(slot.barIndex, slot.eventIndex, makeRest(duration));
      return;
    }
    this.replaceEvent(slot.barIndex, slot.eventIndex, {
      ...makeRest(duration),
      id: slot.event.id,
    });
  }

  inputDash(): void {
    const slot = this.currentSlot();
    const at = slot.event ? slot.eventIndex + 1 : slot.eventIndex;
    const bar = this.score.bars[slot.barIndex];
    const prev = at > 0 && at - 1 < bar.events.length ? bar.events[at - 1] : null;
    if (prev && isNote(prev) && prev.dotted) {
      this.insertEvent(
        slot.barIndex,
        at,
        makeNote(prev.degree, prev.duration, {
          octave: prev.octave,
          accidental: prev.accidental,
          tie: true,
        }),
      );
    } else {
      this.insertEvent(slot.barIndex, at, makeDash());
    }
  }

  setDuration(duration: Duration): void {
    const slot = this.currentSlot();
    const ev = slot.event;
    if (!ev) return;
    if (ev.kind === 'dash') {
      const bar = this.score.bars[slot.barIndex];
      for (let i = slot.eventIndex - 1; i >= 0; i -= 1) {
        if (isNote(bar.events[i])) {
          this.patchEvent(slot.barIndex, i, { duration });
          return;
        }
      }
      return;
    }
    this.patchSelected({ duration });
  }

  toggleDot(): void {
    const ev = this.currentSlot().event;
    if (!ev || ev.kind === 'dash') return;
    this.patchSelected({ dotted: !ev.dotted });
  }

  setAccidental(accidental: Accidental): void {
    const ev = this.currentSlot().event;
    if (!ev || !isNote(ev)) return;
    this.patchSelected({ accidental });
  }

  changeOctave(delta: number): void {
    const ev = this.currentSlot().event;
    if (!ev || !isNote(ev)) return;
    this.patchSelected({ octave: Math.max(-2, Math.min(2, ev.octave + delta)) });
  }

  /**
   * 全曲移调，以半音为单位（正 = 升高，负 = 降低）。
   * - `mode = 'key'`（默认）：只平移调号（1=C → 1=D），谱面数字一个都不动；
   * - `mode = 'notes'`：调号不动，逐音符改写 (音级, 升降号, 八度点)，谱面会出现 # b。
   * 两种写法听到的音高变化相同（详见 core/transpose.ts）。
   * 半音数为 0 时不写入历史；八度点越出 ±2 的音符会被压回并计入 stats.clamped。
   */
  transposeAll(semitones: number, mode: TransposeMode = 'key'): TransposeStats {
    const step = Math.round(semitones);
    if (step === 0) return { notesChanged: 0, clamped: 0 };
    this.snapshot();
    const stats = transposeBars(this.score.bars, this.score.meta.tonic, step, mode);
    if (mode === 'key') this.score.meta.tonic = shiftTonic(this.score.meta.tonic, step);
    this.commit('meta');
    return stats;
  }

  /**
   * 全曲「记号精简」：先合并小节内同音高的连音线链（四分 / 二分 / 全音符 + 增时线），
   * 再合并小节内的连续休止符（三个四分休止 → 一个全休止）。
   * 无可精简时不写入历史，返回的 tiesRemoved / restsRemoved 均为 0。
   */
  compactNotation(opts: CompactNotationOptions = {}): CompactNotationStats {
    const tied = compactTieChains(this.score.bars, opts);
    const rested = compactRestRuns(tied.bars, opts);
    const before = this.score.bars;
    const stats: CompactNotationStats = {
      tiesRemoved: tied.stats.tiesRemoved,
      restsRemoved: rested.stats.restsRemoved,
      eventsRemoved: tied.stats.eventsRemoved + rested.stats.eventsRemoved,
      barsChanged: rested.bars.reduce((n, bar, i) => n + (bar !== before[i] ? 1 : 0), 0),
    };
    if (stats.tiesRemoved === 0 && stats.restsRemoved === 0) return stats;
    this.snapshot();
    this.score.bars = rested.bars;
    this.commit();
    return stats;
  }

  toggleTie(): void {
    const ev = this.currentSlot().event;
    if (!ev || !isNote(ev)) return;
    this.patchSelected({ tie: !ev.tie, slur: ev.tie ? false : ev.slur });
  }

  /**
   * 切换当前音符的圆滑线。
   * 连续标记的三个以上音符共用一条圆滑线；当前音符是全曲第一个音符时改为向后连接。
   */
  toggleSlur(): void {
    const slot = this.currentSlot();
    const ev = slot.event;
    if (!ev || !isNote(ev)) return;

    if (ev.slur) {
      this.patchSelected({ slur: false });
      return;
    }

    const notes = this.notePositions();
    const at = notes.findIndex((p) => p.barIndex === slot.barIndex && p.eventIndex === slot.eventIndex);
    if (at === 0) {
      const { hasNext, extended } = this.slurExtendsToNext(slot.barIndex, slot.eventIndex);
      if (hasNext) this.extendSlur(slot.barIndex, slot.eventIndex, !extended);
      return;
    }

    this.patchSelected({ slur: true, tie: false });
  }

  // ---------- 圆滑线组 ----------

  /** 按文档顺序列出所有音符的位置（休止符与延长线不打断圆滑线） */
  private notePositions(): { barIndex: number; eventIndex: number; note: NoteEvent }[] {
    const out: { barIndex: number; eventIndex: number; note: NoteEvent }[] = [];
    this.score.bars.forEach((bar, barIndex) => {
      bar.events.forEach((event, eventIndex) => {
        if (isNote(event)) out.push({ barIndex, eventIndex, note: event });
      });
    });
    return out;
  }

  /** 该音符所属圆滑线的范围；不在任何圆滑线内时返回 null */
  slurSpanOf(barIndex: number, eventIndex: number): SlurSpan | null {
    const notes = this.notePositions();
    const at = notes.findIndex((p) => p.barIndex === barIndex && p.eventIndex === eventIndex);
    if (at < 0) return null;

    let first = at;
    while (first > 0 && notes[first].note.slur) first -= 1;
    let last = at;
    while (last + 1 < notes.length && notes[last + 1].note.slur) last += 1;
    if (first === last) return null;

    return {
      startBar: notes[first].barIndex,
      startIndex: notes[first].eventIndex,
      endBar: notes[last].barIndex,
      endIndex: notes[last].eventIndex,
      noteCount: last - first + 1,
    };
  }

  /** 圆滑线是否已经连向下一个音符（同时回答是否存在下一个音符） */
  slurExtendsToNext(barIndex: number, eventIndex: number): { hasNext: boolean; extended: boolean } {
    const notes = this.notePositions();
    const at = notes.findIndex((p) => p.barIndex === barIndex && p.eventIndex === eventIndex);
    if (at < 0 || at + 1 >= notes.length) return { hasNext: false, extended: false };
    return { hasNext: true, extended: notes[at + 1].note.slur };
  }

  /** 把圆滑线延伸（value 为 false 时收回）到下一个音符，可连续调用以覆盖三个以上音符 */
  extendSlur(barIndex: number, eventIndex: number, value: boolean): void {
    const notes = this.notePositions();
    const at = notes.findIndex((p) => p.barIndex === barIndex && p.eventIndex === eventIndex);
    if (at < 0 || at + 1 >= notes.length) return;
    const next = notes[at + 1];
    this.patchEvent(next.barIndex, next.eventIndex, { slur: value, tie: false });
  }

  toggleTriplet(): void {
    const ev = this.currentSlot().event;
    if (!ev || !isNote(ev)) return;
    this.patchSelected({ triplet: !ev.triplet });
  }

  setLyric(lyric: string): void {
    const ev = this.currentSlot().event;
    if (!ev || !isNote(ev)) return;
    this.patchSelected({ lyric });
  }
  // ---------- 小节操作 ----------

  insertBar(afterBarIndex: number): void {
    this.snapshot();
    const at = Math.min(Math.max(0, afterBarIndex + 1), this.score.bars.length);
    this.score.bars.splice(at, 0, makeBar([]));
    this.cursor = { barIndex: at, eventIndex: 0 };
    this.commit();
  }

  removeBar(barIndex: number): void {
    if (barIndex < 0 || barIndex >= this.score.bars.length) return;
    if (this.score.bars.length <= 1) return;
    this.snapshot();
    this.score.bars.splice(barIndex, 1);
    this.cursor = { barIndex: Math.min(barIndex, this.score.bars.length - 1), eventIndex: 0 };
    this.commit();
  }

  setBarline(barIndex: number, side: 'left' | 'right', kind: BarlineKind): void {
    const bar = this.score.bars[barIndex];
    if (!bar) return;
    this.snapshot();
    bar[side] = kind;
    this.commit();
  }

  moveEvent(fromBar: number, fromIndex: number, toBar: number, toIndex: number): void {
    const src = this.score.bars[fromBar];
    const dst = this.score.bars[toBar];
    if (!src || !dst) return;
    if (fromBar === toBar && fromIndex === toIndex) return;
    this.snapshot();
    const [moved] = src.events.splice(fromIndex, 1);
    const adjusted = fromBar === toBar && fromIndex < toIndex ? toIndex - 1 : toIndex;
    dst.events.splice(Math.min(Math.max(0, adjusted), dst.events.length), 0, moved);
    this.cursor = { barIndex: toBar, eventIndex: Math.min(adjusted, dst.events.length - 1) };
    this.commit();
  }

  /** 末尾追加一个小节（若最后一节已有内容） */
  ensureTrailingBar(): void {
    const bars = this.score.bars;
    if (bars.length === 0 || bars[bars.length - 1].events.length > 0) {
      this.snapshot();
      bars.push(makeBar([]));
      this.commit();
    }
  }

  // ---------- 元信息 / 整体替换 ----------

  setMeta(patch: Partial<Meta>): void {
    this.snapshot();
    Object.assign(this.score.meta, patch);
    this.emit('meta');
  }

  replaceScore(next: Score, reason: ChangeReason = 'load'): void {
    this.snapshot();
    this.score = next;
    this.cursor = { barIndex: 0, eventIndex: 0 };
    this.emit(reason);
  }

  // ---------- 撤销 / 重做 ----------

  undo(): void {
    const prev = this.history.undo(this.score);
    if (!prev) return;
    this.score = prev;
    this.clampCursor();
    this.emit('undo');
  }

  redo(): void {
    const next = this.history.redo(this.score);
    if (!next) return;
    this.score = next;
    this.clampCursor();
    this.emit('redo');
  }

  get canUndo(): boolean {
    return this.history.canUndo;
  }

  get canRedo(): boolean {
    return this.history.canRedo;
  }

  selectedNote(): NoteEvent | null {
    const ev = this.currentSlot().event;
    return ev && isNote(ev) ? ev : null;
  }
}