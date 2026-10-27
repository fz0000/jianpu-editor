import { describe, expect, it } from 'vitest';
import { parseJianpuText, scoreToJianpuText } from '../src/core/jianpu-text';
import { isDash, isNote, isRest, makeBar, makeNote, makeScore } from '../src/core/model';

describe('parseJianpuText', () => {
  it('按小节线切分', () => {
    const { bars, errors } = parseJianpuText('1 2 3 4 | 5 5 6 | 5. 0 3');
    expect(errors).toEqual([]);
    expect(bars.length).toBe(3);
    expect(bars[0].events.length).toBe(4);
    expect(bars[2].right).toBe('final');
  });

  it('解析八度、升降号、附点与时值', () => {
    const { bars, errors } = parseJianpuText("5' 3, #4 b7 1/ 2// 3/// 0. -");
    expect(errors).toEqual([]);
    const events = bars[0].events;

    const high = events[0];
    const low = events[1];
    if (isNote(high) && isNote(low)) {
      expect(high.degree).toBe(5);
      expect(high.octave).toBe(1);
      expect(low.degree).toBe(3);
      expect(low.octave).toBe(-1);
    }

    const sharp = events[2];
    const flat = events[3];
    if (isNote(sharp) && isNote(flat)) {
      expect(sharp.accidental).toBe('sharp');
      expect(flat.accidental).toBe('flat');
    }

    expect(events[4].kind === 'note' && events[4].duration).toBe(8);
    expect(events[5].kind === 'note' && events[5].duration).toBe(16);
    expect(events[6].kind === 'note' && events[6].duration).toBe(32);
    expect(isRest(events[7])).toBe(true);
    expect(events[7].kind === 'rest' && events[7].dotted).toBe(true);
    expect(isDash(events[8])).toBe(true);
  });

  it('支持反复线', () => {
    const { bars } = parseJianpuText('|: 1 2 :| 3 4');
    expect(bars.length).toBe(2);
    expect(bars[0].left).toBe('repeat-start');
    expect(bars[0].right).toBe('repeat-end');
    expect(bars[1].events.length).toBe(2);
  });
  it('换行等价于空格', () => {
    const a = parseJianpuText('1 2\n3 4 | 5 5');
    const b = parseJianpuText('1 2 3 4 | 5 5');
    expect(a.bars.length).toBe(b.bars.length);
    expect(a.bars.map((bar) => bar.events.length)).toEqual(b.bars.map((bar) => bar.events.length));
  });

  it('无法识别的记号进入 errors', () => {
    const { bars, errors } = parseJianpuText('1 8 x 2');
    expect(errors.length).toBe(2);
    expect(bars[0].events.length).toBe(2);
  });

  it('空文本至少返回一个小节', () => {
    const { bars } = parseJianpuText('');
    expect(bars.length).toBe(1);
    expect(bars[0].events.length).toBe(0);
  });
});

describe('scoreToJianpuText', () => {
  it('与解析结果往返一致', () => {
    const source = "1 2 3 4 | 5' 5' 6 6 | 5. 0 3 4 | 2// 2// 1 -";
    const { bars } = parseJianpuText(source);
    expect(scoreToJianpuText(makeScore({}, bars))).toBe(source);
  });

  it('保留反复记号', () => {
    const { bars } = parseJianpuText('|: 1 2 :|');
    expect(scoreToJianpuText(makeScore({}, bars))).toBe('|: 1 2 :|');
  });

  it('反复段与普通小节混合时往返一致', () => {
    const source = '|: 1 2 3 4 :| 5 5 6 6';
    const { bars, errors } = parseJianpuText(source);
    expect(errors).toEqual([]);
    expect(bars.length).toBe(2);
    expect(bars[0].left).toBe('repeat-start');
    expect(bars[0].right).toBe('repeat-end');
    expect(scoreToJianpuText(makeScore({}, bars))).toBe(source);
  });
});

describe('长时值音符写作「数字 + 横线」', () => {
  const text = (events: Parameters<typeof makeBar>[0]): string =>
    scoreToJianpuText(makeScore({}, [makeBar(events)]));

  it('二分音符导出一根横线，全音符导出三根', () => {
    expect(text([makeNote(5, 2)])).toBe('5 -');
    expect(text([makeNote(3, 1)])).toBe('3 - - -');
  });

  it('附点二分音符导出三拍写法（数字 + 两根横线）', () => {
    expect(text([makeNote(2, 2, { dotted: true })])).toBe('2 - -');
  });

  it('附点四分音符保留附点写法（不足两拍不补横线）', () => {
    expect(text([makeNote(5, 4, { dotted: true })])).toBe('5.');
    expect(text([makeNote(5, 8)])).toBe('5/');
  });

  it('导出后重新解析：总拍数不变', () => {
    const source = text([makeNote(5, 2), makeNote(3, 1), makeNote(2, 2, { dotted: true })]);
    const { bars, errors } = parseJianpuText(source);
    expect(errors).toEqual([]);
    // 5 - = 2 拍，3 - - - = 4 拍，2 - - = 3 拍
    expect(bars[0].events.map((e) => e.kind)).toEqual([
      'note',
      'dash',
      'note',
      'dash',
      'dash',
      'dash',
      'note',
      'dash',
      'dash',
    ]);
  });
});

