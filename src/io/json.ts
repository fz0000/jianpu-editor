import { defaultMeta, makeBar, makeDash, makeNote, makeRest, type Bar, type Duration, type Score, type ScoreEvent } from '../core/model';
import { parseTonic, formatTonic } from '../core/constants';
import { DEFAULT_FONT_SIZE, snapFontSize } from '../core/metrics';
import type { Tonic } from '../core/model';

const DURATIONS: Duration[] = [1, 2, 4, 8, 16, 32];

export function serializeScore(score: Score): string {
  return JSON.stringify(
    { ...score, meta: { ...score.meta, tonic: formatTonic(score.meta.tonic) } },
    null,
    2,
  );
}

function asNumber(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}
function asString(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}

function asBarline(v: unknown): Bar['left'] {
  const s = asString(v, 'normal');
  return s === 'none' || s === 'repeat-start' || s === 'repeat-end' || s === 'final' ? s : 'normal';
}

/** 兼容两种写法：`"tonic": "C"` 或 `"tonic": { "letter": "C", "accidental": "natural" }` */
function asTonic(v: unknown): Tonic {
  if (typeof v === 'string') return parseTonic(v || 'C');
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    const letter = asString(o.letter, 'C').toUpperCase();
    const accidental = o.accidental === 'sharp' ? 'sharp' : o.accidental === 'flat' ? 'flat' : 'natural';
    if (parseTonic(letter).letter === letter) return parseTonic(`${accidental === 'sharp' ? '#' : accidental === 'flat' ? 'b' : ''}${letter}`);
  }
  return { letter: 'C', accidental: 'natural' };
}

function normalizeEvent(raw: unknown): ScoreEvent | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const kind = r.kind;
  if (kind === 'dash') {
    const dash = makeDash();
    if (typeof r.id === 'string' && r.id) dash.id = r.id;
    return dash;
  }
  if (kind === 'rest') {
    const duration = DURATIONS.includes(r.duration as Duration) ? (r.duration as Duration) : 4;
    const rest = makeRest(duration, Boolean(r.dotted));
    if (typeof r.id === 'string' && r.id) rest.id = r.id;
    return rest;
  }

  if (kind === 'note') {
    const degree = Math.max(1, Math.min(7, asNumber(r.degree, 1))) as 1 | 2 | 3 | 4 | 5 | 6 | 7;
    const duration = DURATIONS.includes(r.duration as Duration) ? (r.duration as Duration) : 4;
    const note = makeNote(degree, duration, {
      octave: Math.max(-2, Math.min(2, asNumber(r.octave, 0))),
      accidental: r.accidental === 'sharp' ? 'sharp' : r.accidental === 'flat' ? 'flat' : 'natural',
      dotted: Boolean(r.dotted),
      tie: Boolean(r.tie),
      slur: Boolean(r.slur),
      triplet: Boolean(r.triplet),
      lyric: asString(r.lyric),
      velocity: Math.max(1, Math.min(127, asNumber(r.velocity, 96))),
    });
    if (typeof r.id === 'string' && r.id) note.id = r.id;
    return note;
  }
  return null;
}

export function deserializeScore(text: string): Score {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('JSON 解析失败，文件可能已损坏');
  }
  if (!raw || typeof raw !== 'object') throw new Error('JSON 内容不是乐谱对象');

  const obj = raw as Record<string, unknown>;
  const metaRaw = (obj.meta ?? {}) as Record<string, unknown>;
  const barsRaw = Array.isArray(obj.bars) ? obj.bars : [];

  const bars: Bar[] = barsRaw.map((barRaw) => {
    const b = (barRaw ?? {}) as Record<string, unknown>;
    const events = Array.isArray(b.events)
      ? (b.events.map(normalizeEvent).filter(Boolean) as ScoreEvent[])
      : [];
    const bar = makeBar(events, asBarline(b.left), asBarline(b.right));

    if (typeof b.id === 'string' && b.id) bar.id = b.id;
    return bar;
  });

  const tsRaw = (metaRaw.timeSig ?? {}) as Record<string, unknown>;
  const meta = {
    ...defaultMeta(),
    fontSize: snapFontSize(asNumber(metaRaw.fontSize, DEFAULT_FONT_SIZE)),
    title: asString(metaRaw.title),
    subtitle: asString(metaRaw.subtitle),
    singer: asString(metaRaw.singer),
    composer: asString(metaRaw.composer),
    lyricist: asString(metaRaw.lyricist),
    tonic: asTonic(metaRaw.tonic),
    timeSig: {
      num: Math.max(1, Math.min(24, asNumber(tsRaw.num, 4))),
      den: [1, 2, 4, 8, 16].includes(tsRaw.den as number) ? (tsRaw.den as number) : 4,
    },
    tempo: Math.max(20, Math.min(300, asNumber(metaRaw.tempo, 100))),
    showLyrics: metaRaw.showLyrics !== false,
    showBarNumbers: metaRaw.showBarNumbers !== false,
    barsPerLine: Math.max(0, Math.min(32, Math.round(asNumber(metaRaw.barsPerLine, 0)))),
  };

  if (bars.length === 0) bars.push(makeBar([]));
  return { version: 1, meta, bars };
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function downloadText(text: string, filename: string, mime = 'application/json;charset=utf-8'): void {
  downloadBlob(new Blob([text], { type: mime }), filename);
}

export function downloadBytes(bytes: Uint8Array, filename: string, mime: string): void {
  downloadBlob(new Blob([bytes as BlobPart], { type: mime }), filename);
}

const STORAGE_KEY = 'jianpu-editor:autosave:v1';

export function saveToLocal(score: Score): void {
  try {
    localStorage.setItem(STORAGE_KEY, serializeScore(score));
  } catch {
    /* 隐私模式或配额不足时忽略 */
  }
}

export function loadFromLocal(): Score | null {
  try {
    const text = localStorage.getItem(STORAGE_KEY);
    return text ? deserializeScore(text) : null;
  } catch {
    return null;
  }
}

export function safeFilename(base: string, ext: string): string {
  const cleaned = (base || 'score').replace(/[\\/:*?"<>|]+/g, '_').trim() || 'score';
  return `${cleaned}.${ext}`;
}
