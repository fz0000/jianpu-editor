import { describe, expect, it } from 'vitest';
import {
  ALL_TONICS,
  formatTonic,
  keySignatureSharps,
  mappingToMidi,
  parseTonic,
  shiftTonic,
  tonicFromSharps,
  tonicMidiBase,
} from '../src/core/constants';
import { ScoreStore } from '../src/core/document';
import { scoreToMidiFile } from '../src/midi/export';
import {
  barBeatLength,
  isNote,
  makeBar,
  makeDash,
  makeNote,
  makeRest,
  makeScore,
  type Bar,
  type Score,
  type Tonic,
} from '../src/core/model';
import {
  MAX_OCTAVE_DOT,
  effectiveKeyShift,
  formatPitch,
  intervalName,
  previewNotes,
  transposeBars,
  transposeNotesInPlace,
  transposeStatsFor,
} from '../src/core/transpose';

/** 全曲音高写法序列，用来比较「谱面有没有被改写」 */
function pitchText(bars: Bar[]): string[] {
  const out: string[] = [];
  for (const bar of bars) {
    for (const ev of bar.events) if (isNote(ev)) out.push(formatPitch(ev));
  }
  return out;
}

/** 全曲的绝对音高（MIDI 音号）序列 */
function midiPitches(bars: Bar[], tonic: Tonic): number[] {
  const base = tonicMidiBase(tonic);
  const out: number[] = [];
  for (const bar of bars) {
    for (const ev of bar.events) {
      if (!isNote(ev)) continue;
      out.push(mappingToMidi({ degree: ev.degree, accidental: ev.accidental, octave: ev.octave }, base));
    }
  }
  return out;
}

function sampleScore(tonic = 'C'): Score {
  return makeScore({ tonic: parseTonic(tonic), timeSig: { num: 4, den: 4 } }, [
    // 1 3 5 7,（低音 7）
    makeBar([makeNote(1, 4), makeNote(3, 4), makeNote(5, 4), makeNote(7, 4, { octave: -1 })]),
    // 1'（高音 1）二分 + 增时线
    makeBar([makeNote(1, 2, { octave: 1 }), makeDash()]),
    // 休止 + 带连音线的同音对
    makeBar([makeRest(4), makeNote(6, 4), makeNote(6, 4, { tie: true }), makeNote(6, 4, { tie: true })]),
  ]);
}

describe('shiftTonic：调号按半音平移', () => {
  it('C 调向上用升号、向下用降号；升降号调沿用原调的升降偏好', () => {
    expect(formatTonic(shiftTonic(parseTonic('C'), 2))).toBe('D');
    expect(formatTonic(shiftTonic(parseTonic('C'), 1))).toBe('C#');
    expect(formatTonic(shiftTonic(parseTonic('C'), -2))).toBe('bB');
    expect(formatTonic(shiftTonic(parseTonic('F'), 1))).toBe('bG');
    expect(formatTonic(shiftTonic(parseTonic('bE'), -1))).toBe('D');
    expect(formatTonic(shiftTonic(parseTonic('D'), 1))).toBe('D#');
  });

  it('平移 12 个半音回到同一个调', () => {
    expect(formatTonic(shiftTonic(parseTonic('bA'), 12))).toBe('bA');
    expect(formatTonic(shiftTonic(parseTonic('G'), -12))).toBe('G');
  });
});

describe('全曲移调 mode = key：只平移调号', () => {
  it('谱面数字一个都不动，绝对音高整体移动所选半音数', () => {
    const score = sampleScore();
    const beforePitches = pitchText(score.bars);
    const beforeMidi = midiPitches(score.bars, score.meta.tonic);

    const stats = transposeBars(score.bars, score.meta.tonic, 2, 'key');
    score.meta.tonic = shiftTonic(score.meta.tonic, 2);

    expect(stats).toEqual({ notesChanged: 0, clamped: 0 });
    expect(pitchText(score.bars)).toEqual(beforePitches);
    expect(formatTonic(score.meta.tonic)).toBe('D');
    expect(midiPitches(score.bars, score.meta.tonic)).toEqual(beforeMidi.map((m) => m + 2));
  });

  it('降 5 个半音（纯四度）：1=C → 1=G，音级整体下移 5 个半音（模八度）', () => {
    const score = sampleScore();
    const beforeMidi = midiPitches(score.bars, score.meta.tonic);
    transposeBars(score.bars, score.meta.tonic, -5, 'key');
    score.meta.tonic = shiftTonic(score.meta.tonic, -5);
    expect(formatTonic(score.meta.tonic)).toBe('G');
    const after = midiPitches(score.bars, score.meta.tonic).map((m) => ((m % 12) + 12) % 12);
    expect(after).toEqual(beforeMidi.map((m) => (((m - 5) % 12) + 12) % 12));
  });

  it('调主固定落在 C4–B4 窗口：C 调降低 5 个半音后发声升高 7 个半音（差一个八度）', () => {
    expect(effectiveKeyShift(parseTonic('C'), parseTonic('G'))).toBe(7);
    expect(effectiveKeyShift(parseTonic('C'), parseTonic('D'))).toBe(2);
    expect(effectiveKeyShift(parseTonic('C'), parseTonic('bB'))).toBe(10);
  });
});

describe('全曲移调 mode = notes：调号不动，逐音符改写', () => {
  it('C 调升 2 个半音：1 3 5 → 2 #4 6，调号保持 1=C', () => {
    const score = sampleScore();
    const stats = transposeNotesInPlace(score.bars, score.meta.tonic, 2);
    expect(formatTonic(score.meta.tonic)).toBe('C');
    expect(pitchText(score.bars).slice(0, 3)).toEqual(['2', '#4', '6']);
    expect(stats.clamped).toBe(0);
    expect(stats.notesChanged).toBeGreaterThan(0);
  });

  it('降号调按降号拼写：1=bB 升 1 个半音 → b2 4 b6', () => {
    const score = sampleScore('bB');
    transposeNotesInPlace(score.bars, score.meta.tonic, 1);
    expect(pitchText(score.bars).slice(0, 3)).toEqual(['b2', '4', 'b6']);
  });

  it('八度点随音高走：低音 7, 升 2 个半音 → #1（回到本位八度）', () => {
    const score = sampleScore();
    transposeNotesInPlace(score.bars, score.meta.tonic, 2);
    expect(pitchText(score.bars)[3]).toBe('#1');
  });

  it('八度点钳制在 ±2：越界的音符计入 clamped', () => {
    const bars = [makeBar([makeNote(1, 4, { octave: MAX_OCTAVE_DOT })])];
    const stats = transposeNotesInPlace(bars, parseTonic('C'), 13);
    expect(bars[0].events[0]).toMatchObject({ kind: 'note', degree: 1, octave: MAX_OCTAVE_DOT });
    expect(stats.clamped).toBe(1);
  });

  it('连音线链里的音符保持同音高（连音线不会被移调打断）', () => {
    const score = sampleScore();
    transposeNotesInPlace(score.bars, score.meta.tonic, 6);
    const third = score.bars[2].events.filter(isNote);
    expect(third).toHaveLength(3);
    expect(third.every((n) => formatPitch(n) === formatPitch(third[0]))).toBe(true);
  });

  it('小节拍数与事件数守恒，升 5 再降 5 回到原谱', () => {
    const score = sampleScore();
    const beatsBefore = score.bars.map(barBeatLength);
    const countBefore = score.bars.map((b) => b.events.length);
    const textBefore = pitchText(score.bars);

    transposeNotesInPlace(score.bars, score.meta.tonic, 5);
    expect(score.bars.map(barBeatLength)).toEqual(beatsBefore);
    expect(score.bars.map((b) => b.events.length)).toEqual(countBefore);

    transposeNotesInPlace(score.bars, score.meta.tonic, -5);
    expect(pitchText(score.bars)).toEqual(textBefore);
  });

  it('transposeStatsFor 只统计，不碰谱面', () => {
    const score = sampleScore();
    const before = pitchText(score.bars);
    const stats = transposeStatsFor(score.bars, score.meta.tonic, 25);
    expect(stats.clamped).toBeGreaterThan(0);
    expect(pitchText(score.bars)).toEqual(before);
  });
});

describe('previewNotes / intervalName', () => {
  it('key 模式预览前后写法相同（数字不变）', () => {
    const score = sampleScore();
    const preview = previewNotes(score.bars, score.meta.tonic, 3, 'key', 4);
    expect(preview.before).toEqual(preview.after);
    expect(preview.before).toHaveLength(4);
  });

  it('notes 模式预览给出改写后的写法', () => {
    const score = sampleScore();
    const preview = previewNotes(score.bars, score.meta.tonic, 1, 'notes', 3);
    expect(preview.before).toEqual(['1', '3', '5']);
    expect(preview.after).toEqual(['#1', '4', '#5']);
  });

  it('音程名：12 个半音是纯八度，13 个是纯八度 + 小二度，24 个是两个八度', () => {
    expect(intervalName(1)).toBe('小二度');
    expect(intervalName(4)).toBe('大三度');
    expect(intervalName(-12)).toBe('纯八度');
    expect(intervalName(13)).toBe('纯八度 + 小二度');
    expect(intervalName(24)).toBe('2 个八度');
  });
});


describe('ScoreStore.transposeAll', () => {
  const mount = () => new ScoreStore(sampleScore());

  it('半音数为 0 时不写入历史', () => {
    const store = mount();
    expect(store.transposeAll(0)).toEqual({ notesChanged: 0, clamped: 0 });
    expect(store.canUndo).toBe(false);
  });

  it('默认改调号：以 reason="meta" 通知订阅者，撤销后调号与音符一起还原', () => {
    const store = mount();
    const reasons: string[] = [];
    store.subscribe((_score, reason) => reasons.push(reason));
    const before = pitchText(store.getScore().bars);

    store.transposeAll(3);

    expect(formatTonic(store.getScore().meta.tonic)).toBe('D#');
    expect(pitchText(store.getScore().bars)).toEqual(before);
    expect(reasons).toContain('meta');

    store.undo();
    expect(formatTonic(store.getScore().meta.tonic)).toBe('C');
  });

  it('notes 模式改写音符、调号不动，一次撤销全部还原', () => {
    const store = mount();
    const before = pitchText(store.getScore().bars);

    const stats = store.transposeAll(-3, 'notes');

    expect(formatTonic(store.getScore().meta.tonic)).toBe('C');
    expect(pitchText(store.getScore().bars)).not.toEqual(before);
    expect(stats.notesChanged).toBeGreaterThan(0);

    store.undo();
    expect(pitchText(store.getScore().bars)).toEqual(before);
  });

  it('两种模式听到的音高变化相同：改调号与改音符得到同一组绝对音高', () => {
    const byKey = new ScoreStore(sampleScore());
    byKey.transposeAll(7, 'key');
    const byNotes = new ScoreStore(sampleScore());
    byNotes.transposeAll(7, 'notes');

    const keyMidi = midiPitches(byKey.getScore().bars, byKey.getScore().meta.tonic);
    expect(midiPitches(byNotes.getScore().bars, byNotes.getScore().meta.tonic)).toEqual(keyMidi);
  });
});


describe('调名解析与调号数', () => {
  it('parseTonic 认前缀与后缀两种写法（下拉框选 F# 不会掉成 F）', () => {
    expect(parseTonic('F#')).toEqual({ letter: 'F', accidental: 'sharp' });
    expect(parseTonic('Bb')).toEqual({ letter: 'B', accidental: 'flat' });
    expect(parseTonic('bB')).toEqual({ letter: 'B', accidental: 'flat' });
    expect(parseTonic('#F')).toEqual({ letter: 'F', accidental: 'sharp' });
    // C 的音级类是 0：判「认不出」不能用取反，否则 C# 的升降号会被丢掉
    expect(parseTonic('C#')).toEqual({ letter: 'C', accidental: 'sharp' });
    expect(parseTonic('#C')).toEqual({ letter: 'C', accidental: 'sharp' });
    expect(parseTonic('G')).toEqual({ letter: 'G', accidental: 'natural' });
    expect(parseTonic('H')).toEqual({ letter: 'C', accidental: 'natural' });
    // 「乐曲信息」与「导入 MIDI」的调下拉取自 ALL_TONICS，每一项都要能原样往返
    for (const label of ALL_TONICS) expect(formatTonic(parseTonic(label))).toBe(label);
  });

  it('调号数符合五度圈，并写进 MIDI 导出的调号事件', () => {
    expect(keySignatureSharps(parseTonic('C'))).toBe(0);
    expect(keySignatureSharps(parseTonic('G'))).toBe(1);
    expect(keySignatureSharps(parseTonic('F#'))).toBe(6);
    expect(keySignatureSharps(parseTonic('F'))).toBe(-1);
    expect(keySignatureSharps(parseTonic('bB'))).toBe(-2);
    expect(keySignatureSharps(parseTonic('bG'))).toBe(-6);
    expect(tonicFromSharps(6)).toEqual({ letter: 'F', accidental: 'sharp' });
    expect(tonicFromSharps(-3)).toEqual({ letter: 'E', accidental: 'flat' });

    const score = sampleScore();
    score.meta.tonic = parseTonic('F#');
    expect(scoreToMidiFile(score).file.tracks[0].keySignatures[0]).toEqual({ tick: 0, sharps: 6, minor: false });
  });

  it('移调走出来的每个调都在下拉表里；表外调的调号数取记号最少的写法', () => {
    // 全曲移调能走到 1=D# 这类偏门调，「乐曲信息」的调下拉必须显示得出来
    for (const label of ALL_TONICS) {
      for (let n = -12; n <= 12; n++) {
        expect(ALL_TONICS).toContain(formatTonic(shiftTonic(parseTonic(label), n)));
      }
    }
    expect(keySignatureSharps(parseTonic('A#'))).toBe(-2);
    expect(keySignatureSharps(parseTonic('C#'))).toBe(-5);
    expect(keySignatureSharps(parseTonic('D#'))).toBe(-3);
    expect(keySignatureSharps(parseTonic('G#'))).toBe(-4);
  });
});

