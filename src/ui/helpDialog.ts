import { dialogButton, openDialog } from './dialog';
import { SHORTCUTS } from './shortcuts';

const LIMITS: string[] = [
  '第一版聚焦单声部旋律：多声部、和弦、复杂配器不在导入范围内。',
  '三连音、装饰音、自由速度（rubato）只能近似还原，可导入后手动修正或用工具栏标记三连音。',
  'SMPTE 时间格式（division 为负）的 MIDI 文件暂不支持。',
  '导入时按所选量化网格对齐；网格越细，还原越精确但谱面越密。',
  '间隙处理（导入 MIDI 对话框）：MIDI 里的音符之间常留缝（演奏留白、钢琴卷帘里音被切短、多轨合并后声部之间空一拍），量化后这些缝全变成一堆碎休止符。该选项是「多小的缝算噪声、直接抹掉」的阈值（以四分音符 = 1 拍计）——小于阈值的间隙并入前一个音符（前一个音拉长到下一个音的起点，时值随之变长，可能多出增时线，跨小节时产生连音线），不小于阈值的间隙保留并写成休止符。默认「合并 < 1/16 拍」；真人录音、留缝明显的选「合并 < 1/8 拍」或「合并 < 1/4 拍」；要休止位置严格对得上（切分节奏、乐句呼吸）选「保留所有间隙」。阈值必须不小于所选量化网格才有意义（间隙先按网格吸附，小于一个网格的缝已经吸成 0）；落在被合并的间隙上的歌词音节会挂到前一个音上。零时长音（见下一条）不受该阈值影响，始终补长。',
  '零时长音符（导入 MIDI 自动处理）：不少导出器把歌词音节起点写成 note-off 与 note-on 落在同一 tick 的音（时长 1 tick ≈ 0.002 拍），整条旋律里能掺进几十个这种音。它在所选量化网格上根本写不出来——量化后会被吹成一整个网格，紧跟的缝再落成碎休止符，谱面就成了「4// 0./ 5 5// 0./」这种碎十六分加碎休止。导入时把这类音补长到下一个音的起点（音节唱到下一个音节为止），最多补一个全音符（4 拍），补不到的那截仍按间隙处理写成休止符（乐句末尾的音节后面常跟着整段间奏，不能补成跨十几拍的长音）。真人录音里短于一个网格的真短音也会被补长，想保留原样就把量化网格选细一档（网格比音长更细，就不算零时长音）。',
  '八度点（导入 MIDI）：简谱的八度点是相对调主写的，MIDI 的绝对音高得挑一个八度窗口落位。导入按「调主落在 C4–B4」这个窗口给八度点，播放、导出 MIDI 与移调用的是同一个窗口，所以听到的和导出去的音高与源 MIDI 逐音一致（旧版按「旋律音域居中」挑窗口，谱面看着自洽，播放与导出却整首高一个八度）。代价：旋律整体坐在窗口之下的歌（男声低八度录音）谱面会多出一批低音点，可用工具栏 ↑ / ↓（快捷键 ] / [）逐个改，或整首移调；换「导入 MIDI」里的调也会挪动这个窗口。',
  '简谱数字与符号全部用 SVG 绘制，不依赖系统字体，跨平台渲染一致。',
  '圆滑线按标记顺序成组：连续标记的三个以上音符共用一条圆滑线；要画两条相邻圆滑线，中间需留一个未标记的音。',
  '记号精简（工具栏「简⌒」/ Alt + T，导入 MIDI 后自动执行）：把小节内同音连音线链合并成更长时值——2 拍 → 二分音符，3 拍 → 四分音符 + 两条增时线，4 拍 → 全音符；时值拼写取最优解（连音线最少、其次记号最少），例如 3.75 拍写成「四分 + 两条增时线 + 附点八分」而不是三段连音；受简谱记法限制，增时线最多三条、附点音符后不接增时线，比全音符更长的音仍需连音线，跨小节链、三连音链、带歌词的链不动。',
  '休止符合并（同一个按钮 / Alt + T）：小节内连续的休止符合并成更少的休止符——三个四分休止（4 拍）→ 一个全休止，附点四分 + 八分休止（2 拍）→ 一个二分休止，两个八分休止 → 一个四分休止；休止符不能用增时线延长，所以只在休止符个数确实减少时才改写，跨小节的休止不合并，音符会打断休止段。',
  '谱面显示：每行排进尽可能多的小节——全谱共用一套节拍网格，小节宽度只随实际记号（含歌词、延长线）增长，稀疏小节不被撑宽，同一拍在每一行、每一小节都上下对齐；「每行小节数」0 时按容器宽度自动折算，1-32 时固定每行该小节数；每拍内记号自左向右排，时值越短排得越密；数字用等宽字体；同一拍份内相邻记号下划线连成一条线段，不同拍份或跨小节下划线不连接。',
  '谱面字号（工具栏 A− / A / A+，Ctrl + Shift + = 与 Ctrl + Shift + -，「乐曲信息」里也有字号下拉）：整张谱面按字号等比缩放——数字、下划线、八度点、增减号、歌词、小节线与间距一起变，不是只放大数字；字号越大每行小节数越少、行数越多，18-48 共 8 档，默认 30；字号存在乐曲信息里，随工程文件保存、可撤销，导出 PNG / SVG 与打印按同一比例输出。',
];

export function openHelpDialog(layer: HTMLElement): void {
  const dialog = openDialog(layer, '快捷键与说明');

  const list = document.createElement('dl');
  list.className = 'shortcut-list';
  for (const item of SHORTCUTS) {
    const dt = document.createElement('dt');
    dt.textContent = item.keys;
    const dd = document.createElement('dd');
    dd.textContent = item.desc;
    list.append(dt, dd);
  }
  dialog.body.appendChild(list);

  const title = document.createElement('h3');
  title.textContent = '当前版本的已知限制';
  title.className = 'dialog-subtitle';
  dialog.body.appendChild(title);

  const ul = document.createElement('ul');
  ul.className = 'limit-list';
  for (const text of LIMITS) {
    const li = document.createElement('li');
    li.textContent = text;
    ul.appendChild(li);
  }
  dialog.body.appendChild(ul);

  dialog.footer.appendChild(dialogButton('知道了', 'btn-primary', dialog.close));
}
