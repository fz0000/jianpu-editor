import { describe, expect, it } from 'vitest';
import { importTonicBase } from '../src/midi/import';
import { ALL_TONICS, parseTonic, tonicMidiBase } from '../src/core/constants';

/**
 * 导入的八度基准。
 *
 * 守的不变量：**导入用的八度基准 == 播放 / 导出 / 移调用的八度基准**（`tonicMidiBase(tonic, 4)`，
 * 即 C4–B4 窗口）。`Tonic` 只有音名没有八度，导入时挑的基准不存进谱面，所以两边必须同一个基准，
 * 否则谱面自洽、发声却整首差一个八度（旧实现按「旋律音域居中」挑基准，音域约两个八度的歌会把基准
 * 定到调主下方五度，播放与导出全部 +12 半音）。
 */

describe('导入的八度基准与播放 / 导出一致', () => {
  it('importTonicBase 对每个常用调都等于 C4–B4 窗口基准', () => {
    for (const label of ALL_TONICS) {
      const tonic = parseTonic(label);
      expect(importTonicBase(tonic)).toBe(tonicMidiBase(tonic, 4));
    }
  });

  it('基准落在 C4–B4 窗口内（调主只有音名，发声窗口是约定死的）', () => {
    for (const label of ALL_TONICS) {
      const base = importTonicBase(parseTonic(label));
      expect(base).toBeGreaterThanOrEqual(60);
      expect(base).toBeLessThanOrEqual(71);
    }
  });
});
