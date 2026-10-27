import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { barBeatLength, isNote } from '../src/core/model';
import type { Score } from '../src/core/model';
import { exportScoreToMidi } from '../src/midi/export';
import { analyzeMidi, buildScoreFromMidi } from '../src/midi/import';
import { twinkleScore } from '../src/samples';

function degrees(score: Score): number[] {
  return score.bars.flatMap((bar) => bar.events.filter(isNote).map((n) => n.degree));
}

function beatsPerBar(score: Score): number[] {
  return score.bars.map((bar) => barBeatLength(bar));
}

describe('简谱 -> MIDI -> 简谱 往返', () => {
  const score = twinkleScore();
  const exported = exportScoreToMidi(score);
  const buffer = exported.bytes.buffer as ArrayBuffer;

  it('导出 SMF 并统计音符数', () => {
    expect(exported.noteCount).toBe(14);
    expect(exported.file.format).toBe(1);
    expect(exported.file.division).toBe(96);
    expect(exported.file.tracks.length).toBe(2);
    expect(exported.file.tracks[1].notes.length).toBe(14);
  });

  it('延长线并入前一个音符的时长', () => {
    const durations = exported.file.tracks[1].notes.map((n) => n.duration / exported.file.division);
    expect(durations).toContain(2);
    const totalBeats = durations.reduce((acc, d) => acc + d, 0);
    expect(totalBeats).toBeCloseTo(16);
  });

  it('analyzeMidi 读出速度、拍号与调号', () => {
    const analysis = analyzeMidi(buffer);
    expect(analysis.format).toBe(1);
    expect(analysis.division).toBe(96);
    expect(analysis.tempo).toBeCloseTo(score.meta.tempo);
    expect(analysis.timeSig).toEqual({ num: 2, den: 4 });
    expect(analysis.keySignaturePresent).toBe(true);
    expect(analysis.suggestedTonic).toBe('C');
    expect(analysis.suggestedTrack).toBe(1);
    expect(analysis.tracks[0].hasNotes).toBe(false);
    expect(analysis.tracks[1].noteCount).toBe(14);
    expect(analysis.tracks[1].minMidi).toBe(60);
    expect(analysis.tracks[1].maxMidi).toBe(69);
  });

  it('重新导入得到相同的小节数与音级序列', () => {
    const rebuilt = buildScoreFromMidi(buffer, {
      trackIndexes: [1],
      grid: 0.5,
      minRestBeats: 0.25,
      tonic: 'C',
      timeSig: { num: 2, den: 4 },
      tempo: score.meta.tempo,
      title: '小星星',
    });

    expect(rebuilt.bars.length).toBe(score.bars.length);
    expect(degrees(rebuilt)).toEqual(degrees(score));
    expect(beatsPerBar(rebuilt)).toEqual(beatsPerBar(score));
    expect(rebuilt.meta.title).toBe('小星星');
    expect(rebuilt.meta.tempo).toBe(score.meta.tempo);
  });

  it('选择伴奏轨道会得到不同的音级序列', () => {
    const bass = buildScoreFromMidi(buffer, {
      trackIndexes: [0],
      grid: 0.5,
      minRestBeats: 0.25,
      tonic: 'C',
      timeSig: { num: 2, den: 4 },
      tempo: 100,
      title: '空轨道',
    });
    expect(degrees(bass).length).toBe(0);
  });
});

describe('示例 MIDI 文件（scripts/make-sample-midi.mjs 生成）', () => {
  const bytes = readFileSync(new URL('../samples/twinkle.mid', import.meta.url));
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const analysis = analyzeMidi(buffer);

  it('包含 3 个轨道、480 ticks/四分、100 BPM、4/4', () => {
    expect(analysis.format).toBe(1);
    expect(analysis.division).toBe(480);
    expect(analysis.tempo).toBeCloseTo(100);
    expect(analysis.timeSig).toEqual({ num: 4, den: 4 });
    expect(analysis.tracks.length).toBe(3);
    expect(analysis.tracks[1].noteCount).toBe(42);
    expect(analysis.tracks[2].noteCount).toBe(8);
  });

  it('主旋律轨道被选为建议轨道，调号为 C', () => {
    expect(analysis.suggestedTrack).toBe(1);
    expect(analysis.suggestedTonic).toBe('C');
    expect(analysis.tracks[1].name).toBe('Twinkle Twinkle Little Star');
  });

  it('导入后小节数为 12（4/4 拍）', () => {
    const score = buildScoreFromMidi(buffer, {
      trackIndexes: [analysis.suggestedTrack],
      grid: 0.5,
      minRestBeats: 0.25,
      tonic: 'C',
      timeSig: analysis.timeSig,
      tempo: analysis.tempo,
      title: '小星星（示例 MIDI）',
    });
    expect(score.bars.length).toBe(12);
    expect(degrees(score).length).toBe(42);
    expect(degrees(score).slice(0, 7)).toEqual([1, 1, 5, 5, 6, 6, 5]);
  });
});
