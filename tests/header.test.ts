import { describe, expect, it } from 'vitest';
import { layoutHeader, layoutScore, type HeaderRole, type HeaderText } from '../src/core/layout';
import {
  HEADER_BASELINE_RATIO,
  HEADER_BLOCK_GAP,
  HEADER_BOTTOM_PAD,
  HEADER_LINE_GAP,
  HEADER_META_FONT_SIZE,
  HEADER_TOP_PAD,
  LEFT_MARGIN,
  RIGHT_MARGIN,
  SUBTITLE_FONT_SIZE,
  SYSTEM_GAP,
  textWidth,
  TITLE_FONT_SIZE,
  TITLE_LINE_GAP,
  TITLE_TRACKING,
} from '../src/core/metrics';
import { makeBar, makeNote, makeScore, type Meta, type Score } from '../src/core/model';

/** 页眉排版用的页宽（够宽，左右两栏彼此不会相撞） */
const PAGE = 900;

function song(meta: Partial<Meta>): Score {
  return makeScore({ timeSig: { num: 2, den: 4 }, ...meta }, [
    makeBar([makeNote(1, 4), makeNote(2, 4)]),
    makeBar([makeNote(3, 2), makeNote(5, 2)]),
  ]);
}

function itemsOf(meta: Partial<Meta>, pageWidth = PAGE): HeaderText[] {
  return layoutHeader(song(meta), pageWidth).items;
}

/** 取该角色的唯一一项；数量不为 1 直接抛错，让断言失败信息更直白 */
function only(items: HeaderText[], role: HeaderRole): HeaderText {
  const found = items.filter((it) => it.role === role);
  if (found.length !== 1) throw new Error(`期望恰好一个 ${role}，实到 ${found.length} 个`);
  return found[0];
}

describe('textWidth：页眉排版用的文本估宽', () => {
  it('汉字按一字宽，拉丁按半宽，字距逐字符累加', () => {
    expect(textWidth('茉莉', 34)).toBe(68);
    expect(textWidth('ab', 16)).toBeCloseTo(16 * 0.55 * 2, 6);
    expect(textWidth('茉莉', 34, 8)).toBe(68 + 8 * 2);
    expect(textWidth('', 34)).toBe(0);
  });
});

describe('layoutHeader：歌曲信息版式（歌本式）', () => {
  it('标题居中并带字距（末尾也占一份字距，居中时补回半个）', () => {
    const items = itemsOf({ title: '茉莉花' });
    const title = only(items, 'title');
    expect(title.text).toBe('茉莉花');
    expect(title.anchor).toBe('middle');
    expect(title.x).toBe(PAGE / 2 + TITLE_TRACKING / 2);
    expect(title.fontSize).toBe(TITLE_FONT_SIZE);
  });

  it('副标题与「演唱 ×××」居中排在标题下方，依次向下', () => {
    const items = itemsOf({ title: '茉莉花', subtitle: '江苏民歌', singer: '邓丽君' });
    const title = only(items, 'title');
    const subtitle = only(items, 'subtitle');
    const singer = only(items, 'singer');
    expect(singer.text).toBe('演唱  邓丽君');
    expect(singer.fontSize).toBe(SUBTITLE_FONT_SIZE);
    for (const item of [subtitle, singer]) expect(item.anchor).toBe('middle');
    expect(subtitle.x).toBe(PAGE / 2);
    expect(subtitle.y).toBeGreaterThan(title.y);
    expect(singer.y).toBeGreaterThan(subtitle.y);
  });

  it('左栏「1=C 2/4」「♩=速度」左对齐到左边距，右栏词曲作者右对齐到右边距', () => {
    const items = itemsOf({ title: '茉莉花', composer: '张三', lyricist: '李四' });
    const key = only(items, 'key');
    const tempo = only(items, 'tempo');
    expect(key.text).toBe('1=C 2/4');
    expect(tempo.text).toBe('♩=100'); // 100 = defaultMeta() 的默认速度
    for (const item of [key, tempo]) {
      expect(item.anchor).toBe('start');
      expect(item.x).toBe(LEFT_MARGIN);
    }
    expect(tempo.y).toBeGreaterThan(key.y);

    const credits = items.filter((it) => it.role === 'credit');
    expect(credits.map((c) => c.text)).toEqual(['李四 作词', '张三 作曲']);
    for (const credit of credits) {
      expect(credit.anchor).toBe('end');
      expect(credit.x).toBe(PAGE - RIGHT_MARGIN);
    }
    // 词曲作者与调号速度同属页眉下方的信息带（不再压在标题基线上）
    expect(credits[0].y).toBeCloseTo(key.y, 6);
  });

  it('标题独占一行：没有任何项与标题同基线，行距给足', () => {
    const items = itemsOf({ title: '茉莉花', singer: '邓丽君', composer: '张三', lyricist: '李四' });
    const title = only(items, 'title');
    // 标题行左右两侧不放字（旧版式把「×× 作词」压在标题基线，整行读起来挤）
    for (const item of items) {
      if (item.role === 'title') continue;
      expect(item.y).toBeGreaterThan(title.y);
    }
    // 标题到下一行（演唱）之间空出整行标题 + 行距：标题的下沿与演唱的上沿不贴在一起
    const singer = only(items, 'singer');
    const titleBottom = title.y + TITLE_FONT_SIZE * (1 - HEADER_BASELINE_RATIO);
    const singerTop = singer.y - SUBTITLE_FONT_SIZE * HEADER_BASELINE_RATIO;
    expect(singerTop - titleBottom).toBeCloseTo(TITLE_LINE_GAP, 6);
  });

  it('演唱在第二行；调号 / 速度 / 词曲作者下移到居中栏之下的信息带', () => {
    const items = itemsOf({ title: '茉莉花', singer: '邓丽君', composer: '张三', lyricist: '李四' });
    const singer = only(items, 'singer');
    const key = only(items, 'key');
    const tempo = only(items, 'tempo');
    const credits = items.filter((it) => it.role === 'credit');
    // 第二行只有演唱（居中）
    expect(singer.anchor).toBe('middle');
    expect(singer.x).toBe(PAGE / 2);
    // 信息带整体在演唱之下，并留出 HEADER_BLOCK_GAP
    expect(key.y - singer.y).toBeGreaterThanOrEqual(SUBTITLE_FONT_SIZE + HEADER_BLOCK_GAP);
    // 左右两栏同一水平带起排：右栏首行与左栏首行同基线，第二行依次向下
    expect(credits[0].y).toBeCloseTo(key.y, 6);
    expect(credits[1].y).toBeCloseTo(tempo.y, 6);
  });

  it('空字段不占行：没填的项不出现在页眉里', () => {
    const items = itemsOf({ title: '茉莉花', singer: '   ', composer: '', lyricist: '' });
    expect(items.map((it) => it.role)).toEqual(['title', 'key', 'tempo']);
  });

  it('窄页：侧栏永远在居中栏之下，绝不与标题 / 演唱重叠', () => {
    const narrow = 320;
    const items = itemsOf({ title: '茉莉花', singer: '邓丽君', composer: '张三', lyricist: '李四' }, narrow);
    const singer = only(items, 'singer');
    const key = only(items, 'key');
    const tempo = only(items, 'tempo');
    const credits = items.filter((it) => it.role === 'credit');
    // 居中栏最后一行（演唱）之下才是信息带
    expect(key.y).toBeGreaterThan(singer.y);
    expect(tempo.y).toBeGreaterThan(key.y);
    for (const credit of credits) expect(credit.y).toBeGreaterThan(singer.y);
  });

  it('极窄页：右栏压到左栏时整栏下移到左栏之下，不重叠', () => {
    const items = itemsOf({ title: '茉莉花', composer: '张三', lyricist: '李四' }, 190);
    const tempo = only(items, 'tempo');
    const credits = items.filter((it) => it.role === 'credit');
    // 右栏首行落到左栏末行（速度）之下
    for (const credit of credits) expect(credit.y).toBeGreaterThan(tempo.y);
  });

  it('页眉带高度 = 顶部留白 + 各行 + 到谱表的间距；空信息时只剩调号拍号与速度', () => {
    const bare = layoutHeader(song({}), PAGE);
    expect(bare.items.map((it) => it.role)).toEqual(['key', 'tempo']);
    expect(bare.height).toBe(
      HEADER_TOP_PAD + HEADER_META_FONT_SIZE * 2 + HEADER_LINE_GAP + HEADER_BOTTOM_PAD,
    );

    const full = layoutHeader(
      song({ title: '茉莉花', subtitle: '江苏民歌', singer: '邓丽君', composer: '张三', lyricist: '李四' }),
      PAGE,
    );
    expect(full.height).toBeGreaterThan(bare.height);
    for (const item of full.items) expect(item.y).toBeLessThan(full.height);
  });
});

describe('layoutScore：页眉带计入谱面总高', () => {
  const systemsHeight = (l: ReturnType<typeof layoutScore>): number =>
    l.systems.reduce((acc, s) => acc + s.height, 0) + Math.max(0, l.systems.length - 1) * SYSTEM_GAP;

  it('总高 = 页眉带 + 各谱表 + 行距 + 底部留白', () => {
    const layout = layoutScore(song({ title: '茉莉花', singer: '邓丽君' }), 900);
    expect(layout.height).toBe(layout.header.height + systemsHeight(layout) + 12);
  });

  it('填不填歌曲信息都不改变分行，高度差正好是页眉高度差', () => {
    const withHeader = layoutScore(song({ title: '茉莉花', singer: '邓丽君' }), 900);
    const bare = layoutScore(song({}), 900);
    expect(withHeader.systems.length).toBe(bare.systems.length);
    expect(withHeader.height - bare.height).toBe(withHeader.header.height - bare.header.height);
  });
});
