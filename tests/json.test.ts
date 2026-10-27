import { describe, expect, it } from 'vitest';
import { scoreToJianpuText } from '../src/core/jianpu-text';
import { cloneScore, makeScore } from '../src/core/model';
import { deserializeScore, safeFilename, serializeScore } from '../src/io/json';
import { odeToJoyScore, twinkleScore } from '../src/samples';

describe('JSON 序列化', () => {
  it('往返保持小节、事件与元信息', () => {
    const score = odeToJoyScore();
    const text = serializeScore(score);
    const restored = deserializeScore(text);

    expect(restored.bars.length).toBe(score.bars.length);
    expect(scoreToJianpuText(restored)).toBe(scoreToJianpuText(score));
    expect(restored.meta.title).toBe(score.meta.title);
    expect(restored.meta.singer).toBe(score.meta.singer);
    expect(restored.meta.composer).toBe(score.meta.composer);
    expect(restored.meta.tempo).toBe(score.meta.tempo);
    expect(restored.meta.timeSig).toEqual(score.meta.timeSig);
    expect(restored.meta.tonic).toEqual(score.meta.tonic);
    expect(restored.meta.showLyrics).toBe(score.meta.showLyrics);
  });

  it('保留歌词、连音线与升降号', () => {
    const score = twinkleScore();
    const restored = deserializeScore(serializeScore(score));
    const firstNote = restored.bars[0].events[0];
    const firstNoteOriginal = score.bars[0].events[0];
    if (firstNote.kind === 'note' && firstNoteOriginal.kind === 'note') {
      expect(firstNote.lyric).toBe(firstNoteOriginal.lyric);
      expect(firstNote.accidental).toBe(firstNoteOriginal.accidental);
      expect(firstNote.tie).toBe(firstNoteOriginal.tie);
    }
  });

  it('序列化结果是可解析的 JSON', () => {
    const text = serializeScore(twinkleScore());
    expect(() => JSON.parse(text)).not.toThrow();
    const raw = JSON.parse(text) as { version?: string; bars?: unknown[] };
    expect(Array.isArray(raw.bars)).toBe(true);
  });

  it('拒绝非法 JSON', () => {
    expect(() => deserializeScore('not a score')).toThrow();
  });

  it('cloneScore 与原谱内容一致且互不影响', () => {
    const score = twinkleScore();
    const copy = cloneScore(score);
    expect(scoreToJianpuText(copy)).toBe(scoreToJianpuText(score));
    copy.bars[0].events[0] = { kind: 'rest', id: 'x', duration: 4, dotted: false };
    expect(scoreToJianpuText(copy)).not.toBe(scoreToJianpuText(score));
  });

  it('makeScore 提供默认元信息', () => {
    const score = makeScore();
    expect(score.meta.tempo).toBeGreaterThan(0);
    expect(score.meta.timeSig.den).toBeGreaterThan(0);
    expect(score.bars.length).toBe(0);
  });
});

describe('safeFilename', () => {
  it('清理非法字符并追加扩展名', () => {
    expect(safeFilename('小星星', 'json')).toBe('小星星.json');
    expect(safeFilename('a/b:c*d?', 'mid')).toBe('a_b_c_d_.mid');
  });

  it('空标题退回默认名', () => {
    expect(safeFilename('   ', 'json')).toBe('score.json');
  });

  it('非 C 调的调号在往返后保持不变', () => {
    const score = twinkleScore();
    score.meta.tonic = { letter: 'E', accidental: 'flat' };
    const restored = deserializeScore(serializeScore(score));
    expect(restored.meta.tonic).toEqual({ letter: 'E', accidental: 'flat' });
  });

  it('兼容 tonic 写成对象的旧文件', () => {
    const legacy = JSON.stringify({
      version: 1,
      meta: { tonic: { letter: 'B', accidental: 'flat' }, tempo: 90 },
      bars: [{ events: [{ kind: 'note', degree: 1, duration: 4 }] }],
    });
    const restored = deserializeScore(legacy);
    expect(restored.meta.tonic).toEqual({ letter: 'B', accidental: 'flat' });
    expect(restored.meta.tempo).toBe(90);
  });
});

describe('元信息字段往返', () => {
  it('演唱（singer）随工程文件保存 / 读回', () => {
    const score = odeToJoyScore();
    score.meta.singer = '邓丽君';
    expect(deserializeScore(serializeScore(score)).meta.singer).toBe('邓丽君');
  });

  it('旧工程文件没有 singer 字段时退回空串（页眉不显示演唱行）', () => {
    const legacy = JSON.stringify({
      version: 1,
      meta: { title: '旧文件' },
      bars: [{ events: [{ kind: 'note', degree: 1, duration: 4 }] }],
    });
    expect(deserializeScore(legacy).meta.singer).toBe('');
  });
});
