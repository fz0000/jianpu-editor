/**
 * 键盘输入分发（文档第六章「键盘优先」）。
 * main.ts 只负责提供具体动作，键位表集中在这里，helpDialog 也复用同一份表。
 */

import type { Accidental, Degree, Duration } from '../core/model';

export interface EditKeyHandlers {
  note(degree: Degree): void;
  rest(): void;
  dash(): void;
  duration(d: Duration): void;
  dot(): void;
  accidental(a: Accidental): void;
  octaveUp(): void;
  octaveDown(): void;
  /** 全曲移调 1 个半音（正 = 升高） */
  transposeUp(): void;
  transposeDown(): void;
  /** 打开「全曲移调」对话框：任意半音数，可选改调号 / 改音符（可选实现） */
  transposeDialog?(): void;
  triplet(): void;
  tie(): void;
  slur(): void;
  /** 全曲记号精简：同音连音线链合并成更长时值 + 连续休止符合并 */
  compactNotation(): void;
  /** 谱面字号放大 / 缩小（整张谱面等比缩放，可选实现） */
  fontSizeUp?(): void;
  fontSizeDown?(): void;
  cursorMove(delta: number): void;
  barMove(delta: number): void;
  appendNote(): void;
  remove(): void;
  toggleInsertMode(): void;
  togglePlay(): void;
  stop(): void;
  undo(): void;
  redo(): void;
  importMidi(): void;
  saveJson(): void;
  /** 可选：在当前光标处打开微型编辑浮层（E 键） */
  edit?(): void;
}

const DURATION_KEYS: Record<string, Duration> = {
  q: 1,
  w: 2,
  r: 4,
  t: 8,
  y: 16,
  u: 32,
};

const ACCIDENTAL_KEYS: Record<string, Accidental> = {
  s: 'sharp',
  f: 'flat',
  n: 'natural',
};

/** 返回 true 表示该按键已被消费（应 preventDefault） */
function handlePlain(event: KeyboardEvent, h: EditKeyHandlers): boolean {
  const key = event.key;

  if (key >= '1' && key <= '7') {
    h.note(Number(key) as Degree);
    return true;
  }

  const lower = key.length === 1 ? key.toLowerCase() : key;

  if (DURATION_KEYS[lower] !== undefined) {
    h.duration(DURATION_KEYS[lower]);
    return true;
  }
  if (ACCIDENTAL_KEYS[lower] !== undefined) {
    h.accidental(ACCIDENTAL_KEYS[lower]);
    return true;
  }

  switch (key) {
    case '0':
      h.rest();
      return true;
    case ' ':
      h.togglePlay();
      return true;
    case '-':
      h.dash();
      return true;
    case 'd':
      h.dot();
      return true;
    case ']':
      h.octaveUp();
      return true;
    case '[':
      h.octaveDown();
      return true;
    case 'l':
      h.triplet();
      return true;
    case 'v':
      h.tie();
      return true;
    case 'b':
      h.slur();
      return true;
    case 'e':
      if (h.edit) {
        h.edit();
        return true;
      }
      return false;
    case 'ArrowLeft':
      h.cursorMove(-1);
      return true;
    case 'ArrowRight':
      h.cursorMove(1);
      return true;
    case 'ArrowUp':
      h.barMove(-1);
      return true;
    case 'ArrowDown':
      h.barMove(1);
      return true;
    case 'Enter':
      h.appendNote();
      return true;
    case 'Delete':
    case 'Backspace':
      h.remove();
      return true;
    case 'Insert':
      h.toggleInsertMode();
      return true;
    case 'Escape':
      h.stop();
      return true;
    default:
      return false;
  }
}

/**
 * 处理一次 keydown。
 * @returns 是否已消费该事件
 */
export function dispatchEditKey(event: KeyboardEvent, h: EditKeyHandlers): boolean {
  if (event.ctrlKey || event.metaKey || event.altKey) {
    const key = event.key.toLowerCase();

    if (event.altKey && !event.ctrlKey && !event.metaKey) {
      if (key === 't') {
        h.compactNotation();
        event.preventDefault();
        return true;
      }
      return false;
    }

    if (event.ctrlKey && event.shiftKey) {
      if (event.key === ']') {
        h.transposeUp();
        event.preventDefault();
        return true;
      }
      if (event.key === '[') {
        h.transposeDown();
        event.preventDefault();
        return true;
      }
      // 全曲移调对话框：M = 移调；浏览器只占用 Ctrl+Shift+T/J/K，M 在主流浏览器里空闲
      if (key === 'm') {
        h.transposeDialog?.();
        event.preventDefault();
        return true;
      }
      // 谱面字号：浏览器缩放占用了 Ctrl + / -（不带 Shift），这里用带 Shift 的组合避开冲突；
      // 英文键盘上 Ctrl+Shift+= 的 key 是 '+'，故两个写法都收下
      if (event.key === '=' || event.key === '+') {
        h.fontSizeUp?.();
        event.preventDefault();
        return true;
      }
      if (event.key === '-' || event.key === '_') {
        h.fontSizeDown?.();
        event.preventDefault();
        return true;
      }
      return false;
    }

    if (key === 'z') {
      if (event.shiftKey) h.redo();
      else h.undo();
    } else if (key === 'y') {
      h.redo();
    } else if (key === 'o') {
      h.importMidi();
    } else if (key === 's') {
      h.saveJson();
    } else {
      return false;
    }
    event.preventDefault();
    return true;
  }

  const consumed = handlePlain(event, h);
  if (consumed) event.preventDefault();
  return consumed;
}

export interface ShortcutDoc {
  keys: string;
  desc: string;
}

export const SHORTCUTS: ShortcutDoc[] = [
  { keys: '1 … 7', desc: '输入音级 do–si（有选中记号时覆盖，空槽时插入）' },
  { keys: '0', desc: '输入休止符' },
  { keys: '-', desc: '输入延长记号' },
  { keys: 'Q W R T Y U', desc: '时值：全 / 二分 / 四分 / 八分 / 十六分 / 三十二分' },
  { keys: 'D', desc: '切换附点' },
  { keys: 'S / F / N', desc: '升号 / 降号 / 还原' },
  { keys: '] / [', desc: '高八度点 / 低八度点（当前音符）' },
  { keys: 'Ctrl+Shift+] / Ctrl+Shift+[', desc: '全曲升高 / 降低 1 个半音（只平移调号，谱面数字不变）' },
  {
    keys: 'Ctrl+Shift+M',
    desc: '打开「全曲移调」对话框：以半音为单位升降任意度，默认改调号（1=C → 1=D，数字不变），可勾选改写音符（调号不变，谱面出现 # b）',
  },
  {
    keys: 'Ctrl+Shift+= / Ctrl+Shift+-',
    desc: '放大 / 缩小谱面字号：整张谱面（数字、下划线、八度点、歌词、小节线）等比缩放，每行小节数随之重排',
  },
  { keys: 'L', desc: '切换三连音标记' },
  { keys: 'V / B', desc: '连音线 tie / 圆滑线 slur（连续标记三个以上音符，它们共用一条圆滑线）' },
  {
    keys: 'Alt + T',
    desc: '精简记号：小节内同音连音线链合并成更长时值（四分 / 二分 / 全音符 + 增时线），小节内连续休止符合并成更少的休止符；跨小节长音保留',
  },
  { keys: '← →', desc: '移动光标' },
  { keys: '↑ ↓', desc: '在小节之间上下移动光标' },
  { keys: 'Enter', desc: '在当前小节末尾追加一个四分音符' },
  { keys: 'Delete / Backspace', desc: '删除当前记号' },
  { keys: 'Insert', desc: '切换「插入 / 覆盖」输入模式' },
  { keys: 'Ctrl + Z / Ctrl + Shift + Z / Ctrl + Y', desc: '撤销 / 重做' },
  { keys: 'Space', desc: '播放 / 暂停（从当前高亮的记号起播；暂停后再按从断点继续；移动过高亮则从新高亮的记号起播）' },
  { keys: 'Esc', desc: '停止播放并回到开头（高亮回到第一个记号）/ 关闭编辑浮层' },
  { keys: 'E', desc: '在当前记号上打开微型编辑浮层' },
  { keys: 'Ctrl + O', desc: '导入 MIDI' },
  { keys: 'Ctrl + S', desc: '保存 JSON' },
  { keys: '单击记号', desc: '选中并弹出微型编辑浮层' },
  { keys: '拖拽记号', desc: '调整记号顺序（可跨小节）' },
  { keys: '点击小节空白', desc: '把光标移到该小节末尾的空槽' },
];