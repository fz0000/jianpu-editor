import './styles.css';

import { Player } from './audio/player';
import { formatTonic, midiToNoteName } from './core/constants';
import { ScoreStore } from './core/document';
import { parseJianpuText } from './core/jianpu-text';
import { scaledSize } from './core/layout';
import { DEFAULT_FONT_SIZE, FONT_SIZE_STEPS, fontSizeLabel, snapFontSize } from './core/metrics';
import { barBeatLength, makeNote, measureBeats, type Accidental, type BarlineKind, type Duration, type Score } from './core/model';
import { scoreToSvgString } from './core/render';
import { effectiveKeyShift, intervalName, type TransposeMode } from './core/transpose';
import { exportPng } from './io/export-image';
import {
  deserializeScore,
  downloadBlob,
  downloadBytes,
  downloadText,
  loadFromLocal,
  safeFilename,
  saveToLocal,
  serializeScore,
} from './io/json';
import { exportScoreToMidi } from './midi/export';
import { emptyScore, twinkleScore } from './samples';
import { NoteEditor } from './ui/editor';
import { openHelpDialog } from './ui/helpDialog';
import { openImportDialog } from './ui/importDialog';
import { MetaPanel } from './ui/metaPanel';
import { ScoreView } from './ui/scoreView';
import { dispatchEditKey, type EditKeyHandlers } from './ui/shortcuts';
import { Toolbar, type ToolbarState } from './ui/toolbar';
import { toast } from './ui/toast';
import { openTransposeDialog } from './ui/transposeDialog';
import { Transport } from './ui/transport';

function $(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`缺少元素 #${id}`);
  return el;
}

class App {
  private readonly store: ScoreStore;
  private readonly view: ScoreView;
  private readonly toolbar: Toolbar;
  private readonly transport: Transport;
  private readonly metaPanel: MetaPanel;
  private readonly noteEditor: NoteEditor;
  private readonly player = new Player();
  private readonly statusHint = $('status-hint');
  private readonly statusInfo = $('status-info');
  private readonly dialogLayer = $('dialog-layer');
  private readonly midiInput = $('file-midi') as HTMLInputElement;
  private readonly jsonInput = $('file-json') as HTMLInputElement;
  private currentDuration: Duration = 4;
  private renderQueued = false;
  private saveTimer = 0;
  /** 上一次的光标位置（`bar:idx` 形式），用来发现「暂停期间用户移动了高亮」 */
  private lastCursorKey = '';

  constructor() {
    const stored = loadFromLocal();
    this.store = new ScoreStore(stored ?? twinkleScore());
    this.noteEditor = new NoteEditor(this.store);
    this.view = new ScoreView($('score-scroll'), this.store, {
      onBlockClick: (info) => this.noteEditor.open(info.barIndex, info.eventIndex, info.group),
    });
    this.metaPanel = new MetaPanel($('meta-panel'), this.store, {
      onImportText: (text) => this.importText(text),
      onNewScore: () => this.newScore(),
    });
    this.toolbar = new Toolbar($('toolbar'), {
      onDuration: (d) => {
        this.currentDuration = d;
        this.store.setDuration(d);
      },
      onDot: () => this.store.toggleDot(),
      onAccidental: (a: Accidental) => this.store.setAccidental(a),
      onOctave: (delta) => (delta === 0 ? this.clearOctave() : this.store.changeOctave(delta)),
      onTranspose: (delta) => this.transposeAll(delta, 'key'),
      onTransposeDialog: () => this.openTransposeDialog(),
      onTriplet: () => this.store.toggleTriplet(),
      onTie: () => this.store.toggleTie(),
      onSlur: () => this.store.toggleSlur(),
      onRest: () => this.inputRest(),
      onDash: () => this.inputDash(),
      onDelete: () => this.deleteCurrent(),
      onToggleInsertMode: () => this.toggleInsertMode(),
      onInsertBar: () => this.store.insertBar(this.store.cursor.barIndex),
      onRemoveBar: () => this.store.removeBar(this.store.cursor.barIndex),
      onBarline: (kind: BarlineKind) => this.applyBarline(kind),
      onCompactNotation: () => this.compactNotation(),
      onFontSize: (delta) => this.stepFontSize(delta),
      onUndo: () => this.store.undo(),
      onRedo: () => this.store.redo(),
    });
    this.transport = new Transport($('transport'), {
      onPlayPause: () => this.togglePlay(),
      onStop: () => this.stop(),
      onTempo: (v) => this.store.setMeta({ tempo: v }),
      onRate: (v) => this.player.setRate(v),
      onLoop: (v) => this.player.setLoop(v),
      onInstrument: (v) => this.store.setMeta({ instrument: v }),
    });

    this.lastCursorKey = this.cursorKey();
    this.store.subscribe(() => {
      this.dropResumePointOnCursorMove();
      this.scheduleRender();
    });
    this.metaPanel.bind();
    this.bindTopBar();
    this.bindKeyboard();
    window.addEventListener('resize', () => this.view.render());

    this.player.onNote = (note) => {
      this.view.setPlaying(note ? note.eventId : null);
      // 暂停时 player.pause() 也送来一个 null 用来清高亮，位置栏要留住「停在哪一小节」
      if (!note && this.player.isPaused) return;
      // 休止符没有音高（midi 是 NaN），位置栏写「休止」
      const label = note ? (note.kind === 'rest' ? '休止' : midiToNoteName(note.midi)) : null;
      this.transport.setPosition(note ? note.barIndex : null, label);
    };
    this.player.onEnd = () => {
      this.transport.setState('stopped');
      this.transport.setPosition(null, null);
      // 播完一遍也落回开头：位置栏已经写「未播放」，高亮留在最后一个音上的话，
      // 下一次播放只会播那一个音——与「停止」按钮共用同一套落点
      this.rewindToStart();
    };

    this.scheduleRender();
    if (!stored) toast('已载入示例乐谱，可直接编辑或导入 MIDI');
  }

  private scheduleRender(): void {
    if (this.renderQueued) return;
    this.renderQueued = true;
    requestAnimationFrame(() => {
      this.renderQueued = false;
      this.view.render();
      this.syncPanels();
      this.queueSave();
    });
  }

  private syncPanels(): void {
    const score = this.store.getScore();
    const note = this.store.selectedNote();
    const state: ToolbarState = {
      duration: this.currentDuration,
      dotted: note?.dotted ?? false,
      accidental: note?.accidental ?? 'natural',
      octave: note?.octave ?? 0,
      triplet: note?.triplet ?? false,
      tie: note?.tie ?? false,
      slur: note?.slur ?? false,
      insertMode: this.store.insertMode,
      fontSize: snapFontSize(score.meta.fontSize),
      canUndo: this.store.canUndo,
      canRedo: this.store.canRedo,
      hasSelection: !!this.store.currentSlot().event,
    };
    this.toolbar.update(state);
    this.metaPanel.sync(score);
    this.transport.setTempo(score.meta.tempo);
    this.transport.setInstrument(score.meta.instrument);
    this.updateStatus(score);
  }

  private updateStatus(score: Score): void {
    const slot = this.store.currentSlot();
    const ev = slot.event;
    const mode = this.store.insertMode ? '插入' : '覆盖';
    const current = ev
      ? ev.kind === 'note'
        ? `${ev.degree}${ev.octave > 0 ? "'".repeat(ev.octave) : ''}${ev.octave < 0 ? ','.repeat(-ev.octave) : ''}${ev.dotted ? '.' : ''}`
        : ev.kind === 'rest'
          ? '休止符'
          : '延长线'
      : '空槽';
    this.statusHint.textContent = `光标：第 ${slot.barIndex + 1} 小节 · ${current} · 输入模式：${mode}`;
    const lineBreak =
      score.meta.barsPerLine > 0 ? `每行 ${score.meta.barsPerLine} 小节` : '自动行折';
    this.statusInfo.textContent =
      `${score.bars.length} 小节 · 1=${formatTonic(score.meta.tonic)} · ${score.meta.timeSig.num}/${score.meta.timeSig.den} · ♩=${score.meta.tempo} · 字号 ${snapFontSize(score.meta.fontSize)} · ${lineBreak}`;
  }

  private queueSave(): void {
    window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => saveToLocal(this.store.getScore()), 800);
  }
  // ---------- 输入 ----------

  private maybeExtendBar(): void {
    const score = this.store.getScore();
    const cursor = this.store.cursor;
    const bar = score.bars[cursor.barIndex];
    if (!bar) return;
    const full = barBeatLength(bar) >= measureBeats(score.meta.timeSig) - 1e-9;
    if (cursor.eventIndex >= bar.events.length && full) {
      this.store.insertBar(cursor.barIndex);
    }
  }

  private inputNote(degree: 1 | 2 | 3 | 4 | 5 | 6 | 7): void {
    this.maybeExtendBar();
    this.store.inputNote(degree, this.currentDuration);
  }

  private inputRest(): void {
    this.maybeExtendBar();
    this.store.inputRest(this.currentDuration);
  }

  private inputDash(): void {
    this.store.inputDash();
  }

  private deleteCurrent(): void {
    const slot = this.store.currentSlot();
    if (slot.event) this.store.removeEvent(slot.barIndex, slot.eventIndex);
  }

  private clearOctave(): void {
    const note = this.store.selectedNote();
    if (note) this.store.patchSelected({ octave: 0 });
  }

  private toggleInsertMode(): void {
    this.store.insertMode = !this.store.insertMode;
    this.scheduleRender();
  }

  private applyBarline(kind: BarlineKind): void {
    const barIndex = this.store.cursor.barIndex;
    this.store.setBarline(barIndex, 'right', kind);
    if (kind === 'repeat-start') this.store.setBarline(barIndex, 'left', 'repeat-start');
    if (kind === 'normal') this.store.setBarline(barIndex, 'left', 'normal');
  }

  /**
   * 全曲记号精简：小节内同音连音线链 → 更长时值（四分 / 二分 / 全音符 + 增时线）；
   * 小节内连续休止符 → 更少的休止符。
   * 合并会删掉记号，所以先停播放、关浮层，避免高亮与编辑浮层指向已删除的记号。
   */
  private compactNotation(): void {
    this.stop();
    this.noteEditor.close();
    const stats = this.store.compactNotation();
    if (stats.tiesRemoved === 0 && stats.restsRemoved === 0) {
      toast('没有可精简的记号：同音长音已写成「数字 + 增时线」，休止符已是最少个数', 'warn');
      return;
    }
    const parts: string[] = [];
    if (stats.tiesRemoved > 0) parts.push(`${stats.tiesRemoved} 条连音线`);
    if (stats.restsRemoved > 0) parts.push(`${stats.restsRemoved} 个休止`);
    toast(
      `已合并 ${parts.join('、')}（${stats.barsChanged} 个小节，省掉 ${stats.eventsRemoved} 个记号）`,
    );
  }

  /**
   * 全曲移调：以半音为单位升降任意度（正 = 升高）。
   * mode = 'key'（默认）只平移调号（1=C → 1=D），谱面数字一个都不动；
   * mode = 'notes' 调号不动，逐音符改写音级 / 升降号 / 八度点。
   * 移调不增删记号，播放高亮指向的记号仍然存在，所以不必先停播放。
   */
  private transposeAll(semitones: number, mode: TransposeMode): void {
    const step = Math.round(semitones);
    if (step === 0) return;
    const from = this.store.getScore().meta.tonic;
    const stats = this.store.transposeAll(step, mode);
    const to = this.store.getScore().meta.tonic;
    const abs = Math.abs(step);
    const dir = step > 0 ? '升高' : '降低';
    let detail: string;
    if (mode === 'key') {
      // 调主只有音名，发声时落在 C4–B4 窗口，所以实际变化可能与请求差整八度（见 core/transpose.ts）
      const shift = effectiveKeyShift(from, to);
      const eff =
        shift === 0
          ? '发声不变（请求幅度是整八度）'
          : `发声${shift > 0 ? '升高' : '降低'} ${Math.abs(shift)} 个半音` +
            (shift !== step ? '（与请求相差整八度：八度位置由调号决定）' : '');
      detail = `调号 1=${formatTonic(from)} → 1=${formatTonic(to)}，谱面数字不变，${eff}`;
    } else {
      detail = `调号 1=${formatTonic(from)} 不变，改写 ${stats.notesChanged} 个音符`;
    }
    toast(`全曲${dir} ${abs} 个半音（${intervalName(abs)}）：${detail}`);
    if (stats.clamped > 0) {
      toast(
        `注意：${stats.clamped} 个音符的八度点越出 ±2，已压回（音高相差一个八度）；改用「改调号」方式移调没有这个限制`,
        'warn',
        6000,
      );
    }
  }

  private openTransposeDialog(): void {
    const apply = (semitones: number, mode: TransposeMode): void => this.transposeAll(semitones, mode);
    openTransposeDialog(this.dialogLayer, this.store.getScore(), apply);
  }


  /**
   * 谱面字号：在档位表（FONT_SIZE_STEPS）里上下走一格，delta = 0 恢复标准字号。
   * 字号存在 meta 里（随工程文件保存、可撤销），是整张谱面的等比缩放，
   * 排版层据此重排每行小节数（见 core/layout.ts），渲染层整体放大 SVG（见 core/render.ts）。
   */
  private stepFontSize(delta: number): void {
    const steps = FONT_SIZE_STEPS;
    const current = snapFontSize(this.store.getScore().meta.fontSize);
    const index = steps.indexOf(current);
    const nextIndex =
      delta === 0
        ? steps.indexOf(DEFAULT_FONT_SIZE)
        : Math.max(0, Math.min(steps.length - 1, index + delta));
    const next = steps[nextIndex];
    if (next === current) {
      if (delta !== 0) toast(`字号已到端点：${current}（${fontSizeLabel(current)}）`, 'warn');
      return;
    }
    this.store.setMeta({ fontSize: next });
    // 连按快捷键时提示会叠放，这里用较短停留时间
    toast(`谱面字号：${next}（${fontSizeLabel(next)}）`, 'info', 1400);
  }

  private importText(text: string): void {
    const { bars, errors } = parseJianpuText(text);
    if (bars.length === 0 || bars.every((b) => b.events.length === 0)) {
      toast('文本中没有可解析的记号', 'warn');
      return;
    }
    const score = this.store.getScore();
    this.store.replaceScore({ version: 1, meta: { ...score.meta }, bars }, 'load');
    if (errors.length > 0) toast(`已导入，但有 ${errors.length} 处记号无法识别：${errors.slice(0, 3).join('；')}`, 'warn', 5000);
    else toast(`已导入 ${bars.length} 小节`);
  }

  private newScore(): void {
    this.store.replaceScore(emptyScore(), 'load');
    toast('已新建空白乐谱');
  }

  // ---------- 播放 ----------

  /**
   * 播放按钮的三态切换：**播放中 → 暂停（保留断点）→ 再按从断点续播**，
   * 停止态则从**当前高亮的记号**起播（暂停期间移动过高亮时断点已作废，见
   * `dropResumePointOnCursorMove`，于是落回这一条）。「停止」是另一个按钮（`stop()`），两下不重复。
   */
  private togglePlay(): void {
    if (this.player.isPlaying) {
      this.pause();
      return;
    }
    const score = this.store.getScore();
    this.player.setInstrument(score.meta.instrument);
    if (this.player.isPaused) {
      this.player.resume(score);
      this.transport.setState('playing');
      return;
    }
    try {
      // 从当前高亮的记号起播；光标落在小节末尾空槽时取下一个记号（`playStartEventId`）
      this.player.play(score, this.store.playStartEventId());
      this.transport.setState('playing');
    } catch (error) {
      toast(error instanceof Error ? error.message : '播放失败', 'error');
    }
  }

  /** 暂停：淡出消音、断点留在 `Player` 里，按钮弹起（位置栏不动，看得见停在哪） */
  private pause(): void {
    this.player.pause();
    this.transport.setState('paused');
  }

  /** 光标的「小节:槽位」键（比较光标动过没有，不新建对象） */
  private cursorKey(): string {
    const { barIndex, eventIndex } = this.store.cursor;
    return `${barIndex}:${eventIndex}`;
  }

  /**
   * 暂停期间移动高亮 → **断点作废**：「继续」按钮打回「播放」、位置栏清成「未播放」，
   * 下一次点击从**新高亮的记号**起播（`playStartEventId`）。
   * 断点留着的话，暂停后点第 40 小节再按 Space 会从旧断点续播，新高亮被完全无视——
   * 按钮写着「继续」，播出来的却不是那里。
   * 播放中移动光标不作废：正在响的声音不该被一次点击打断（那一下只是选中记号）。
   */
  private dropResumePointOnCursorMove(): void {
    const key = this.cursorKey();
    const moved = key !== this.lastCursorKey;
    this.lastCursorKey = key;
    if (!moved || !this.player.isPaused) return;
    this.player.cancelResume();
    this.transport.setState('stopped');
    this.transport.setPosition(null, null);
  }

  /**
   * 停止：淡出消音 + 回到开头。位置栏清成「未播放」，**光标高亮也送回全曲第一个记号**
   * 并滚进可视区——播放是从高亮处起播的，高亮留在第 100 小节的话，下一次播放
   * 就从第 100 小节起，「回到开头」等于没做到。
   */
  private stop(): void {
    this.player.stop();
    this.transport.setState('stopped');
    this.transport.setPosition(null, null);
    this.rewindToStart();
  }

  /** 光标高亮送回全曲第一个记号并滚进可视区（「停止」按钮与「播完一遍」共用） */
  private rewindToStart(): void {
    this.store.goToStart();
    // 先同步重排重绘，`revealCursor()` 才是在新的 DOM 上找那个记号
    this.view.render();
    this.view.revealCursor();
  }

  // ---------- 导入 / 导出 ----------

  private bindTopBar(): void {
    $('btn-import-midi').addEventListener('click', () => this.midiInput.click());
    $('btn-export-midi').addEventListener('click', () => this.exportMidi());
    $('btn-open-json').addEventListener('click', () => this.jsonInput.click());
    $('btn-save-json').addEventListener('click', () => this.exportJson());
    $('btn-export-svg').addEventListener('click', () => this.exportSvg());
    $('btn-export-png').addEventListener('click', () => void this.exportPng());
    $('btn-print').addEventListener('click', () => window.print());
    $('btn-help').addEventListener('click', () => openHelpDialog(this.dialogLayer));

    this.midiInput.addEventListener('change', () => {
      const file = this.midiInput.files?.[0];
      if (!file) return;
      file.arrayBuffer().then((data) => {
        const title = file.name.replace(/\.[^.]+$/, '');
        openImportDialog(this.dialogLayer, data, title, (score) => {
          this.store.replaceScore(score, 'import');
        });
      });
      this.midiInput.value = '';
    });

    this.jsonInput.addEventListener('change', () => {
      const file = this.jsonInput.files?.[0];
      if (!file) return;
      file.text().then((text) => {
        try {
          this.store.replaceScore(deserializeScore(text), 'load');
          toast('已打开 JSON 乐谱');
        } catch (error) {
          toast(error instanceof Error ? error.message : '打开失败', 'error', 6000);
        }
      });
      this.jsonInput.value = '';
    });
  }

  private exportMidi(): void {
    try {
      const { bytes, noteCount } = exportScoreToMidi(this.store.getScore());
      downloadBytes(bytes, safeFilename(this.store.getScore().meta.title, 'mid'), 'audio/midi');
      toast(`已导出 MIDI（${noteCount} 个音符）`);
    } catch (error) {
      toast(error instanceof Error ? error.message : '导出 MIDI 失败', 'error', 6000);
    }
  }

  private exportJson(): void {
    downloadText(serializeScore(this.store.getScore()), safeFilename(this.store.getScore().meta.title, 'json'));
    toast('已保存 JSON');
  }

  private exportSvg(): void {
    const layout = this.view.getLayout();
    if (!layout) return;
    downloadText(
      scoreToSvgString(this.store.getScore(), layout),
      safeFilename(this.store.getScore().meta.title, 'svg'),
      'image/svg+xml;charset=utf-8',
    );
    toast('已导出 SVG');
  }

  private async exportPng(): Promise<void> {
    const layout = this.view.getLayout();
    if (!layout) return;
    // PNG 按「谱面字号下的实际尺寸 × 2」光栅化，导出结果与屏幕上看到的字号一致
    const size = scaledSize(layout);
    try {
      const blob = await exportPng(scoreToSvgString(this.store.getScore(), layout), size.width, size.height, 2);
      downloadBlob(blob, safeFilename(this.store.getScore().meta.title, 'png'));
      toast('已导出 PNG');
    } catch (error) {
      toast(error instanceof Error ? error.message : '导出 PNG 失败', 'error', 6000);
    }
  }

  // ---------- 键盘 ----------

  private bindKeyboard(): void {
    document.addEventListener('keydown', (event) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')) return;
      if (this.dialogLayer.hidden === false) return;
      dispatchEditKey(event, this.keyHandlers());
    });
  }

  private keyHandlers(): EditKeyHandlers {
    const barCount = () => this.store.getScore().bars.length;
    return {
      note: (degree) => this.inputNote(degree),
      rest: () => this.inputRest(),
      dash: () => this.inputDash(),
      duration: (d) => this.setDuration(d),
      dot: () => this.store.toggleDot(),
      accidental: (a) => this.store.setAccidental(a),
      octaveUp: () => this.store.changeOctave(1),
      octaveDown: () => this.store.changeOctave(-1),
      transposeUp: () => this.transposeAll(1, 'key'),
      transposeDown: () => this.transposeAll(-1, 'key'),
      transposeDialog: () => this.openTransposeDialog(),
      triplet: () => this.store.toggleTriplet(),
      tie: () => this.store.toggleTie(),
      slur: () => this.store.toggleSlur(),
      compactNotation: () => this.compactNotation(),
      fontSizeUp: () => this.stepFontSize(1),
      fontSizeDown: () => this.stepFontSize(-1),
      cursorMove: (delta) => this.store.moveCursor(delta),
      barMove: (delta) =>
        this.store.setCursor({
          barIndex: Math.min(Math.max(0, this.store.cursor.barIndex + delta), barCount() - 1),
          eventIndex: 0,
        }),
      appendNote: () => this.insertAtCursor(),
      remove: () => this.deleteCurrent(),
      toggleInsertMode: () => this.toggleInsertMode(),
      togglePlay: () => this.togglePlay(),
      stop: () => {
        this.noteEditor.close();
        this.stop();
      },
      edit: () => {
        if (!this.noteEditor.openAtCursor()) toast('当前槽位没有可编辑的记号', 'warn');
      },
      undo: () => this.store.undo(),
      redo: () => this.store.redo(),
      importMidi: () => this.midiInput.click(),
      saveJson: () => this.exportJson(),
    };
  }

  private insertAtCursor(): void {
    const slot = this.store.currentSlot();
    const bar = this.store.getScore().bars[slot.barIndex];
    if (!bar) return;
    this.store.insertEvent(
      slot.barIndex,
      Math.min(slot.eventIndex + 1, bar.events.length),
      makeNote(1, this.currentDuration),
    );
  }

  private setDuration(duration: Duration): void {
    this.currentDuration = duration;
    this.store.setDuration(duration);
  }
}

const app = new App();
export { app };