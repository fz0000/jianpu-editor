// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { SHORTCUTS } from '../src/ui/shortcuts';
import { Transport, type TransportCallbacks } from '../src/ui/transport';

/**
 * 播放控制条的按钮语义。
 *
 * 守的约定：**播放 / 暂停 / 继续是同一个按钮**（三态切换），「停止」独立表示
 * 「淡出并回到开头」——两个按钮的点击不重复（旧版播放按钮第二次点击 = 停止，
 * 与「⏹ 停止」按钮完全等价，而「⏸ 暂停」按钮没人接 `resume()`，暂停后按播放
 * 是从光标处重头播，等于第三个「停止」）。
 *
 * 起播点与「回到开头」的落点在别处守：`tests/cursor.test.ts`（`ScoreStore.playStartEventId` /
 * `goToStart`）、`tests/cursor-dom.test.ts`（高亮真的回到全曲第一个记号）、
 * `tests/player-audio-dom.test.ts` 的「播放起点」（从光标处起播只排它之后的音）。
 */

function makeTransport(): { root: HTMLElement; calls: string[]; transport: Transport } {
  const root = document.createElement('div');
  const calls: string[] = [];
  const cb: TransportCallbacks = {
    onPlayPause: () => calls.push('playPause'),
    onStop: () => calls.push('stop'),
    onTempo: (v) => calls.push(`tempo:${v}`),
    onRate: (v) => calls.push(`rate:${v}`),
    onLoop: (v) => calls.push(`loop:${v}`),
    onInstrument: (v) => calls.push(`instrument:${v}`),
  };
  const transport = new Transport(root, cb);
  return { root, calls, transport };
}

function labels(root: HTMLElement): string[] {
  return Array.from(root.querySelectorAll('button')).map((b) => b.textContent ?? '');
}

function buttonByLabel(root: HTMLElement, label: string): HTMLButtonElement {
  const found = Array.from(root.querySelectorAll('button')).find((b) => b.textContent === label);
  if (!found) throw new Error(`找不到按钮：${label}`);
  return found as HTMLButtonElement;
}

function positionText(root: HTMLElement): string {
  return root.querySelector('.transport-position')?.textContent ?? '';
}

describe('控制条只有两个播放按钮：播放/暂停切换 + 停止', () => {
  it('独立的「⏸ 暂停」按钮已删除，播放按钮兼任三态', () => {
    const { root } = makeTransport();
    expect(labels(root)).toEqual(['▶ 播放', '⏹ 停止']);
  });

  it('两个按钮各走各的回调：播放按钮三态共用一个回调，停止按钮走 onStop', () => {
    const { root, calls } = makeTransport();
    buttonByLabel(root, '▶ 播放').click();
    buttonByLabel(root, '⏹ 停止').click();
    expect(calls).toEqual(['playPause', 'stop']);
  });
});

describe('播放按钮的三态：文案、按下态、提示都跟着状态走', () => {
  it('播放中显示「⏸ 暂停」并亮着；暂停显示「▶ 继续」并弹起；停止显示「▶ 播放」', () => {
    const { root, transport } = makeTransport();
    const play = buttonByLabel(root, '▶ 播放');

    transport.setState('playing');
    expect(play.textContent).toBe('⏸ 暂停');
    expect(play.classList.contains('is-active')).toBe(true);
    expect(play.title).toContain('Space');

    // 暂停必须弹起：按钮顶着「播放中」的按下态而声音已经停了 = 界面在骗人
    transport.setState('paused');
    expect(play.textContent).toBe('▶ 继续');
    expect(play.classList.contains('is-active')).toBe(false);

    transport.setState('stopped');
    expect(play.textContent).toBe('▶ 播放');
    expect(play.classList.contains('is-active')).toBe(false);
    expect(transport.playState).toBe('stopped');
    // 提示语写清起点：从当前高亮的记号起播（不是永远从全曲开头）
    expect(play.title).toContain('高亮');
  });

  it('三态的文案互不相同（用户一眼能分辨播放中 / 暂停中 / 已停止）', () => {
    const { transport } = makeTransport();
    const seen = new Set<string>();
    for (const state of ['playing', 'paused', 'stopped'] as const) {
      transport.setState(state);
      seen.add(transport.playState);
    }
    expect(seen.size).toBe(3);
  });
});

describe('位置栏：暂停时保留「停在哪一小节」', () => {
  it('逐音写入小节号与音名，停止时写回「未播放」', () => {
    const { root, transport } = makeTransport();
    expect(positionText(root)).toBe('未播放');
    transport.setPosition(3, 'C4');
    expect(positionText(root)).toBe('第 4 小节 · C4');
    transport.setPosition(7, null);
    expect(positionText(root)).toBe('第 8 小节');
    transport.setPosition(null, null);
    expect(positionText(root)).toBe('未播放');
  });

  it('暂停只改状态，不动位置栏（位置由 App 在 onNote 里守住：player.pause() 送来的 null 被挡掉）', () => {
    // 「停止」把位置清成「未播放」，「暂停」把位置留着——两个按钮在界面上看得见区别。
    // 这条约定写在 main.ts 的 onNote 里：`if (!note && this.player.isPaused) return;`
    const { root, transport } = makeTransport();
    transport.setPosition(3, '休止');
    transport.setState('paused');
    expect(positionText(root)).toBe('第 4 小节 · 休止');
  });
});

describe('暂停期间移动高亮：「继续」打回「播放」', () => {
  it('断点作废后按钮回到「▶ 播放」、提示是从当前高亮起播、位置栏清成「未播放」', () => {
    // 作废本身在 main.ts 的 dropResumePointOnCursorMove（player.cancelResume() + 这里的回写）；
    // 这条守的是界面上的结果：暂停态的「继续」与断点信息不能留到用户已经换了高亮之后。
    const { root, transport } = makeTransport();
    transport.setState('playing');
    transport.setPosition(3, 'C4');
    transport.setState('paused');
    expect(buttonByLabel(root, '▶ 继续')).toBeDefined();

    transport.setState('stopped');
    transport.setPosition(null, null);

    const play = buttonByLabel(root, '▶ 播放');
    expect(play.title).toContain('高亮');
    expect(play.classList.contains('is-active')).toBe(false);
    expect(positionText(root)).toBe('未播放');
  });
});

describe('快捷键说明与控制条一致', () => {
  it('Space 写的是播放/暂停 + 断点继续，Esc 写的是停止并回到开头', () => {
    const space = SHORTCUTS.find((s) => s.keys === 'Space');
    const esc = SHORTCUTS.find((s) => s.keys === 'Esc');
    expect(space).toBeDefined();
    expect(esc).toBeDefined();
    for (const key of ['播放', '暂停', '继续', '高亮', '移动']) expect(space?.desc).toContain(key);
    for (const key of ['停止', '回到开头', '高亮']) expect(esc?.desc).toContain(key);
  });
});
