# 界面原型测试指南

- 版本：v0.3.0（Stage 3：真实比较 + Clean 导出）
- 日期：2026-10-08
- 目的：点一遍工具，判断布局、交互和导出结果是否合适。选择的文件和首页的示例对（testdocs 01–15）都会真实读取和比较；Export 会生成真实的 .docx（§5）。原型阶段手写的 mock 示例仍可在网址后加 `?mock` 打开（此时导出是模拟的）。
- 注意：用真实引擎后，部分差异的编号和数量会与下文按 mock 写的步骤略有不同。
- 发现的问题和想法请直接告诉我；界面规则见 `docs/spec/ui.md`，决定记录见 `docs/decisions.md`。

## 1. 打开原型

**方式零：claude.ai Artifacts（手机也可以看）**：https://claude.ai/artifact/4bAK3f1LjdBEzzs49wVifg 。在这里 Save progress 和 Export 下载文件前会先弹出确认框（Artifacts 的下载许可），其余功能相同。


**方式一：直接双击（推荐，也是将来离线使用的形态）**

- 打开 `dist/index.html`。这是一个自包含的单文件，可以离线使用，也可以发布到 Posit Connect。
- 如果 `dist/` 不存在或代码有更新，先在项目目录运行：

```bash
npm install
```

```bash
npm run build
```

**方式二：开发服务器**

```bash
npm run dev
```

然后在浏览器打开它显示的地址（一般是 `http://localhost:5173`）。

**建议的浏览器窗口宽度**：1400 像素以上，以便同时看左右两栏和中间的选择栏。

**公司电脑检查**：把 `dist/index.html` 拷到公司 Windows 电脑上，用 Edge 和 Chrome 双击打开，确认页面能正常显示和操作。这一步顺带验证spec/scope §3.3 的环境问题。

## 2. 选择文件页

| # | 操作 | 应该看到 |
|---|---|---|
| 1.1 | 打开页面 | 左上角显示 `docdiff v0.1.0 · prototype · built 日期` |
| 1.2 | 在 Old、New 两个区域分别选择 `testdocs/docs/01-basic-text_old.docx`、`01-basic-text_new.docx`（也可拖放） | 两个区域显示文件名和大小，变为红色和绿色 |
| 1.3 | 选择一个 `.doc` 文件（任意改名的文件即可） | 红框，提示 “Word 97–2003 (.doc) files are not supported…”；Compare 按钮不可用 |
| 1.4 | 点中间的 ⇄ Swap | 左右文件互换 |
| 1.5 | 阅读蓝色说明框 | 写明“按接受全部已有修订后的状态比较，原文件不变”，以及新版未决修订在导出时会被接受 |
| 1.6 | 点 Compare，或点下方任一 Sample pair | 出现 “Comparing…” 进度窗，依次显示四个步骤，然后进入比较页 |

说明：v0.2.0 起选择的文件按真实内容比较；网址加 `?mock` 时，首页示例对载入原型的 mock 数据。

## 3. 比较页：按测试文档逐项检查

### 3.1 样例 01 · Basic text

| # | 检查 | 应该看到 |
|---|---|---|
| 01.1 | 左右两栏 | 左为旧版，右为新版；标题、正文使用统一阅读样式 |
| 01.2 | 差异 #1–#3 | #1 `12`→`24` 只高亮这两个数字；#2 改写句中只高亮改动的词；#3 标题 “and Duration” 高亮。三处可以分别选择 |
| 01.3 | 新增段 “Randomization…” | 左侧为斜纹空白，写 “not in old”；其后的相同段落仍左右对齐 |
| 01.4 | 删除段 “An interim analysis…” | 单独一个差异 #6（Deleted），右侧为斜纹空白 |
| 01.5 | “24 hours” 加粗变红那段，以及 run 拆分那段 | **无**差异标记 |
| 01.6 | “Safety Monitoring” | 左边是二级标题，右边是三级标题，各按自己的层级显示，**不**算差异 |
| 01.7 | 在差异 #1 点 **Use old** | 卡片显示 “✓ Using old”；右侧淡化并标 “NOT USED”；左侧标 “✓ USED”；顶部进度变为 “Reviewed 1 / 6” |
| 01.8 | 点 Undo，再点 Redo | 选择被撤销、恢复；按钮悬停时显示要撤销的是哪一步 |

### 3.2 样例 02 · Lists

| # | 检查 | 应该看到 |
|---|---|---|
| 02.1 | 纳入标准中新增第 2 条 | 只有这一条标为 Inserted；后面条目的编号从 2、3、4 变成 3、4、5，但**不**标为修改 |
| 02.2 | `40`→`35` | 只高亮数字 |
| 02.3 | “Known hypersensitivity…” | 显示为 **Moved**（蓝色、⇄）：新位置在列表开头，原位置在列表末尾 |
| 02.4 | 在移动差异上点 “go to original ↑” 或 “go to new ↓” | 跳到另一处 |
| 02.5 | 在一处点 Use old | 两处同时显示 “Using old”（一个差异，一次选择） |
| 02.6 | 二级条目 `effective`→`highly effective` | 保持缩进和 `a)` 编号，只高亮 “highly” |
| 02.7 | 禁用药物列表 | 左边是项目符号，右边是数字编号，这三条**不**算差异；只报新增的 “St. John's Wort” 和新增章节 |
| 02.8 | Study Procedures | 手打的 `1) ` 消失，显示为修改；右侧自动编号为 6、7、8（新版故意续接列表 1） |

### 3.3 样例 03 · Tables

| # | 检查 | 应该看到 |
|---|---|---|
| 03.1 | Dose 表 | 表格按行对齐：`1b` 行和 `5` 行为新增行，`3` 行为删除行，另一侧有斜纹空白；`12`→`18` 为单元格修改。每行差异的按钮是单行紧凑的 `Old` / `New` |
| 03.2 | Schedule 表（新增一列） | 整张表是一个差异 “Table structure”，说明 “v1 offers a whole-table choice only”；`Week 4` 和 `24` 高亮 |
| 03.3 | Lab 表（合并单元格） | “Hematology”、“Chemistry” 纵向合并显示；同样是整表差异；`Neutrophils`、单位、横跨三列的备注行高亮 |
| 03.4 | Study Contacts（段落→表格）、Abbreviations（表格→段落） | 各为一个 “Replaced” 差异，整块二选一 |
| 03.5 | Nested Table | 外层表格中嵌套的内层表格里，`3`→`5` 单独作为一个差异 |
| 03.6 | Final result: **Third column** | 第三栏按当前选择显示最终结果。对删除的 `3` 行点 Old，该行在第三栏中以琥珀色出现；对 `12`→`18` 点 Old，第三栏该单元格显示 `12` 并标 “FROM OLD” |

### 3.4 样例 05 · Not-compared elements

| # | 检查 | 应该看到 |
|---|---|---|
| 05.1 | 顶部说明栏 | 写有已有修订的说明；有 “⚠ 1 unsupported revision type(s)” 和 “6 not-compared part(s) may differ” 两个链接 |
| 05.1b | Treatment 一节 | 新版中 `24 weeks` 前、titration 段开头、新增段 “Missed doses…” 开头各有一个黄色 “Comment · Bob” 标记；titration 段**不**算差异；#1 和 #2 的卡片注明 “Has a new-file comment” |
| 05.2 | Version date | 日期显示为灰底域，带 “FIELD” 小标；默认**不**算差异 |
| 05.3 | 目录 | 折叠显示 “Table of contents · 3 / 4 entries · not compared”，可点开查看 |
| 05.4 | View → 勾选 Compare table of contents、Compare date, page and other fields | 目录和日期显示为差异 #i1、#i2，有高亮，但卡片写 “Info only · not choosable”，没有选择按钮，也不计入进度 |
| 05.5 | 脚注 | 正文中显示 `[Footnote 1 · text not compared]`，带黄色 “may differ” 标记（脚注内容在两版中不同） |
| 05.6 | 新增脚注引用的段落（#3） | “Use old” 按钮不可用，并写明原因 “footnote reference”；悬停可看完整说明 |
| 05.7 | 交叉引用段落（#6） | “Use old” 不可用，原因为 field |
| 05.8 | 图片 | 显示 `[Picture 1 · not compared]`，带 “may differ” |
| 05.9 | 隐藏文字 “INTERNAL NOTE…” | 紫色虚线下划线，并作为新增内容高亮 |
| 05.10 | 新增附录 | “End of main protocol.” 段下方标有 “Section break” |
| 05.11 | 文档开头 | 左右各有一条 “§ Section 1 · Header · may differ · Footer · same” 标记 |
| 05.12 | 新增附录前的 “Section break” 处 | 右侧标 “§ Section 2 · Header · section not in old · Footer · section not in old” |
| 05.13 | 点 **Check scope** | 右侧面板依次列出：不支持的修订（Section and page setup change）；Formatting: Not checked；“Headers and footers by section” 表格（第 1 节页眉 May differ、页脚 Same，第 2 节 Section only in new）；脚注、图片、超链接地址 “May differ”；文档属性 “Same”；各类元素的两版数量 |

### 3.5 样例 06 · Alignment edge cases

| # | 检查 | 应该看到 |
|---|---|---|
| 06.1 | 删除 Pharmacogenomics | 删除的是该标题**及其下面那一段** “Not applicable.”，其他小节仍正确对齐 |
| 06.2 | 拆段 | 一个 “Split / joined” 差异，右侧拆开处显示 `¶` |
| 06.3 | 合段 | 同样是一个差异，左侧第一段末尾显示 `¶` |
| 06.4 | 空段落 | 显示为 “¶ empty paragraph”，差异卡片标 “Empty paragraphs” 类别 |
| 06.5 | “Protocol deviations…” | 移动差异：原位置在 Visits 开头，新位置在末尾 |
| 06.6 | Typography（#7–#11） | 每段一个差异：直引号→弯引号、`-`→`–`、双空格→单空格、空格→不换行空格（显示为 `°`）、`Week`→`week`。都有高亮和虚线框，卡片上标出类别 |
| 06.7 | View → 取消勾选 Whitespace、Quote style、Dash style、Letter case | #7–#11 和软回车那一处（#14）都隐藏，顶部显示 “· 6 hidden”；上标变化（#12、#13）仍显示 |
| 06.8 | 上标 `10⁶`→`10⁵`、`kg/m²`→`kg/m2` | 作为内容差异高亮，不属于任何可隐藏类别 |
| 06.9 | Rewrites | 完全改写的句子整句高亮，不做零碎拼接；约 120 词的长段只高亮 `5`→`10` |

### 3.6 Large · ~200 pages（性能）

| # | 检查 | 应该看到 |
|---|---|---|
| L.1 | 打开 | 约 1 秒内进入比较页 |
| L.2 | 快速拖动滚动条，从头滚到尾 | 不卡顿，内容随即出现，左右始终对齐 |
| L.3 | 反复按 `J`（下一处） | 每次跳到下一个差异并居中，共 75 处 |
| L.4 | View → Collapse unchanged content | 大段相同内容折叠为 “⋯ N unchanged blocks hidden · Show”，每处差异前后各保留 2 段 |
| L.5 | View → Differences only | 只剩差异和折叠条；点折叠条可展开 |
| L.6 | Batch → All unreviewed → Use new | 进度变为 75 / 75；按一次 Undo 全部撤销 |

## 4. 通用功能

| # | 操作 | 应该看到 |
|---|---|---|
| G.1 | 导航按钮 ↑ Prev、↓ Next、⇣ Next unreviewed | 跳到上一处、下一处、下一处未处理；工具栏显示 “Difference a of b” |
| G.2 | 快捷键 `J`/`K`/`U`/`1`/`2`/`Ctrl+Z`/`Ctrl+Shift+Z` | 同上；`1` 和 `2` 对当前差异采用旧版、新版 |
| G.3 | Batch → 下拉框选一节 → All in this section → Use old | 下拉框默认是当前差异所在的节，并显示每节的差异数、未处理数；所选节的差异全部采用旧版，不可采用旧版的被跳过并提示数量 |
| G.4 | View → 取消 Sync scroll | 两栏各自滚动、不插空白；差异按钮出现在内容上方。重新勾选后回到对齐视图，位置大致保持 |
| G.5 | Final result: **Preview only** | 单栏显示最终文档；左侧标出每处差异的编号及选择；采用旧版的内容为琥珀色并标 “FROM OLD”；点左侧编号回到对照视图中的该差异 |
| G.6 | Formatting 标签 | 只显示说明 “Formatting: not checked”，不会出现“无格式差异” |
| G.7 | Progress → Save progress… | 下载一个 `…_review_YYYYMMDD.json` |
| G.8 | 刷新页面，打开同一个样例，Progress → Load progress… 选择刚才的文件 | 所有选择恢复 |
| G.8b | 做几处选择后刷新页面，再打开同一个样例 | 弹出 “Restore your previous choices?”，可选 Restore 或 Start fresh（浏览器本地自动保存） |
| G.9 | 打开另一个样例，载入 G.7 的文件 | 拒绝载入，红色提示说明是哪份文件不一致 |
| G.10 | 做了选择但没有保存，关闭或刷新页面 | 浏览器弹出“离开此页？”提示 |
| G.11 | 有选择时点 Change files，再换文件、交换或打开另一个样例 | 先弹出确认框，说明会清空几处选择 |
| G.12 | 点 Export… | 显示 Clean（可选）和 Tracked changes（灰色，以后提供）；未处理数量；新版有未决修订时显示 “N pending tracked change(s) … will be accepted”；文件名为 `<新版名>_merged_YYYYMMDD.docx`。真实导出的步骤见 §5 |

## 5. 导出（Stage 3）

| # | 操作 | 期望结果 |
|---|---|---|
| H.1 | 打开 05，所有可选的差异都点 Use old，Export… → Export | 按钮显示 “Writing and checking…”，随后下载 `05-uncompared-and-comments_new_merged_YYYYMMDD.docx`，提示 “Self-check passed” |
| H.2 | 用 Word 打开 H.1 的文件 | 没有“无法读取的内容”提示；Word 询问是否更新域；全文只有一节、**纵向**（附录被撤回，不会变成全文横向）；新版的三条批注都还在（锚点移到相邻段落）；旧版 Carol 的批注不在 |
| H.3 | 打开 08，全部 Use old 后导出，用 Word 打开 | “10 business days” 带下划线且仍在批注范围内；“15–25 °C” 加粗红色；m² 的 2 是上标；隐藏文字 DRAFT 恢复（显示隐藏文字时可见）；恢复的 “Retention Period” 是二级标题样式；“Record every dose.” 是圆点列表的一项；“Note:” 段落为正文样式、“Note:” 加粗 |
| H.4 | 打开 09，只对 “Appendix B …” 那处差异点 Use old，导出并用 Word 打开 | 附录 B 消失；文档最后一节沿用前一节（横向日程表）的页面设置，页眉页脚正常 |
| H.5 | 打开 12，不做任何选择直接导出，用 Word 打开 | 审阅窗格中没有任何修订（正文、页眉、表格中的修订都已接受）；Dan、Erin 的批注都在 |
| H.6 | 打开 15，随意选择十几处 Use old，导出并用 Word 打开 | 文件正常打开；选择 Use old 的地方是旧版内容；页眉页脚、横向附录、图片、脚注正常 |
| H.7 | 打开任一样例，做选择后导出两次 | 两次都成功，内容相同（导出不改动已打开的文件，可以反复导出） |

请特别留意：Word 打开时有没有修复提示；带回的段落的样式、列表编号是否合理；批注和书签位置是否可以接受。

## 6. 请重点给意见的地方

1. 最终结果预览：第三栏和单栏切换，哪种更好用？（A1）
2. 01 中三处改动合为一个差异，粒度是否可以接受？（A2）
3. 中间选择栏的位置、大小、文字是否清楚？表格行内的单行按钮是否够用？（A5）
4. 颜色、符号、删除线或下划线是否足以区分旧版、新版和移动？
5. 05 的占位符、“may differ” 标记和检查范围面板，能否避免把“未比较”误读为“无差异”？
