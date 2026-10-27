# AGENTS.md — 简谱编辑器（jianpu-editor）

纯前端 TypeScript 单页应用：把 MIDI 转成简谱（numbered musical notation），在浏览器里编辑、播放、导出。
无框架、无运行时依赖；Vite 只做开发服务器与打包，Vitest 跑单元测试。

## 命令

- `npm run dev` — 开发服务器（默认 http://localhost:5173，`server.open: false`）
- `npm run build` — `tsc --noEmit` 类型检查 + Vite 打包到 `dist/`
- `npm run typecheck` — 只做 `tsc --noEmit`（提交前应通过）
- `npm test` — `vitest run`；单文件：`npx vitest run tests/layout.test.ts`；watch：`npx vitest`
- `npm run preview` — 预览打包结果
- `npm run clean` — `node scripts/clean.mjs`：删 `dist/`、根目录 `*.log`、`.tmp-profile/`
  等生成物（**不动** `node_modules`）

测试环境是 `node`（见 `vitest.config.ts`），**没有 DOM**。依赖 `document` / `window` 的代码
（`src/core/render.ts`、`src/io/export-image.ts`、`src/ui/*`、`src/main.ts`）无法在现有套件里直接测；
`core/layout.ts`（`layoutScore(score, containerWidth)` 纯计算）、`src/core/jianpu-text.ts`、`midi/`、`io/json.ts`、
`core/model.ts`、`core/spelling.ts`、`core/tie-compact.ts`、`core/rest-compact.ts` 是纯逻辑，可直接测。

## 架构（数据流）

`Score`（`src/core/model.ts`）是唯一真相来源，`ScoreStore`（`src/core/document.ts`）持有它并驱动一切：

1. 任何写操作都走 `ScoreStore` 的方法（`inputDegree` / `setDuration` / `splitBar` / `insertBar` …），
   方法内先 `snapshot()`、改完 `commit()`（发 `change` 事件 + 钳制光标），UI 订阅后整页重渲染。
2. 渲染链：`layoutScore(score, width)`（`core/layout.ts`，纯计算）→ `LayoutResult` →
   `renderScore(svg, layout)`（`core/render.ts`，建 SVG 节点）→ `ui/scoreView.ts` 挂进 DOM 并把点击坐标
   映射回 `eventId`。
3. 播放：`buildPlaybackPlan(score)`（`audio/player.ts`）把谱面拍数换算成绝对音高
   （首调：调主 MIDI 号 + `DEGREE_PC[音级]` 半音数，见 `core/constants.ts`），Web Audio 前瞻调度，逐音高亮。
   计划项**也包含休止符**（`PlayNote.kind = 'rest'`，`midi` 是 `NaN`，`schedule()` 跳过不发声音频节点）：
   播放经过休止符时「0」跟着高亮（`.is-playing` 走 `g.jp-block.jp-rest` 那条链，拆分休止符的多个「0」
   同属一个 group 所以一起亮），末尾休止符也计入 `totalBeats`（否则以休止结尾的曲子会提前结束）。
   **坑**：取 `PlayNote.midi` 前必须先判 `kind`——休止符项是 NaN，`midiToNoteName(NaN)` 会输出
   `undefinedNaN`（`main.ts` 的 `onNote` 对休止符写「休止」）。连音线后续音符（`tied=true`）与增时线
   一样不发声，增时线本身不进计划（时值累加进前一个音符，所以增时线期间是链首音符一直亮着）。
4. 导入：`midi/smf.ts` 解析 SMF → `midi/import.ts` 取最高声部、按网格量化、按 C4–B4 窗口定八度点 →
   `midi/quantize.ts` 拼成小节 → 导入后自动跑一遍 `core/tie-compact.ts`（连音线合并）+ `core/rest-compact.ts`（休止符合并）。
   **八度基准**（`midi/import.ts` 的 `importTonicBase`）必须返回 `tonicMidiBase(tonic, 4)`，与播放
   （`audio/player.ts`）、导出 MIDI（`midi/export.ts`）、移调 notes 模式（`core/transpose.ts`）用同一个基准。
   **坑**：`Tonic` 只有音名没有八度，导入时挑的基准**不存进谱面**，八度点是各处按窗口重新解读的——基准取到
   别的八度，谱面自己看着自洽，播出来 / 导出去却整首差一个八度。旧实现按「旋律音域居中」挑（`(min+max)/2 - 6`），
   音域约两个八度的歌会把基准定到调主下方五度，导入→导出全曲 +12 半音，谱面六成记号顶着高点（众数音写成 `1′`）；
   按八度点总数 Σ|octave| 数它连自己的指标都没赢（居中只看 min/max 不看分布）。旋律整体坐在窗口之下的曲子
   谱面会多出一批低音点，这是模型没有绝对八度字段的必然
   结果——要谱面居中又发声准确，得把基准存进 `meta`。见 `tests/midi-octave.test.ts`。
   **间隙处理**（`QuantizeOptions.minRestBeats`，导入对话框默认 0.25）：`toBeatNotes` 网格吸附后逐对相邻音符看
   `gap = cur.start - prev.end`，`gap < minRestBeats` 就把 `prev.end` 拉到 `cur.start`（前一个音变长，不是删后一个音），
   这段网格不再空 → 不写休止符；否则空网格落成休止符。**坑**：间隙先按网格吸附，小于一个网格的缝已经是 0，
   所以阈值必须 ≥ `grid` 才有意义（网格 1/8 + 阈值 1/16 = 完全不合并）；判据是严格小于（`gap < minRestBeats - EPS`）。
   合并是逐对做的且改写 `prev.end`，所以一串连续小缝会链式并进同一个音（时值变长 → 多出增时线 / 跨小节连音线），
   落在被合并间隙上的歌词音节也会跟着挂到该游程首记号上（原本按规则该丢）。见 `tests/quantize.test.ts`。
   **零时长音**（`SHORT_NOTE_MAX_FILL_BEATS` = 4，`toBeatNotes` 里）：导出器常把歌词音节起点写成
   note-off 与 note-on 落在同一 tick 的音（时长 1 tick ≈ 0.002 拍，一首带中文歌词的歌里常有几十个，各挂一个音节）。
   这种音在网格上写不出来：吸附后 `end <= start + EPS` 会被吹成一整个网格，紧跟的缝再落成碎休止符，
   一小节就成了 `4// 0./ 5 5// 0./ 1'/ 7/`（补长后是 `4, 5, 5, 1/ 7,/`，八度点按窗口基准给，见上一条）。所以间隙合并**之前**
   先把「原始时值 < grid」的音补到 `min(下一个音的起点, start + 4 拍)`——音节唱到下一个音节为止；
   上限取一个全音符，因为乐句末尾的音节后面常跟着整段间奏（几十拍的缝），不能补成跨十几拍的长音。
   补不到的那截照旧走间隙处理。该规则不看 `minRestBeats`，所以默认档位
   （网格 1/16 + 阈值 1/16，等于不合并）也能出干净谱面；想保留短音原样就把网格选细一档
   （网格比音长更细就不算零时长音）。见 `tests/quantize.test.ts`、`tests/midi-lyric.test.ts`。


5. 导出：`io/json.ts`（工程文件 + 下载 + localStorage）、`midi/export.ts`、`core/jianpu-text.ts`（文本）、
   `core/render.ts`（SVG 字符串）、`io/export-image.ts`（PNG）。打印走浏览器（`@media print` 在 `src/styles.css`）。

`src/main.ts` 的 `App` 是唯一把这些接线起来的地方（约 430 行，含工具栏 / 快捷键回调）。

## 关键约定

- 时值长度换算集中在 `src/core/model.ts` 的 `durationBeats`（`4 / 时值`）、`noteBeats`（含附点）、
  `barBeatLength` / `measureBeats`，不要散落实现。
- 时值「怎么写」集中在 `src/core/spelling.ts`：`pickSegment` / `representDuration`（贪心，量化用）、
  `bestSpelling`（动态规划，按「连音线数 → 记号数 → 增时线数」字典序取最优，连音线合并用）、
  `segmentEventCount` / `segmentTieCount`（增时线最多 `MAX_DASHES` = 3 条，再多换更长时值；
  附点音符后不接增时线，那几条线在渲染时会展开成同音连音线链；附点只给 `d > 2` 的时值，
  即不写附点二分 / 附点全音符）。贪心会错过更省连音线的写法：3.75 拍贪心给 3 条连音线，
  `bestSpelling` 给 1 条。段的覆盖拍数必须正好落在网格上（`isMultiple(covered, grid)`），
  否则会把时值悄悄改掉。
- 连音线（tie）只在同音高音符间合并时值；圆滑线（slur）是独立弧线，连续标记三个以上音符共用一条弧线。
  `src/core/tie-compact.ts` 的 `compactTieChains` 把小节内同音连音线链合并成更长时值（工具栏「简⌒」/ `Alt+T`，
  MIDI 导入后也会自动跑一遍）：时值拼写用 `bestSpelling` 求最优（连音线最少、其次记号最少）；
  只在「时值能精确表示 + 合并后连音线严格变少」时改写（事件数最多允许多出
  `MAX_DASHES` 条增时线）；跨小节链、三连音链、带歌词的链、带圆滑线标记的链不动。
  剩下的连音线大多是「附点音符 + 连音音符」（2.5 / 3.5 拍这类）与跨小节长音，在现有记法下已是最省连音线的写法。
- 休止符**不能用增时线延长**（增时线只延长音符），所以 `src/core/rest-compact.ts` 的 `compactRestRuns`
  用 `representDuration(beats, grid, false)`（禁用增时线）把小节内连续休止拼成最少个数的休止符：
  `0:4. 0:4. 0:4` → `0:1`，`0:4. 0:8` → `0:2`。只在「时值精确 + 个数严格减少」时改写（幂等），
  跨小节不合并、音符打断休止段。`ScoreStore.compactNotation()` 把两者合成一次操作（一次撤销全部还原），
  工具栏「简⌒」/ `Alt+T` 与 MIDI 导入后处理都走它。
- MIDI 歌词（SMF meta `0x05`）分两层：`midi/smf.ts` **忠实解析**成 `MidiTrack.lyrics`（`{tick, text}`），
  文本解码走 `decodeMetaText`——UTF-8 解出汉字就认 UTF-8，解不出汉字而 GBK 解得出就认 GBK
  （GBK 的双字节常常**同时**是合法 UTF-8：「站」的 GBK 是 `D5 BE`，按 UTF-8 会解成 `U+057E`，
  所以不能只靠「解码失败」判编码）；解码任何情况下都不抛异常。
  **落位**由 `midi/quantize.ts` 的 `attachLyrics` 决定：tick → 拍 → 网格单元 → 音符游程的**首记号**
  （增时线与连音续接音符不挂，这样合并连音线时不会吞词）；同一音上的多个音节连写拼接；
  落在休止 / 间隙上的音节（前奏、间奏）丢弃；纯连字符 / 延音线（`-` `_`）不算音节。
  `midi/import.ts` 的 `buildScoreFromMidi` 只收集**选中轨道**的歌词（`ImportOptions.attachLyrics`，默认开），
  `countLyricNotes(bars) > 0` 才把 `meta.showLyrics` 打开；`midi/export.ts` 导出时把 `ev.lyric`
  按起始 tick 写回 `0x05`（round-trip 不丢词）。见 `tests/midi-lyric.test.ts`。
- 全曲移调集中在 `src/core/transpose.ts` + `ScoreStore.transposeAll(semitones, mode)`，以**半音**为单位（正 = 升高）：
  `mode = 'key'`（默认，标准简谱写法）只平移调号（`shiftTonic`，谱面数字一个都不动，`commit('meta')`）；
  `mode = 'notes'` 调号不动，逐音符改写 (音级, 升降号, 八度点)：拼写走 `constants.ts` 的 `pitchToMapping`
  （`CHROMATIC_TABLE`：相对调主的半音数 → 音级 + 升降号，与 MIDI 导入同一套约定），升降偏好沿用 `isFlatKey`
  （降号调继续写降号 `1=bG`，升号调继续写升号 `1=D#`）。`degree === 0` 的音符（旧工程文件里写成音符的休止）
  跳过——`mappingToMidi` 对它算出 NaN。八度点钳制在 ±2，越界个数计入 `stats.clamped` 供 UI 提示
  （`mode='key'` 不动音符，没有这个限制）。**坑**：调主只有音名没有八度，`tonicMidiBase` 恒落在 C4–B4，
  所以改调号后实际发声的变化是 `effectiveKeyShift(from, to)`，可能与请求的半音数差整八度
  （C 降 5 个半音 → `1=G` → 发声升 7 个半音）；UI 播报必须用这个值，不能说成请求值。
- 调名解析：`parseTonic` 两种写法都认——前缀（`bB` / `#F`，`formatTonic` 与 `ALL_TONICS` 用的格式）与
  后缀（`Bb` / `F#`，`SHARP_KEYS` / `FLAT_KEYS` 用的格式），所以 `ALL_TONICS` 每一项都满足
  `formatTonic(parseTonic(label)) === label`（「乐曲信息」/「导入 MIDI」的调下拉选 `F#` 不会掉成 F）；
  认不出音名会**静默退回 C**，所以异名同音的取舍要显式走 `tonicFromPc(pc, preferFlat)` 的表，别指望它报错。
  `keySignatureSharps` 比较调号表与 `formatTonic` 的写法前先 `normalizeKeyLabel` 统一
  （否则降号调的调号数恒为 0，MIDI 导出的调号事件也是错的）。
  判「认不出音名」必须写 `LETTER_PC[letter] === undefined`，**不能写 `!LETTER_PC[letter]`**——C 的音级类是 0，
  取反会把 `C#` 的升降号吃掉。`ALL_TONICS` 有 17 个调（含全曲移调走得到的 `C#` `G#` `D#` `A#` `bG`），
  每一项都能 round-trip；表外调的调号数走 `keySignatureSharps()` 的 `PC_SHARPS_FALLBACK`（按记号最少取，
  如 `A#` 记作 2 个降号），MIDI 导出的调号事件用它。

- 谱面字号（`meta.fontSize`）是**整张谱面的等比缩放**，不是逐元素字号：档位表 `FONT_SIZE_STEPS`（18…48），
  默认 `DEFAULT_FONT_SIZE` = 30 = 排版用的 `FONT_SIZE`（`core/metrics.ts`）。排版层用
  `containerWidth / fontScaleFor(fontSize)` 折算可用宽度（字号越大每行小节数越少），`LayoutResult.scale`
  记录系数；几何坐标仍按标准字号计算，渲染层只把 SVG 的 `width` / `height` 乘上系数
  （用 `scaledSize(layout)`，PNG 导出同理），`viewBox` 保持标准单位。非档位值一律经 `snapFontSize`
  吸附（JSON 导入、UI 显示都走它）；页眉在 SVG 里，随同一系数缩放。
  入口：工具栏 `A−` / `A` / `A+`、`Ctrl+Shift+=` / `Ctrl+Shift+-`、「乐曲信息」字号下拉，
  实现在 `main.ts` 的 `stepFontSize`（走 `setMeta`，可撤销、随工程文件保存）。
- 页眉（歌曲信息）是**谱面 SVG 的一部分**，不是 HTML：`core/layout.ts` 的 `layoutHeader(score, pageWidth)`
  纯计算给出每条文字的坐标 / 字号 / 对齐（`LayoutResult.header`，第一行谱表从 `header.height` 起排，
  总高已计入页眉带），`core/render.ts` 的 `renderHeader` 只落笔 —— 于是编辑器、导出 SVG / PNG、打印
  四处版式完全一致（`ui/scoreView.ts` 不再渲染 HTML 页眉）。版式自上而下三行：
  **标题独占一行**（居中 + 宽字距 `TITLE_TRACKING`，行距 `TITLE_LINE_GAP`）→ 副标题 →
  「演唱 ×××」（`meta.singer`）；居中栏之下空出 `HEADER_BLOCK_GAP` 排**信息带**：左栏
  `1=C 2/4` / `♩=速度` 贴左边距，右栏「×× 作词 / ×× 作曲」贴右边距，两栏同一水平带。
  调号 / 速度 / 词曲作者**一律不与标题、演唱同线**（旧版式把作者压在标题基线、把调号速度压在
  演唱基线，整块页眉读起来很挤）；没有任何居中内容时信息带回到 `HEADER_TOP_PAD`，
  空谱面不会凭空长高。窄页下右栏撞到左栏时**整栏下移**（页眉带变高，不裁剪不重叠）。
  文字宽度用 `core/metrics.ts` 的 `textWidth`（汉字一字宽、拉丁半宽估算），
  排版常量集中在 `metrics.ts`（`TITLE_FONT_SIZE` 等）。样式在 `styles.css` 用 `.jp-score .jp-title` 这类
  **带 `.jp-score` 前缀**的选择器（否则压不过 `.jp-score text` 的等宽字体），导出 SVG 内嵌样式另有一份。
  新增元信息字段要走三处：`core/model.ts` 的 `Meta` + `defaultMeta()`、`io/json.ts` 的 `deserializeScore`、
  `ui/metaPanel.ts` 的输入框（`sync` + `bind`）。

- 列宽模型（`layout.ts` 的 `columnMins` / `centerGap` / `isStrictBox`）：全曲所有小节共用同一套列宽
  （`tests/layout-grid.test.ts` 守着这个不变量），每列宽度由两类约束取 max。**严格盒**（必须撑满自己那格，
  列宽按「自然宽度 / 它占的拍份数」摊算）：小节末记号（盒要铺到小节右内边距，跨小节的相邻记号才不撞）、
  增时线记号与带增时线的长音（每根横线至少占一个拍份单位，`dashSplitSlots` 要把横线落在拍份网格上）、
  拆成若干「0」的二分 / 全休止符（`restSplitSlots` 逐拍落位）。带歌词的记号**不算**严格盒：音节居中落在
  数字中心下方，中心距由下面的墨迹约束给出（`blockNaturalWidth` 里的音节宽项只在严格盒场合生效）。
  **墨迹相撞**（其余记号只要求相邻墨迹不撞）：中心距 ≥
  左记号右半墨迹 + 右记号左半墨迹，除以时值占比 Δ 换成列宽下限，再加两侧升降号宽之差（升降号把数字中心
  整体右移 `ACCIDENTAL_W`）。墨迹半宽见 `metrics.ts` 的 `inkHalfLeft` / `inkHalfRight`：左 = max(升降号 + 半个数字, 半个音节)
  （`centerGap` 按右邻**有无**升降号取 `max(acc + 半个数字, 半个音节)`，`inkHalfLeft` 是带升降号的上界），
  右 = max(半个数字, 半个音节) + 附点（只有 `dotted` 为真才画得出附点，
  与渲染同判）。**坑**：旧模型「每个记号撑满自己那格」= 中心距 ≥ 自然宽 / Δ，32 分音符把列宽下限顶到
  `DIGIT_W / 0.125 = 112`，整小节 32 分 → 每行只 2 小节；现在 8 个 32 分音符只占 8 个数字宽。
  升降号墨迹在数字**左侧**，必须计入**右邻**的左半宽（旧模型只把它算进左邻的右半宽，
  「带升号的十六分音符 + 十六分休止符」实测相撞约 6.5 用户单位）。列宽取全曲各列 max 后按容器宽度
  **只放大不缩小**（`fitPerLine` 用自然宽度定每行小节数，缩放系数只作用于 `barWidth`，`slotPosition`
  与 `restSlots` 一律用未缩放列宽）。回归见 `tests/layout-ink.test.ts`（32 分 / 带词 / 升降号 /
  拉丁长音节 / 附点 / 稀疏小节 / 拆分休止符）。


- 歌词字号与落位集中在 `core/metrics.ts`：`LYRIC_FONT_SIZE` = 18（数字 `FONT_SIZE` = 30 的 0.6 倍，
  汉字音节读得清又不抢数字），`LYRIC_OFFSET` = 36 是**最小**距离，`belowStack(underlines, dotsBelow)`
  算出「下划线 + 低音八度点」堆叠的底边，`lyricBaseline()` = 让歌词顶边压在这条线之下
  （净空 `LYRIC_CLEARANCE`）。`layout.ts` 排版第 3 步把**同一行所有音节**对到一条基线：
  取本行所有记号（**含没有歌词的音符**，它的低音点也得在歌词行之上）`lyricBaseline` 的最大值，
  写进 `NoteBlock.lyricOffset`，`render.ts` 只照它落笔；行高 `bottomPad` 计入歌词底边，
  记号盒宽度计入整音节宽度（`lyricWidth`，拉丁字母按 0.52em 估），所以相邻音节不压字。
  **坑**：字形字号必须由排版层写进 `text` 的 `font-size` **属性**（用户单位，随 `meta.fontSize` 缩放）——
  `styles.css` 里给 `.jp-lyric` / `.jp-digit` 这类类写 px 字号会**压过呈现属性**，歌词就固定成屏幕像素、
  既不随谱面字号缩放，也与排版预留的基线错位（编辑器与导出 SVG / PNG / 打印四处也不一致）。
  回归见 `tests/lyric-layout.test.ts`（比例 / CSS 无 px 字号 / 基线让位 / 行高与列宽 / 整曲不重叠）
  与 `tests/render.test.ts` 的歌词基线用例。

- 小节线只覆盖**音符区**，不伸进歌词带（竖线穿过汉字会读成表格线）：长度由排版层给出
  （`layout.ts` 排版步骤 5 写进 `Barline.top` / `Barline.bottom`），`render.ts` 的
  `renderBarline` 只照坐标落笔，反复线的小圆点按这条线的中点排。顶端高出数字顶边
  `BARLINE_TOP_ABOVE`，底端取到本行最深的「下划线 + 低音八度点」堆叠（至少
  `BARLINE_MIN_BELOW`，与 `bottomPad` 下限一致），有歌词的行再止于歌词顶边之上
  `BARLINE_LYRIC_GAP`；同一行所有小节线等长（竖向齐平）。因为 `lyricBaseline` 恒在堆叠之下
  留出 `LYRIC_CLEARANCE`，「止于歌词之上」永远不会把小节线压到盖不住低音点。
  **坑**：`lyricOffset` 与 `belowStack` 都相对**数字底边**（渲染时加 `CAP_HEIGHT / 2`），
  换算成 system 坐标时漏掉这一项，小节线就会扎进歌词。
- 播放控制条只有**两个按钮**：播放按钮三态切换（`PlayState` = `stopped` / `playing` / `paused`），
  「⏹ 停止」独立表示「淡出 + 回到开头（光标高亮送回第一个记号）」。语义：**停止态点 = 从当前高亮的记号起播，
  播放中点 = 暂停（`player.pause()`），暂停中点 = `player.resume()` 从断点续播**。
  **坑**：旧版播放按钮第二次点击直接 `stop()`，与「停止」按钮完全等价，而「⏸ 暂停」按钮只调 `pause()`
  从不接 `resume()`——暂停后按播放是从光标处重头播，等于第三个「停止」；三个按钮两个半在干同一件事。
  `player.isPlaying` 只在 `state === 'playing'` 为真，暂停态必须走 `isPaused` + `resume()`，
  不能拿 `isPlaying` 判「该不该继续」。断点存**拍**（`pauseBeat`）不存秒——暂停期间用户会改速度 / 倍速，
  存秒的话续播拍位会跳（与 `setRate` 里「发声与逐拍高亮两条时间轴必须对齐」同一套约定）；`stop()` 清断点，
  之后 `resume()` 退化成从头播放。**暂停期间移动高亮 → 断点作废**（`main.ts` 的
  `dropResumePointOnCursorMove`：在 store 订阅里比较光标的「小节:槽位」键，动了且 `player.isPaused`
  就 `player.cancelResume()` + `transport.setState('stopped')` + 清位置栏）：断点留着的话，暂停后
  点第 40 小节再按 Space 会从**旧断点**续播，新高亮被完全无视——按钮写着「继续」，播出来的却不是那里。
  `Player.cancelResume()` **只在暂停态生效**（播放中调用不能掐掉正在响的声音），且不动音频——
  `pause()` 已经把声部淡出停干净了，没有需要淡出的东西。
  暂停时 `player.pause()` 也发 `onNote(null)` 清高亮，
  `main.ts` 的 `onNote` 必须在 `isPaused` 时**直接 return**，位置栏才留得住「停在哪一小节」
  （否则暂停与停止在界面上长得一模一样）。`transport.setState(state)` 的 `is-active` **只在真发声时亮**
  （暂停态顶着按下态 = 界面在骗人）。回归见 `tests/transport-dom.test.ts`（按钮集合只有播放 + 停止 /
  三态文案与按下态 / 位置栏 / Space 与 Esc 的说明一致）与 `tests/player-audio-dom.test.ts` 的「断点存拍」用例
  （resume 只排断点之后的音 = 35 个振荡器而非从头重排的 40；暂停期间把速度翻倍续播拍位不跳；
  停止清断点后 `resume()` 整首重排）与「断点作废」用例（`cancelResume` 后 `resume()` 整首重排 = 40 个；
  播放中调用 `cancelResume` 不停声音）、`tests/transport-dom.test.ts` 的「继续打回播放」（按钮回到
  「▶ 播放」+ 提示含「高亮」+ 位置栏「未播放」）。
  **起播点问 `ScoreStore.playStartEventId()`，不能直接取 `currentSlot().event`**：光标落在小节末尾的
  **空槽**时那里画的是光标符、`event` 是 null，直接取会让「从高亮处播放」跳回全曲开头——空槽要往后找
  第一个记号（`main.ts` 的 `togglePlay`）。光标在增时线上时原样把它的 id 交给 `player.play()`：增时线不是
  播放计划项，`play()` 用 `findEventBeat` 换算成所在长音的拍位，`firstSoundingIndex` 按「结束拍 > 起播拍」
  把那个音留下（从头重放一次）。**「停止」要把光标也送回开头**（`main.ts` 的 `rewindToStart`：
  `store.goToStart()` + `view.render()` + `view.revealCursor()`）——
  播放是从高亮处起播的，高亮留在第 100 小节，下一次播放就从第 100 小节起，
  「回到开头」等于没做到；`revealCursor()` 复用播放跟随的滚动（`followElement`），长谱面上停在末尾时
  滚回开头才看得见。播完一遍（`player.onEnd`）走同一个落点。`goToStart()` 不 `snapshot()`：
  光标不在历史里，不该多出一条撤销记录。
- 播放的**音长由增益包络决定**，不是由振荡器决定（振荡器一直响到释音结束）：`audio/player.ts` 的
  `noteEnvelope(cfg, durSec, velocity)`（纯计算，可单测）给出五个控制点
  `0 → 峰值 → sustain → tail → 0`，`voice()` 只照点落笔（时间重合的两点之间没有斜坡，用
  `setValueAtTime` 定值——Web Audio 要求自动化事件时间不减）。两条硬约定：
  **① `sustain` 是整段时值里的发声电平，必须停在可听区**（≥ 峰值的 40% 量级）——拨弦类想要
  「余音渐弱」用 `bodyTail`（持续段末尾相对 sustain 的比例）做缓慢衰减，**不能靠压低 `sustain`**
  （旧值钢琴 0.12 / 吉他 0.04 / 八音盒 0.01 让长音在 0.4 秒内掉到 −18…−40 dB，听感就是
  「每个音都很短，没按时值延长」，而长笛 / 提琴 / 风琴 / 单簧管 sustain 0.7–0.85 所以没事——
  「只有部分音色出问题」的根源）；**② 释音以时值结束点为中心**：淡出从 `durSec - release` 起、
  到 `durSec + release * 2` 归零（到点时还剩 2/3 尾音），`release ≤ 0.25 × durSec`，
  且 `attack + decay` 必须 ≤ 释音起点，否则长音一路衰减、落不到 sustain。
  时值下限由 `pump()` 用 `MIN_NOTE_SEC` 钳成 0.05 秒。回归见 `tests/audio-envelope.test.ts`
  （七种音色 × 八种时值：时值 3/4 与 9/10 处振幅 ≥ 0.03（约 −30 dBFS）、结束点不早于时值、
  尾音 ≥ 峰值 25%、控制点时间不减）。
- 播放的**防爆音约定**（偶发「啪 / 咔哒」的成因全在这一节，`audio/player.ts`）：
  **主输出不直接进 destination**，中间串一级 WaveShaper 软限幅（`softClipCurve()`：`SOFT_CLIP_KNEE`
  以下线性、以上平滑饱和、`oversample: '4x'` 防混叠嘶声）——音与音的尾音是重叠的，几条尾巴一叠加
  就顶满刻度，直接进 destination 是硬削波，听感就是「啪」。用软限幅而不是 `DynamicsCompressor`：
  压缩器自带 makeup gain 把余量吃回去，而且曲线不可控、没法单测。`MASTER_GAIN` = 0.8 留峰值余量
  （`voicePeakAmplitude()` 是各音色峰值之和，`voiceGainSum()` 是同时可响的声部数）。
  **前瞻调度**：`schedule()` 只锚定时间轴，后续的音由 `pump()`（`PUMP_INTERVAL_MS` = 25ms）在
  `LOOKAHEAD_SEC` = 0.5 秒窗口内逐批创建——一次排完整首会在长谱面上瞬间造出几千个振荡器 /
  滤波器节点，建图尖峰压垮音频线程的渲染预算（渲染量子超时 = 丢帧噼啪）。**后台标签页一次排完
  剩余整段**（rAF 停摆、`setInterval` 节流到 1 秒以上，0.5 秒窗口跟不上 = 一段段静音，
  听感也是卡顿）。
  **停音一律淡出**：暂停 / 停止 / 变速 / 循环接缝都走 `stopVoices()`——`cancelScheduledValues(now)`
  之后先 `setValueAtTime(当前电平, now)` 把增益停在当前值（只 cancel 会让增益跳到旧包络的末值），
  再 `linearRampToValueAtTime(0, now + FADE_OUT_SEC)`；**淡出期间不断开节点**（断开 = 立刻静音 =
  咔哒），淡出完才 `stop` + `disconnect`。循环接缝**不能** `voices = []`：上一遍的尾音脱离跟踪就
  淡不掉，长音会在接缝处叠起来顶满刻度。响完的声部由 `pruneVoices()` 按 `endsAt` 回收。
  **起播点钳到当下**（`SCHEDULE_AHEAD_SEC`）：从长音中间起播时 `startSec` 在过去，而 Web Audio 里
  「时间早于当前」的自动化事件会塌成跳变 = 增益直接跳到峰值 = 一声爆点。
  其余：`latencyHint: 'interactive'`（默认 balanced 的渲染缓冲更大，起音与高亮偏差更明显）；
  非有限频率（`degree === 0` 的旧数据写成音符的休止）不建节点（NaN 进 AudioParam 在 Chrome 抛异常，
  整首放不出来，计划项要留着供高亮与拍数）；变速要**重新锚定时间轴**（只改 `rate` 会让已排好的音
  与逐拍高亮分家，高亮瞬间跳一大截）。回归见 `tests/player-audio-dom.test.ts`（假 AudioContext：
  输出连线 / 前瞻批量 / 淡出顺序与不断开 / 循环接缝停干净 / NaN）与 `tests/audio-envelope.test.ts`
  的软削波曲线、余量与 `isPlayableNote` 用例。
- 「导入 MIDI」对话框（`ui/importDialog.ts`）的三处坑：**控制项容器建好必须 append**
  （`options` 那组「量化网格 / 间隙处理 / 调 / 拍号 / 速度 / 标题 / 导入歌词」曾经只建元素没挂进
  `dialog.body`，监听照挂、预览照刷新，界面上就是轨道列表和预览之间一大片空白，控件一个都看不见）；
  **整行说明文字不能和轨道行共用网格**（`.track-list-head` 与 `.track-row` 曾经同一条
  `grid-template-columns: 24px minmax(0,1fr) 130px`，标题是单个文本节点，被塞进第一列那 24px，
  挤成一列一个字竖排；现在标题是普通块，轨道行独占 `20px minmax(0,1fr) auto`，
  `.track-meta` 加 `white-space: nowrap`——固定 130px 会把「283 音 · 41-84 · 144.91 拍」折两行撑高行高）；
  **预览宽度取预览盒的实际宽度**（`previewBox.clientWidth - PREVIEW_PAD_X`，量不到时退回
  `PREVIEW_FALLBACK_WIDTH` = 720：写死 720 在 680px 的对话框里永远出横向滚动条），
  并且每次刷新把 `previewBox.scrollTop` 归零（预览盒比整段预览矮，停在底部一打开看到的是曲子中段）。
  回归见 `tests/import-dialog-dom.test.ts`（控制项在 DOM 里且排在预览之前 / 改拍号重算预览 /
  标题无子元素 + CSS 不给 `.track-list-head` 写网格 / 统计列不写死宽度且不换行 / 预览宽 380 非 720 / 滚回顶部）。

## 目录结构

- `src/core/` 模型（`model.ts`）、历史（`history.ts`）、文档存储与光标（`document.ts`，`CursorState` 在 `score` 上）、时值拼写（`spelling.ts`）、连音线合并（`tie-compact.ts`）、休止符合并（`rest-compact.ts`）、简谱文本（`jianpu-text.ts`）、排版（`layout.ts`）、渲染（`render.ts`）、度量（`metrics.ts`）、常量（`constants.ts`）
- `src/midi/` `smf.ts` 解析 Standard MIDI File、`import.ts` 转谱、`quantize.ts` 量化、`export.ts` 写 MIDI
- `src/io/` `json.ts` 工程文件 + 下载 + localStorage、`export-image.ts` PNG
- `src/audio/` `player.ts` Web Audio 播放与逐音高亮
- `src/ui/` `toolbar` `transport` `metaPanel` `scoreView` `editor` `importDialog` `transposeDialog` `helpDialog` `dialog` `toast` `shortcuts`
- `src/samples.ts` 内置示例谱；`src/main.ts` 应用装配
- `tests/` Vitest 用例（440 个，全部本地可跑，不依赖任何外部样本文件）；字号缩放见 `tests/font-size.test.ts`（档位表 / 排版 / JSON）与 `tests/font-size-dom.test.ts`（渲染尺寸 / 面板 / 工具栏 / 快捷键，happy-dom）；页眉（歌曲信息）排版见 `tests/header.test.ts`（纯计算：居中 / 左右栏 / 侧栏下移 / 页眉带高度）；MIDI 歌词见 `tests/midi-lyric.test.ts`（UTF-8 / GBK 解码、tick 落位、round-trip、导入带歌词与导出写回）；导入的八度基准见 `tests/midi-octave.test.ts`（导入基准 == 播放 / 导出 / 移调的 C4–B4 窗口基准）；连音线 / 休止符合并见 `tests/tie-compact.test.ts`、`tests/rest-compact.test.ts`（合成谱面 + 小节拍数守恒）；全曲移调见 `tests/transpose.test.ts`（调号平移 / 两种模式等价 / 八度点钳制 / 预览 / 音程名）与 `tests/transpose-dom.test.ts`（移调对话框、工具栏按钮、快捷键，happy-dom）；歌词与记号的几何见
  `tests/lyric-layout.test.ts`（字号比例 / CSS 不写 px 字号 / 基线让开下划线与低音点 / 行高与列宽）；
  小节线长度见 `tests/lyric-layout.test.ts`（不穿歌词 / 覆盖下划线与低音点 / 同行等长 / 无歌词行）
  与 `tests/render.test.ts`（渲染出的 `y1`/`y2` 取排版坐标）；
  音色包络见 `tests/audio-envelope.test.ts`（纯计算：长音响满时值 / 释音锚在时值结束点 / 尾音电平）；
  播放计划与逐拍高亮见 `tests/player.test.ts`（连音线时值合并 / 休止符进计划并在对应拍位命中 /
  末尾休止符计入总时长 / 计划项首尾相接不留空隙）；播放控制条的按钮语义见
  `tests/transport-dom.test.ts`（只有播放 + 停止两个按钮 / 播放按钮三态文案与按下态 / 位置栏 /
  暂停后移动高亮则「继续」打回「播放」 / 快捷键说明同步，happy-dom）；暂停续播见 `tests/player-audio-dom.test.ts` 的「断点存拍」用例；
  播放起点与「停止回到开头」见 `tests/cursor.test.ts`（`playStartEventId` 的三种光标位置 / `goToStart`
  发 change 而不写历史）、`tests/cursor-dom.test.ts`（`goToStart` 后 `.is-cursor` 只剩全曲第一个记号 /
  `revealCursor` 两条分支不抛，happy-dom）与 `tests/player-audio-dom.test.ts` 的「播放起点」用例
  （从第 5 个音起播只排 4 个音 = 20 个振荡器 / 传 null 整首 40 个 / 从增时线起播落在所属长音上 = 20 个，
  从下一个音起播长音不响 = 15 个）；播放的防爆音行为见
  `tests/player-audio-dom.test.ts`（happy-dom + 假 AudioContext：输出串软限幅 / interactive 延迟 /
  前瞻批量建声部 / 停止淡出先停电平再拉零且淡出期间不断开 / 循环接缝停干净 / degree 0 不进 NaN）；
  导入对话框排版见 `tests/import-dialog-dom.test.ts`（控制项挂在 DOM 里 / 轨道标题不进气网格 /
  统计不换行 / 预览按盒宽排版并滚回顶部，happy-dom）；
  帮助文档覆盖导入选项见 `tests/help-dialog-dom.test.ts`（已知限制逐条渲染无空条目 /
  「间隙处理」条目里四个档位文案与「并入前一个音 + 休止符 + 量化网格」三要点都在，happy-dom）
- `scripts/` 生成 / 清理脚本（`make-sample-midi.mjs` 生成测试用的 `samples/twinkle.mid`、`clean.mjs` 清理生成物）；`docs/DESIGN.md` 设计文档
- `.github/workflows/` `ci.yml`（Node 22 / 24 跑 typecheck + test + build）、`pages.yml`（把 `dist/` 发到 GitHub Pages）；根目录 `LICENSE`（MIT）、`.gitignore`、`.gitattributes`、`.editorconfig`

## 代码风格

- 2 空格缩进、单引号、语句结尾分号；行宽约 110 字符（`printWidth: 110`，见 `tsconfig.json` 注释）。
- 类型用 `type` 定义、`import { type X }` 内联导入；联合类型做判别式（`NoteEvent | RestEvent | DashEvent` 用 `kind`）。
- 导出一律具名导出，不用 default。
- 注释用中文，解释「为什么」和边界情况（例：`spelling.ts` 里「附点后不能接增时线」的说明）。
- 命名：camelCase 函数 / 变量，PascalCase 类型与类，常量大写（`DEGREE_PC`、`DURATION_ORDER`、`MAX_DASHES`）。
- 校验用 `throw new Error('中文消息')`，由 UI 层 `toast()` 展示。

## 必须遵守的不变量

- 小节拍数守恒：`barBeatLength(bar)` 要等于当前拍号的 `measureBeats(timeSig)`。改小节内事件时
  用 `barBeatLength` 核对（`tests/tie-compact.test.ts`、`tests/layout.test.ts` 都这么做），别引入拍数溢出 / 缺口。
- 事件 `id` 唯一：新建事件用 `nextId()`（`core/model.ts`），复制谱面用 `cloneScore()`。
- 光标 `eventIndex` 是「槽位」索引（事件数 + 1，可落在事件后面），任何改事件数量的操作后要钳制。
- 不要绕过 `ScoreStore` 直接改 `score.bars` 再发事件——历史快照与自动保存会失效。

## 不要做

- 不要引入框架、运行时依赖或构建插件；保持零运行时依赖。
- 不要在 `layout.ts` / `quantize.ts` / `tie-compact.ts` 等纯逻辑里访问 `document`、`window`、`localStorage`（测试跑在 node 环境）。
- 不要在多个文件重复实现时值拍数换算——走 `constants.ts` 与 `spelling.ts`。
- 不要把本地开发用的 MIDI / 工程文件（真实曲子有版权）提交进仓库：`.gitignore` 已排除根目录的样本名与
  `local-samples/`。发布用的克隆必须靠 `npm ci && npm test` 就是绿的，测试里不要 `readFileSync` 仓库外的文件。
- 不要把 `dist/`、`.tmp-profile/`、根目录 `*.log` 提交进仓库（`npm run clean` 清掉它们）。
- 不要动 `dist/`、`node_modules/`、`tmp-profile/`（浏览器 profile 临时目录）。
