import { ALL_TONICS } from '../core/constants';
import { layoutScore } from '../core/layout';
import { makeScore, type Score } from '../core/model';

import { renderScore } from '../core/render';
import {
  analyzeMidi,
  buildScoreFromMidi,
  countLyricNotes,
  type ImportOptions,
} from '../midi/import';
import {
  dialogButton,
  fieldRow,
  makeCheckbox,
  makeNumberInput,
  makeSelect,
  makeTextInput,
  openDialog,
} from './dialog';
import { toast } from './toast';

const GRID_OPTIONS = [
  { value: '0.5', label: '八分音符 (1/8)' },
  { value: '0.25', label: '十六分音符 (1/16)' },
  { value: '0.125', label: '三十二分音符 (1/32)' },
];

const MIN_REST_OPTIONS = [
  { value: '0', label: '保留所有间隙' },
  { value: '0.25', label: '合并 < 1/16 拍' },
  { value: '0.5', label: '合并 < 1/8 拍' },
  { value: '1', label: '合并 < 1/4 拍' },
];

/** 预览盒的左右内边距（styles.css 的 .dialog-preview: padding 10px × 2） */
const PREVIEW_PAD_X = 20;
/** 没有布局可量时（happy-dom 里 clientWidth 恒为 0）退回的排版宽度 */
const PREVIEW_FALLBACK_WIDTH = 720;

export function openImportDialog(
  layer: HTMLElement,
  data: ArrayBuffer,
  fileTitle: string,
  onDone: (score: Score) => void,
): void {
  let analysis;
  try {
    analysis = analyzeMidi(data);
  } catch (error) {
    toast(error instanceof Error ? error.message : 'MIDI 解析失败', 'error', 6000);
    return;
  }

  const dialog = openDialog(layer, '导入 MIDI');
  const selected = new Set<number>([analysis.suggestedTrack]);

  const summary = document.createElement('p');
  summary.className = 'dialog-summary';
  const totalLyrics = analysis.tracks.reduce((acc, t) => acc + t.lyricCount, 0);
  summary.textContent =
    `格式 ${analysis.format} · 分辨率 ${analysis.division} tick/四分音符 · ` +
    `速度 ${analysis.tempo} BPM · ${analysis.tracks.length} 条轨道` +
    (analysis.keySignaturePresent ? ' · 含调号' : '') +
    (totalLyrics > 0 ? ` · 含歌词 ${totalLyrics} 个音节` : '');
  dialog.body.appendChild(summary);

  const trackBox = document.createElement('div');
  trackBox.className = 'track-list';
  const trackHead = document.createElement('div');
  trackHead.className = 'track-list-head';
  trackHead.textContent = '选择要导入的旋律轨道（多选时按时间合并）';
  trackBox.appendChild(trackHead);

  for (const track of analysis.tracks) {
    const row = document.createElement('label');
    row.className = 'track-row';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = selected.has(track.index);
    input.disabled = !track.hasNotes;
    input.addEventListener('change', () => {
      if (input.checked) selected.add(track.index);
      else selected.delete(track.index);
      refreshPreview();
    });
    const name = document.createElement('span');
    name.className = 'track-name';
    name.textContent = `${track.index + 1}. ${track.name}`;
    const meta = document.createElement('span');
    meta.className = 'track-meta';
    const lyricNote = track.lyricCount > 0 ? ` · 歌词 ${track.lyricCount} 音节` : '';
    meta.textContent = track.hasNotes
      ? `${track.noteCount} 音 · ${track.minMidi}-${track.maxMidi} · ${track.beats} 拍${lyricNote}`
      : `无音符（速度/控制轨）${lyricNote}`;
    row.append(input, name, meta);
    trackBox.appendChild(row);
  }
  dialog.body.appendChild(trackBox);

  const gridSelect = makeSelect(GRID_OPTIONS, '0.25');
  const minRestSelect = makeSelect(MIN_REST_OPTIONS, '0.25');
  const tonicSelect = makeSelect(
    ALL_TONICS.map((value) => ({ value, label: value })),
    analysis.suggestedTonic,
  );
  const numInput = makeNumberInput(analysis.timeSig.num, 1, 24);
  const denSelect = makeSelect(
    [1, 2, 4, 8, 16].map((v) => ({ value: String(v), label: String(v) })),
    String(analysis.timeSig.den),
  );
  const tempoInput = makeNumberInput(analysis.tempo, 20, 300);
  const titleInput = makeTextInput(fileTitle, '乐曲标题');
  // 歌词勾选：文件里有 meta 0x05 才允许勾选；勾选后导入的谱面自动打开「显示歌词」
  const lyricsCheck = makeCheckbox(
    totalLyrics > 0 ? `导入歌词（${totalLyrics} 个音节）` : '导入歌词（此文件无歌词）',
    totalLyrics > 0,
  );
  lyricsCheck.input.disabled = totalLyrics === 0;

  const options = document.createElement('div');
  options.className = 'dialog-options';
  options.append(
    fieldRow('量化网格', gridSelect),
    fieldRow('间隙处理', minRestSelect),
    fieldRow('调 (1=)', tonicSelect),
    fieldRow('拍号', row2(numInput, denSelect)),
    fieldRow('速度 BPM', tempoInput),
    fieldRow('标题', titleInput),
    lyricsCheck.wrap,
  );
  // 这块必须挂进对话框：只建元素不 append 的话，控制项一个都不出现（预览照旧刷新，
  // 因为监听挂在控件上），界面上就是轨道列表和预览之间一大片空白
  dialog.body.appendChild(options);

  const previewLabel = document.createElement('div');
  previewLabel.className = 'dialog-preview-label';
  previewLabel.textContent = '预览（前 8 小节）';
  const previewBox = document.createElement('div');
  previewBox.className = 'dialog-preview';
  const previewSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  previewSvg.setAttribute('class', 'jp-score jp-score-preview');
  previewBox.appendChild(previewSvg);

  function currentOptions(): ImportOptions {
    return {
      trackIndexes: [...selected],
      grid: Number(gridSelect.value),
      minRestBeats: Number(minRestSelect.value),
      tonic: tonicSelect.value,
      timeSig: {
        num: Math.max(1, Math.min(24, Math.round(Number(numInput.value) || 4))),
        den: Number(denSelect.value) || 4,
      },
      tempo: Math.max(20, Math.min(300, Math.round(Number(tempoInput.value) || 100))),
      title: titleInput.value,
      attachLyrics: lyricsCheck.input.checked,
    };
  }

  /** 预览排版宽度 = 预览盒的内容宽度。写死 720 会在 680px 的对话框里永远出横向滚动条 */
  function previewWidth(): number {
    const inner = previewBox.clientWidth - PREVIEW_PAD_X;
    return inner >= 320 ? inner : PREVIEW_FALLBACK_WIDTH;
  }

  function refreshPreview(): void {
    try {
      const score = buildScoreFromMidi(data, currentOptions());
      const previewBars = score.bars.slice(0, 8);
      const preview = makeScore(score.meta, previewBars);
      const layout = layoutScore(preview, previewWidth());
      renderScore(previewSvg, layout);
      // 预览盒比整段预览矮，重排后停在底部看到的是曲子中段（旧版一打开就从第 5 小节看起）
      previewBox.scrollTop = 0;
      const lyricNotes = countLyricNotes(score.bars);
      previewNote.textContent =
        `共 ${score.bars.length} 小节 · ${countNotes(score)} 个音符` +
        (lyricNotes > 0 ? ` · 歌词 ${lyricNotes} 个音节` : '');
    } catch (error) {
      previewNote.textContent = error instanceof Error ? error.message : '预览失败';
    }
  }

  const previewNote = document.createElement('div');
  previewNote.className = 'dialog-preview-note';

  for (
    const control of [
      gridSelect, minRestSelect, tonicSelect, numInput, denSelect, tempoInput, titleInput, lyricsCheck.input,
    ]
  ) {
    control.addEventListener('change', refreshPreview);
  }

  dialog.body.append(previewLabel, previewBox, previewNote);

  const cancel = dialogButton('取消', 'btn-ghost', dialog.close);
  const confirm = dialogButton('导入到乐谱', 'btn-primary', () => {
    try {
      const score = buildScoreFromMidi(data, currentOptions());
      if (selected.size === 0) {
        toast('请至少选择一条轨道', 'warn');
        return;
      }
      onDone(score);
      dialog.close();
      const lyricNotes = countLyricNotes(score.bars);
      toast(
        `已导入 ${score.bars.length} 小节` +
        (lyricNotes > 0 ? `，歌词 ${lyricNotes} 个音节（已开启「显示歌词」）` : ''),
      );
    } catch (error) {
      toast(error instanceof Error ? error.message : '导入失败', 'error', 6000);
    }
  });
  dialog.footer.append(cancel, confirm);

  refreshPreview();
}

function countNotes(score: Score): number {
  let total = 0;
  for (const bar of score.bars) {
    for (const ev of bar.events) if (ev.kind === 'note') total += 1;
  }
  return total;
}

function row2(a: HTMLElement, b: HTMLElement): HTMLElement {
  const div = document.createElement('div');
  div.className = 'field-row-inline';
  div.append(a, b);
  return div;
}


