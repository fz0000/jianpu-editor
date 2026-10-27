/**
 * 标准 MIDI 文件（SMF, Format 0/1）读写。
 * 自研实现：变长 delta-time、running status、meta 事件解析与生成。
 */

export interface MidiNote {
  midi: number;
  channel: number;
  /** 绝对 tick */
  start: number;
  /** tick 时长 */
  duration: number;
  velocity: number;
}

export interface TempoChange {
  tick: number;
  bpm: number;
}

export interface TimeSignatureChange {
  tick: number;
  num: number;
  den: number;
}

export interface KeySignatureChange {
  tick: number;
  sharps: number;
  minor: boolean;
}

/** 歌词事件（meta 0x05）：一个音节，落在它所属音符的起始 tick 上 */
export interface LyricEvent {
  tick: number;
  text: string;
}

export interface MidiTrack {
  name: string;
  notes: MidiNote[];
  tempoChanges: TempoChange[];
  timeSignatures: TimeSignatureChange[];
  keySignatures: KeySignatureChange[];
  lyrics: LyricEvent[];
  programs: number[];
}

export interface MidiFile {
  format: number;
  /** ticks per quarter note */
  division: number;
  tracks: MidiTrack[];
}

class ByteReader {
  private cursor = 0;
  constructor(private readonly data: Uint8Array) {}

  /** 当前读取偏移，供 parseTrack 划定轨道边界 */
  get pos(): number {
    return this.cursor;
  }

  get eof(): boolean {
    return this.cursor >= this.data.length;
  }
  u8(): number {
    if (this.cursor >= this.data.length) throw new Error('MIDI 数据意外结束');
    return this.data[this.cursor++];
  }
  u16(): number {
    const a = this.u8();
    const b = this.u8();
    return (a << 8) | b;
  }
  u32(): number {
    return (this.u16() << 16) | this.u16();
  }
  varLen(): number {
    let value = 0;
    for (;;) {
      const b = this.u8();
      value = (value << 7) | (b & 0x7f);
      if ((b & 0x80) === 0) break;
    }
    return value;
  }
  bytes(n: number): Uint8Array {
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i += 1) out[i] = this.u8();
    return out;
  }
  /** 回退一个字节（用于 running status 的数据字节） */
  back(): void {
    this.cursor = Math.max(0, this.cursor - 1);
  }
}

function ascii(data: Uint8Array): string {
  let s = '';
  for (let i = 0; i < data.length; i += 1) s += String.fromCharCode(data[i]);
  return s;
}

/** 中日韩汉字 / 假名 / 全角标点：中文文本解码成功的标志 */
function hasCjk(text: string): boolean {
  return /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af\uf900-\ufaff\uff00-\uffef]/.test(text);
}

function decodeGbk(data: Uint8Array): string | null {
  try {
    return new TextDecoder('gbk').decode(data).trim();
  } catch {
    return null; // 运行环境（无 full-icu 的 Node）没有 GBK 解码器
  }
}

/**
 * meta 文本（轨道名 / 歌词）解码。SMF 规范没规定文本编码：国内制谱软件写出的中文歌词
 * 常见是 UTF-8，也有 GBK / GB2312 的老文件。
 *
 * 坑：GBK 的双字节序列常常**同时**是合法 UTF-8（「站」的 GBK 是 D5 BE，按 UTF-8 解成 U+057E
 * 「Ӿ」），所以不能只靠「UTF-8 解码失败」来判编码。规则：UTF-8 解出汉字就认 UTF-8；
 * UTF-8 解不出汉字而 GBK 解得出汉字，认 GBK；两边都解不出汉字（纯 ASCII / 拉丁）用 UTF-8。
 * 任何情况下都不抛异常——最坏是乱码，不能让导入整个失败。
 */
function decodeMetaText(data: Uint8Array): string {
  if (data.length === 0) return '';
  let utf8Text: string | null = null;
  try {
    utf8Text = new TextDecoder('utf-8', { fatal: true }).decode(data).trim();
  } catch {
    utf8Text = null;
  }
  if (utf8Text === null) return decodeGbk(data) ?? ascii(data).trim();
  if (!hasCjk(utf8Text)) {
    const gbkText = decodeGbk(data);
    if (gbkText !== null && hasCjk(gbkText)) return gbkText;
  }
  return utf8Text;
}

function emptyTrack(): MidiTrack {
  return {
    name: '',
    notes: [],
    tempoChanges: [],
    timeSignatures: [],
    keySignatures: [],
    lyrics: [],
    programs: [],
  };
}

export function parseMidi(input: ArrayBuffer | Uint8Array): MidiFile {
  const data = input instanceof Uint8Array ? input : new Uint8Array(input);
  const r = new ByteReader(data);

  const header = ascii(r.bytes(4));
  if (header !== 'MThd') throw new Error('不是有效的 MIDI 文件（缺少 MThd 头）');
  const headerLen = r.u32();
  if (headerLen !== 6) throw new Error('MIDI 头长度异常');
  const format = r.u16();
  const nTracks = r.u16();
  const division = r.u16();
  if (division & 0x8000) {
    throw new Error('暂不支持 SMPTE 帧时间格式（division 为负数）的 MIDI 文件');
  }
  if (division === 0) throw new Error('MIDI division 为 0，文件损坏');
  if (nTracks === 0) throw new Error('MIDI 文件不含任何轨道');

  const tracks: MidiTrack[] = [];
  for (let t = 0; t < nTracks; t += 1) {
    const chunkType = ascii(r.bytes(4));
    const chunkLen = r.u32();
    if (chunkType !== 'MTrk') {
      r.bytes(chunkLen);
      continue;
    }
    tracks.push(parseTrack(r, r.pos + chunkLen, division));
  }

  return { format, division, tracks };
}

function closeNote(
  track: MidiTrack,
  openNotes: Map<number, { start: number; velocity: number }>,
  channel: number,
  midi: number,
  tick: number,
): void {
  const key = (channel << 8) | midi;
  const info = openNotes.get(key);
  if (!info) return;
  openNotes.delete(key);
  track.notes.push({
    midi,
    channel,
    start: info.start,
    duration: Math.max(1, tick - info.start),
    velocity: info.velocity,
  });
}

function parseTrack(r: ByteReader, end: number, division: number): MidiTrack {
  const track = emptyTrack();
  let tick = 0;
  let runningStatus = 0;
  /** key: (channel << 8) | midi */
  const openNotes = new Map<number, { start: number; velocity: number }>();

  while (r.pos < end) {
    tick += r.varLen();
    let status = r.u8();

    if (status < 0x80) {
      if (runningStatus === 0) throw new Error('MIDI running status 错误');
      status = runningStatus;
      r.back();
    } else if (status < 0xf0) {
      runningStatus = status;
    } else {
      runningStatus = 0;
    }

    const type = status & 0xf0;
    const channel = status & 0x0f;

    if (type === 0x80 || type === 0x90 || type === 0xa0 || type === 0xb0 || type === 0xe0) {
      const a = r.u8();
      const b = r.u8();
      if (type === 0x80 || (type === 0x90 && b === 0)) {
        closeNote(track, openNotes, channel, a, tick);
      } else if (type === 0x90) {
        const key = (channel << 8) | a;
        if (openNotes.has(key)) closeNote(track, openNotes, channel, a, tick);
        openNotes.set(key, { start: tick, velocity: b });
      }
      continue;
    }

    if (type === 0xc0 || type === 0xd0) {
      const a = r.u8();
      if (type === 0xc0) track.programs.push(a);
      continue;
    }

    if (status === 0xf0 || status === 0xf7) {
      const len = r.varLen();
      r.bytes(len);
      continue;
    }

    if (status === 0xff) {
      const metaType = r.u8();
      const len = r.varLen();
      const payload = r.bytes(len);
      if (metaType === 0x2f) break;
      if (metaType === 0x03) track.name = decodeMetaText(payload);
      else if (metaType === 0x05) {
        // 歌词：一个事件一个音节，同一音符上多个音节（连音线 / 增时线）由量化层拼接
        const text = decodeMetaText(payload);
        if (text) track.lyrics.push({ tick, text });
      } else if (metaType === 0x51) {
        const micros = (payload[0] << 16) | (payload[1] << 8) | payload[2];
        if (micros > 0) track.tempoChanges.push({ tick, bpm: 60000000 / micros });
      } else if (metaType === 0x58) {
        track.timeSignatures.push({ tick, num: payload[0], den: 2 ** payload[1] });
      } else if (metaType === 0x59) {
        const sharps = payload[0] > 127 ? payload[0] - 256 : payload[0];
        track.keySignatures.push({ tick, sharps, minor: payload[2] === 1 });
      }
      continue;
    }

    if (status === 0xf1 || status === 0xf9 || status === 0xfb || status === 0xfd) r.u8();
    else if (status === 0xf2) {
      r.u8();
      r.u8();
    }
  }

  // 收尾未闭合的音符（缺少 note-off 的异常文件）
  for (const [key, info] of openNotes) {
    track.notes.push({
      midi: key & 0xff,
      channel: key >> 8,
      start: info.start,
      duration: Math.max(1, division),
      velocity: info.velocity,
    });
  }
  openNotes.clear();
  track.notes.sort((a, b) => a.start - b.start || a.midi - b.midi);
  return track;
}

// ---------------------------------------------------------------------------
// 写出
// ---------------------------------------------------------------------------

interface RawEvent {
  tick: number;
  /** 同一 tick 内的顺序：meta(0) < noteOff(1) < noteOn(2) */
  order: number;
  bytes: number[];
}

function encodeVarLen(value: number): number[] {
  const bytes = [value & 0x7f];
  let rest = Math.floor(value / 128);
  while (rest > 0) {
    bytes.unshift((rest & 0x7f) | 0x80);
    rest = Math.floor(rest / 128);
  }
  return bytes;
}

export function metaBytes(type: number, payload: number[]): number[] {
  return [0xff, type, ...encodeVarLen(payload.length), ...payload];
}

export function tempoMetaBytes(bpm: number): number[] {
  const micros = Math.max(1, Math.round(60000000 / bpm));
  return metaBytes(0x51, [(micros >> 16) & 0xff, (micros >> 8) & 0xff, micros & 0xff]);
}

export function timeSignatureMetaBytes(num: number, den: number): number[] {
  const exp = Math.round(Math.log2(den));
  return metaBytes(0x58, [num, exp, 24, 8]);
}

export function keySignatureMetaBytes(sharps: number): number[] {
  const value = sharps < 0 ? sharps + 256 : sharps;
  return metaBytes(0x59, [value & 0xff, 0]);
}

export function trackNameMetaBytes(name: string): number[] {
  const encoded = Array.from(new TextEncoder().encode(name));
  return metaBytes(0x03, encoded);
}

export function lyricMetaBytes(text: string): number[] {
  const encoded = Array.from(new TextEncoder().encode(text));
  return metaBytes(0x05, encoded);
}

function buildTrackBytes(events: RawEvent[]): number[] {
  const sorted = [...events].sort((a, b) => a.tick - b.tick || a.order - b.order);
  const out: number[] = [];
  let prev = 0;
  for (const ev of sorted) {
    const delta = Math.max(0, ev.tick - prev);
    prev = ev.tick;
    out.push(...encodeVarLen(delta), ...ev.bytes);
  }
  out.push(...encodeVarLen(0), ...metaBytes(0x2f, []));
  return out;
}

function chunk(type: string, payload: number[]): number[] {
  const bytes: number[] = [];
  for (let i = 0; i < 4; i += 1) bytes.push(type.charCodeAt(i));
  const len = payload.length;
  bytes.push((len >> 24) & 0xff, (len >> 16) & 0xff, (len >> 8) & 0xff, len & 0xff);
  bytes.push(...payload);
  return bytes;
}

/** 由音符列表构建一条旋律轨 */
export function buildNoteTrack(
  notes: MidiNote[],
  name: string,
  program = 0,
  lyrics: LyricEvent[] = [],
): MidiTrack {
  return {
    name,
    notes: [...notes].sort((a, b) => a.start - b.start || a.midi - b.midi),
    tempoChanges: [],
    timeSignatures: [],
    keySignatures: [],
    lyrics: [...lyrics].sort((a, b) => a.tick - b.tick),
    programs: [program],
  };
}

export function writeMidi(file: MidiFile): Uint8Array {
  const division = Math.max(1, Math.min(0x7fff, Math.round(file.division)));
  const out: number[] = [];

  const header: number[] = [];
  for (const ch of 'MThd') header.push(ch.charCodeAt(0));
  header.push(0, 0, 0, 6);
  const format = file.format === 2 ? 1 : file.format;
  header.push((format >> 8) & 0xff, format & 0xff);
  header.push((file.tracks.length >> 8) & 0xff, file.tracks.length & 0xff);
  header.push((division >> 8) & 0xff, division & 0xff);
  out.push(...header);

  for (const track of file.tracks) {
    const events: RawEvent[] = [];
    if (track.name) events.push({ tick: 0, order: 0, bytes: trackNameMetaBytes(track.name) });
    for (const ts of track.timeSignatures) {
      events.push({ tick: ts.tick, order: 0, bytes: timeSignatureMetaBytes(ts.num, ts.den) });
    }
    for (const ks of track.keySignatures) {
      events.push({ tick: ks.tick, order: 0, bytes: keySignatureMetaBytes(ks.sharps) });
    }
    for (const t of track.tempoChanges) {
      events.push({ tick: t.tick, order: 0, bytes: tempoMetaBytes(t.bpm) });
    }
    for (const ly of track.lyrics) {
      if (ly.text) events.push({ tick: ly.tick, order: 0, bytes: lyricMetaBytes(ly.text) });
    }
    if (track.programs.length > 0) {
      events.push({ tick: 0, order: 0, bytes: [0xc0, track.programs[0] & 0x7f] });
    }

    for (const note of track.notes) {
      const midi = Math.max(0, Math.min(127, Math.round(note.midi)));
      const vel = Math.max(1, Math.min(127, Math.round(note.velocity)));
      const channel = note.channel & 0x0f;
      const start = Math.max(0, Math.round(note.start));
      const end = start + Math.max(1, Math.round(note.duration));
      events.push({ tick: end, order: 1, bytes: [0x80 | channel, midi, 64] });
      events.push({ tick: start, order: 2, bytes: [0x90 | channel, midi, vel] });
    }

    out.push(...chunk('MTrk', buildTrackBytes(events)));
  }

  return new Uint8Array(out);
}

