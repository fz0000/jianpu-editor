/**
 * 简谱文本串 <-> 乐谱模型。
 *
 * 约定（可在「快捷键」面板查看）：
 *   1-7  音级          0   休止符        -   延长记号
 *   '    高八度(可叠加) ,   低八度(可叠加)
 *   #    升号          b    降号
 *   .    附点
 *   /    时值缩短一级（/ 八分, // 十六分, /// 三十二分）
 *   |    小节线        |:  反复开始      :|  反复结束
 * 例：1 2 3 4 | 5 5 6 6 | 5./ 0 3 4 |
 */

import {
  isNote,
  makeBar,
  makeDash,
  makeNote,
  makeRest,
  noteBeats,

  type Bar,
  type Duration,
  type Score,
  type ScoreEvent,
} from './model';

export interface ParseResult {
  bars: Bar[];
  errors: string[];
}

const TOKEN_RE = /^([#b]?)([0-7])('*|,{1,2})?(\.)?(\/{0,3})$/;

/** 词法扫描：反复线优先于单条小节线，避免「|:」被拆成「|」+「:」 */
const TOKEN_SCAN_RE =
  /\|:|:\||[|\-]|[#b]?[0-7](?:'+|,{1,2})?(?:\.)?(?:\/{0,3})|[^\s]+/g;

function durationFromSlashes(slashes: number): Duration {
  switch (slashes) {
    case 1:
      return 8;
    case 2:
      return 16;
    case 3:
      return 32;
    default:
      return 4;
  }
}

function slashesFromDuration(d: Duration): string {
  switch (d) {
    case 8:
      return '/';
    case 16:
      return '//';
    case 32:
      return '///';
    default:
      return '';
  }
}

function eventFromToken(token: string, position: number, errors: string[]): ScoreEvent | null {
  if (/^0{2,}$/.test(token)) {
    const count = token.length;
    if (count === 4) return makeRest(1);
    if (count === 2) return makeRest(2);
    errors.push(`第 ${position} 个记号「${token}」无法识别`);
    return null;
  }

  const match = TOKEN_RE.exec(token);
  if (!match) {
    errors.push(`第 ${position} 个记号「${token}」无法识别`);
    return null;
  }
  const [, acc, digit, octaveMarks, dot, slashes] = match;
  const degree = Number(digit);
  const duration = durationFromSlashes(slashes ? slashes.length : 0);
  const dotted = Boolean(dot);

  if (degree === 0) return makeRest(duration, dotted);

  const octave = octaveMarks
    ? octaveMarks.startsWith("'")
      ? octaveMarks.length
      : -octaveMarks.length
    : 0;
  const accidental = acc === '#' ? 'sharp' : acc === 'b' ? 'flat' : 'natural';
  return makeNote(degree as 1 | 2 | 3 | 4 | 5 | 6 | 7, duration, { octave, accidental, dotted });
}

export function parseJianpuText(text: string): ParseResult {
  const errors: string[] = [];
  const normalized = text.replace(/\r?\n/g, ' ');

  const bars: Bar[] = [];
  let current = makeBar([]);

  const flush = (right: 'normal' | 'repeat-end' | 'final' = 'normal') => {
    if (current.events.length > 0) {
      current.right = right;
      bars.push(current);
    }
    current = makeBar([]);
  };

  const tokens = normalized.match(TOKEN_SCAN_RE) ?? [];
  tokens.forEach((token, position) => {
    if (token === '|') {
      flush('normal');
      return;
    }
    if (token === '|:') {
      flush('normal');
      current.left = 'repeat-start';
      return;
    }
    if (token === ':|') {
      flush('repeat-end');
      return;
    }
    if (token === '-') {
      const prev = current.events.length > 0 ? current.events[current.events.length - 1] : null;
      if (prev && isNote(prev) && prev.dotted) {
        const tied = makeNote(prev.degree, prev.duration, {
          octave: prev.octave,
          accidental: prev.accidental,
          tie: true,
        });
        current.events.push(tied);
      } else {
        current.events.push(makeDash());
      }
      return;
    }
    const event = eventFromToken(token, position + 1, errors);
    if (event) current.events.push(event);
  });

  flush('final');

  if (bars.length === 0) bars.push(makeBar([]));
  return { bars, errors };
}

function tokenFromEvent(e: ScoreEvent): string {
  if (e.kind === 'dash') return '-';
  if (e.kind === 'rest') {
    if (e.duration === 1 && !e.dotted) return '0000';
    if (e.duration === 2 && !e.dotted) return '00';
    const slashes = slashesFromDuration(e.duration);
    const dot = e.dotted ? '.' : '';
    return `0${dot}${slashes}`;
  }
  // 时值满两拍及以上写作「数字 + 横线」：横线数 = 拍数 - 1
  const beats = noteBeats(e);
  const dashCount = Number.isInteger(beats) && beats >= 2 ? Math.round(beats) - 1 : 0;
  const slashes = dashCount > 0 ? '' : slashesFromDuration(e.duration);
  const dot = dashCount > 0 ? '' : e.dotted ? '.' : '';
  const acc = e.accidental === 'sharp' ? '#' : e.accidental === 'flat' ? 'b' : '';
  const octave = e.octave > 0 ? "'".repeat(e.octave) : e.octave < 0 ? ','.repeat(-e.octave) : '';
  return `${acc}${e.degree}${octave}${dot}${slashes}${' -'.repeat(dashCount)}`;
}

export function scoreToJianpuText(score: Score): string {
  let out = '';
  score.bars.forEach((bar, index) => {
    const body = bar.events.map(tokenFromEvent).join(' ');
    const left = bar.left === 'repeat-start' ? '|: ' : '';
    const right = bar.right === 'repeat-end' ? ' :|' : '';
    const piece = `${left}${body}${right}`.trim();
    if (index === 0) {
      out = piece;
      return;
    }
    // 反复结束线本身就是小节线，不再额外补一条
    out += score.bars[index - 1].right === 'repeat-end' ? ' ' : ' | ';
    out += piece;
  });
  return out;
}
