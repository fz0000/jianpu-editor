/**
 * 生成示例 MIDI 文件（samples/twinkle.mid），用于手工验证导入流程。
 * 运行： npm run make:sample-midi
 *
 * 该脚本不依赖项目源码（纯 Node），自行按 SMF Format 1 编码：
 *   track 0  : 速度 / 拍号 / 调号 / 曲名
 *   track 1  : 主旋律（钢琴）
 *   track 2  : 伴奏根音（低音）
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIVISION = 480; // ticks per quarter note
const TEMPO_BPM = 100;

const here = dirname(fileURLToPath(import.meta.url));
const outFile = join(here, '..', 'samples', 'twinkle.mid');

/** 可变长度数值（MIDI VLQ） */
function vlq(value) {
  const bytes = [value & 0x7f];
  let rest = value >> 7;
  while (rest > 0) {
    bytes.unshift((rest & 0x7f) | 0x80);
    rest >>= 7;
  }
  return bytes;
}

function ascii(text) {
  return Array.from(text, (c) => c.charCodeAt(0));
}

function chunk(id, data) {
  const len = data.length;
  return [
    ...ascii(id),
    (len >>> 24) & 0xff,
    (len >>> 16) & 0xff,
    (len >>> 8) & 0xff,
    len & 0xff,
    ...data,
  ];
}

function meta(delta, type, payload) {
  return [...vlq(delta), 0xff, type, ...vlq(payload.length), ...payload];
}

/** C 大调《小星星》，四分音符 = 1 拍 */
const MELODY = [
  [60, 1], [60, 1], [67, 1], [67, 1], [69, 1], [69, 1], [67, 2],
  [65, 1], [65, 1], [64, 1], [64, 1], [62, 1], [62, 1], [60, 2],
  [67, 1], [67, 1], [65, 1], [65, 1], [64, 1], [64, 1], [62, 2],
  [67, 1], [67, 1], [65, 1], [65, 1], [64, 1], [64, 1], [62, 2],
  [60, 1], [60, 1], [67, 1], [67, 1], [69, 1], [69, 1], [67, 2],
  [65, 1], [65, 1], [64, 1], [64, 1], [62, 1], [62, 1], [60, 2],
];

/** 每小节强拍上的伴奏根音（C / F / G 进行） */
const BASS = [
  [48, 2], [48, 2], [41, 2], [43, 2], [48, 2], [41, 2], [43, 2], [48, 2],
];

function noteTrack(notes, program, name) {
  const bytes = [...meta(0, 0x03, ascii(name)), ...vlq(0), 0xc0 | 0x00, program & 0x7f];
  for (const [pitch, quarters] of notes) {
    const ticks = Math.round(quarters * DIVISION);
    bytes.push(...vlq(0), 0x90, pitch & 0x7f, 96);
    bytes.push(...vlq(ticks), 0x80, pitch & 0x7f, 64);
  }
  bytes.push(...meta(0, 0x2f, []));
  return bytes;
}

const header = chunk('MThd', [
  0x00, 0x01, // format 1
  0x00, 0x03, // 3 tracks
  (DIVISION >>> 8) & 0xff, DIVISION & 0xff,
]);

const tempoMicros = Math.round(60_000_000 / TEMPO_BPM);
const metaTrack = chunk('MTrk', [
  ...meta(0, 0x58, [4, 2, 8, 8]), // 4/4
  ...meta(0, 0x51, [(tempoMicros >> 16) & 0xff, (tempoMicros >> 8) & 0xff, tempoMicros & 0xff]),
  ...meta(0, 0x59, [0]), // C 大调
  ...meta(0, 0x03, ascii('Twinkle Twinkle Little Star')),
  ...meta(0, 0x2f, []),
]);

const melodyTrack = chunk('MTrk', noteTrack(MELODY, 0, 'Twinkle Twinkle Little Star'));
const bassTrack = chunk('MTrk', noteTrack(BASS, 32, 'Bass'));

const bytes = new Uint8Array([...header, ...metaTrack, ...melodyTrack, ...bassTrack]);

mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, bytes);

const totalBeats = MELODY.reduce((acc, [, q]) => acc + q, 0);
console.log(`已写入 ${outFile}`);
console.log(`  格式 1 · ${DIVISION} ticks/四分 · ${TEMPO_BPM} BPM · 4/4`);
console.log(`  主旋律 ${MELODY.length} 个音符（${totalBeats} 拍）· 伴奏 ${BASS.length} 个音符`);
console.log(`  文件大小 ${bytes.length} 字节`);
