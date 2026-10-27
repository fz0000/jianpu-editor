/**
 * 「全曲移调」对话框：以半音为单位，整谱升降任意度。
 *
 * 两种写法（音高变化相同，谱面不同），由「改变音符」勾选切换：
 * - 默认「改调号」：1=C → 1=D，谱面数字一个都不动（标准简谱移调）；
 * - 勾选后「改音符」：调号不动，逐音符改写音级 / 升降号 / 八度点。
 */

import { formatTonic, shiftTonic } from '../core/constants';
import { isNote, type Bar, type Score } from '../core/model';
import { intervalName, previewNotes, transposeStatsFor, effectiveKeyShift, type TransposeMode } from '../core/transpose';
import { dialogButton, fieldRow, makeCheckbox, makeSelect, openDialog } from './dialog';
import { toast } from './toast';

/** 可选幅度上限：两个八度 */
const MAX_SEMITONES = 24;

/** 下拉项：从「升高 24 个半音」排到「降低 24 个半音」，中间夹一个 0 */
function semitoneOptions(): { value: string; label: string }[] {
  const options: { value: string; label: string }[] = [];
  for (let n = MAX_SEMITONES; n >= 1; n -= 1) {
    options.push({ value: String(n), label: `升高 ${n} 个半音（${intervalName(n)}）` });
  }
  options.push({ value: '0', label: '不动（0 个半音）' });
  for (let n = 1; n <= MAX_SEMITONES; n += 1) {
    options.push({ value: String(-n), label: `降低 ${n} 个半音（${intervalName(n)}）` });
  }
  return options;
}

function countNotes(bars: Bar[]): number {
  let total = 0;
  for (const bar of bars) {
    for (const ev of bar.events) if (isNote(ev)) total += 1;
  }
  return total;
}

export function openTransposeDialog(
  layer: HTMLElement,
  score: Score,
  onApply: (semitones: number, mode: TransposeMode) => void,
): void {
  const meta = score.meta;
  const bars = score.bars;
  const fromKey = formatTonic(meta.tonic);

  const dialog = openDialog(layer, '全曲移调');

  const summary = document.createElement('p');
  summary.className = 'dialog-summary';
  summary.textContent =
    `当前 1=${fromKey} · ${meta.timeSig.num}/${meta.timeSig.den} · ${bars.length} 小节 · ${countNotes(bars)} 个音符`;
  dialog.body.appendChild(summary);

  const semitoneSelect = makeSelect(semitoneOptions(), '1');
  dialog.body.appendChild(fieldRow('移调幅度', semitoneSelect));

  const notesCheck = makeCheckbox('改变音符（调号不变，谱面数字加 # b 与八度点）', false);
  dialog.body.appendChild(notesCheck.wrap);

  const previewNote = document.createElement('div');
  previewNote.className = 'dialog-preview-note';
  dialog.body.appendChild(previewNote);

  const semitonesOf = (): number => Number(semitoneSelect.value) || 0;
  const modeOf = (): TransposeMode => (notesCheck.input.checked ? 'notes' : 'key');

  function previewText(): string {
    const n = semitonesOf();
    const mode = modeOf();
    const abs = Math.abs(n);
    const dir = n > 0 ? '升高' : n < 0 ? '降低' : '不改变';
    const toKey = formatTonic(shiftTonic(meta.tonic, n));
    const preview = previewNotes(bars, meta.tonic, n, mode);
    const lines: string[] = [`音高：${dir} ${abs} 个半音（${intervalName(abs)}）`];
    if (mode === 'key') {
      lines.push(`调号：1=${fromKey} → 1=${toKey}；谱面数字一个都不动`);
      if (preview.before.length > 0) lines.push(`谱面保持：${preview.before.join(' ')} …`);
      const shift = effectiveKeyShift(meta.tonic, shiftTonic(meta.tonic, n));
      if (shift === 0) {
        lines.push('播放与 MIDI 导出的音高不变（请求的幅度是整八度，简谱的八度位置由调号决定）');
      } else {
        const effDir = shift > 0 ? '升高' : '降低';
        lines.push(`播放与 MIDI 导出按新调发声：整体${effDir} ${Math.abs(shift)} 个半音（${intervalName(shift)}）`);
        if (shift !== n) {
          lines.push(`注：与请求的 ${abs} 个半音相差整八度（八度位置由调号所在八度决定），音级关系不变`);
        }
      }
    } else {
      lines.push(`调号：保持 1=${fromKey}；数字改写为新的音级、升降号与八度点`);
      if (preview.before.length > 0) {
        lines.push(`前 ${preview.before.length} 个音符：${preview.before.join(' ')} → ${preview.after.join(' ')}`);
      }
      lines.push(`听感上等于把同样的旋律记到 1=${toKey}`);
    }
    const stats = transposeStatsFor(bars, meta.tonic, n);
    if (stats.clamped > 0) {
      lines.push(`⚠ ${stats.clamped} 个音符的八度点会越出 ±2，将被压回（音高相差一个八度）`);
    }
    return lines.join('\n');
  }

  const refresh = (): void => {
    previewNote.textContent = previewText();
  };
  semitoneSelect.addEventListener('change', refresh);
  notesCheck.input.addEventListener('change', refresh);
  refresh();

  dialog.footer.append(
    dialogButton('取消', 'btn-ghost', dialog.close),
    dialogButton('移调', 'btn-primary', () => {
      const n = semitonesOf();
      if (n === 0) {
        toast('移调幅度是 0 个半音，先选一个幅度', 'warn');
        return;
      }
      onApply(n, modeOf());
      dialog.close();
    }),
  );
}
