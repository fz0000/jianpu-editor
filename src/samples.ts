import { parseJianpuText } from './core/jianpu-text';
import { makeScore, type Bar, type Score } from './core/model';

function applyLyrics(bars: Bar[], lyrics: string[]): void {
  let i = 0;
  for (const bar of bars) {
    for (const ev of bar.events) {
      if (ev.kind !== 'note') continue;
      if (i < lyrics.length) {
        ev.lyric = lyrics[i];
        i += 1;
      }
    }
  }
}

export function twinkleScore(): Score {
  const { bars } = parseJianpuText('1 1 | 5 5 | 6 6 | 5 - | 4 4 | 3 3 | 2 2 | 1 -');
  applyLyrics(bars, ['一', '闪', '一', '闪', '亮', '晶', '晶', '满', '天', '都', '是', '小', '星', '星']);
  return makeScore(
    {
      title: '小星星',
      subtitle: 'C 调',
      composer: '法国民谣',
      lyricist: '佚名',
      tonic: { letter: 'C', accidental: 'natural' },
      timeSig: { num: 2, den: 4 },
      tempo: 108,
      showLyrics: true,
      showBarNumbers: true,
    },
    bars,
  );
}

export function odeToJoyScore(): Score {
  const { bars } = parseJianpuText(
    '3 3 4 5 | 5 4 3 2 | 1 1 2 3 | 3. 2/ 2 - | 3 3 4 5 | 5 4 3 2 | 1 1 2 3 | 2. 1/ 1 -',
  );
  applyLyrics(bars, [
    '欢', '乐', '女', '神', '圣', '洁', '美', '丽', '灿', '烂', '光', '芒', '照', '大', '地',
    '我', '们', '心', '中', '充', '满', '热', '情', '来', '到', '你', '的', '圣', '殿', '里',
  ]);
  return makeScore(
    {
      title: '欢乐颂',
      subtitle: 'C 调',
      composer: '贝多芬',
      lyricist: '席勒',
      tonic: { letter: 'C', accidental: 'natural' },
      timeSig: { num: 4, den: 4 },
      tempo: 116,
      showLyrics: true,
      showBarNumbers: true,
    },
    bars,
  );
}

export function emptyScore(): Score {
  return makeScore({ title: '未命名简谱', tempo: 100 }, parseJianpuText('1 - | 0').bars);
}

export const SAMPLES: { label: string; build: () => Score }[] = [
  { label: '小星星', build: twinkleScore },
  { label: '欢乐颂', build: odeToJoyScore },
];
