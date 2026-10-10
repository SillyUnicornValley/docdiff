# 决定记录

> 每条决定一行：结论 + 写进了哪份文档。现行规则以 `spec/` 下的主题文档为准；本文件只记录“什么时候、决定了什么”。
> 编号固定不变，代码注释里的 “decision N” 指这里的第 N 条，“A1–A12” 指 §2。
> 新决定：加在表尾，同时修改对应的主题文档。

## 1. 产品与实现决定

| # | 日期 | 问题 | 决定 | 写进 |
|---|---|---|---|---|
| 1 | 10-07 | 差异粒度 | 首版段落级（含表格行、单元格），预留段内词级选择 | [comparison §2](spec/comparison.md) |
| 2 | 10-07 | 处理状态与进度 | “未处理／采用旧版／采用新版”三态；导出不强制处理完，但提示数量 | [merge §2](spec/merge.md) |
| 3 | 10-07 | 视图 | 左右固定显示原始旧版和新版，另设最终结果预览 | [ui §3](spec/ui.md) |
| 4 | 10-07 | 上下标 | 算内容 | [comparison §1](spec/comparison.md) |
| 5 | 10-07 | 含脚注、图片、超链接、域的片段 | 首版禁止采用旧版，并说明原因；纯文字片段照常可选 | [merge §3](spec/merge.md) |
| 6 | 10-07 | 表格列、合并单元格结构变化 | 首版整表二选一；单元格文字、行增删仍可单独选择 | [comparison §4](spec/comparison.md) |
| 7 | 10-07 | 移动内容 | 识别并合成一个差异，标“已移动”；一次选择：放回原位置（旧版）或留在新位置（新版） | [comparison §3](spec/comparison.md) |
| 8 | 10-07 | 批注锚点 | 产品层面暂不处理，以后再考虑；实现上保证批注标记不被拆散，导出文件有效 | [export §2.4](spec/export.md) |
| 9 | 10-07 | 文本规范化 | 空白、引号、短横线、大小写等差异默认都显示，每类都可单独隐藏 | [comparison §7](spec/comparison.md) |
| 10 | 10-07 | 自动编号、目录、域 | 做成“是否比较”的独立开关；只提示，不可选择；首版不实现编号比较，目录默认折叠 | [comparison §6](spec/comparison.md) |
| 11 | 10-07 | 隐藏文字 | 显示（虚线标注）并比较 | [comparison §1](spec/comparison.md) |
| 12 | 10-07 | 保存审阅进度 | 首版就做：导出进度文件，重新上传同样两份文件后可恢复 | [ui §4](spec/ui.md) |
| 13 | 10-07 | 工具内编辑文字 | 首版不做 | [ui §3](spec/ui.md) |
| — | 10-07 | 结构载体（分节、书签、域边界） | 不随片段删除；对用户的可见影响仅为个别片段“采用旧版”不可用并说明原因。具体规则见 27、28 | [export §2.4](spec/export.md) |
| — | 10-07 | 导出 | 首版只做 Clean；数据结构为以后的 Track Changes 导出预留 | [export §3](spec/export.md) |
| — | 10-07 | 技术形态 | 纯浏览器端；可发布到 Posit Connect，也可离线单文件使用；TypeScript + Vite + React | [scope §3](spec/scope.md) |
| 14 | 10-07 | 差异粒度（原型后修订） | 每对修改的段落各为一个差异；连续新增、连续删除的段落仍各合成一个差异（A2） | [comparison §2](spec/comparison.md) |
| 15 | 10-07 | “采用旧版”不可用的判断 | 旧版或新版任一侧含脚注、图片、超链接、域等，都禁止采用旧版（A3） | [merge §3](spec/merge.md) |
| 16 | 10-07 | 浏览器本地自动保存 | 每次选择后自动保存，再次打开同样两份文件时询问是否恢复；进度文件仍为正式保存手段（A11） | [ui §4](spec/ui.md) |
| 17 | 10-07 | 页眉页脚 | 按节、按首页／奇偶页逐个做指纹比较；检查范围面板按节列出；有差异的节在内容视图中标记 | [comparison §5](spec/comparison.md) |
| 18 | 10-07 | 原型界面问题 A1、A4–A9 | 见 §2 | [ui](spec/ui.md) |
| 19 | 10-07 | 新版批注位置（A10） | 内容视图中显示新版批注位置标记，只提示、不比较；旧版批注不显示 | [comparison §5](spec/comparison.md) |
| 20 | 10-07 | 非“旧→新”的对比场景（如两家供应商的合同） | 暂不支持，沿用 old / new。以后如要做，把“左右（A/B）”和“导出底稿”拆开：用中性标签（Only in A / Only in B），底稿可选 | [scope §2](spec/scope.md) |
| 21 | 10-07 | 原型做法 | 全部确认。保留 “Mark unreviewed”；空白符号只在差异处显示；表格结构变化时整表取舍 | [ui §3](spec/ui.md)、[merge §2](spec/merge.md) |
| 22 | 10-07 | .docx 读写方案 | JSZip + 浏览器 `DOMParser`／`XMLSerializer` 自行解析，不用封装库；主线程解析和写回 XML，Worker 只做对齐和比较；已有修订在 XML 副本上真正执行“接受全部”，比较和导出用同一棵 XML；未修改的部件按原字节复制 | [reading §2](spec/reading.md)、[stage2-design](implementation/stage2-design.md) |
| 23 | 10-07 | 技术方案与手打编号 | 技术细节由开发方决定。手打编号改为显示相同的自动编号：仍显示为差异，归入可隐藏的新类别 “Numbering text” | [comparison §7](spec/comparison.md) |
| 24 | 10-08 | 修改的段落采用旧版 | 在新版段落上原地改文字，保留段落属性、编号和未改动文字的格式 | [export §2.1](spec/export.md) |
| 25 | 10-08 | 单独带回的旧段落 | 样式按名字映射；列表挂到相邻列表；只带回简单强调格式 | [export §2.2](spec/export.md) |
| 26 | 10-08 | 带回的表格和表格行 | 保留旧版表格布局；不带回旧版的书签、批注、分节、修订 | [export §2.3](spec/export.md) |
| 27 | 10-08 | 删去带分节符的内容 | 分节设置移到本节最后保留段落；最后一节删空时取前一节的页面设置 | [export §2.4](spec/export.md) |
| 28 | 10-08 | 删去的内容中的书签和批注 | 移到最近的保留段落，保持顺序；批注范围只缩小不丢失 | [export §2.4](spec/export.md) |
| 29 | 10-08 | Clean 的范围 | 正文以外的已有修订也全部接受；设置“打开时更新域”；其他部件原样复制 | [export §1](spec/export.md) |
| 30 | 10-08 | 自检不一致时 | 先不下载，列出不一致之处，由用户选择 “Download anyway” 或取消 | [export §4](spec/export.md) |
| 31 | 10-08 | 导出界面 | 沿用原型的导出对话框；Tracked changes 仍为以后的版本；`?mock` 下导出仍是模拟 | [export §5](spec/export.md) |
| 32 | 10-08 | 引擎调整（engine-4） | ① 短段落文字在两份文件中都只出现一次时也可认作移动；② 表格行第一格相同（且含字母）时配成同一行 | [comparison §2.2](spec/comparison.md) G9、G10 |
| 33 | 10-08 | 是否读取 .doc（Word 97–2003） | 不读取；提示用户在 Word 中另存为 .docx 后上传 | [reading §1](spec/reading.md)、[scope §2](spec/scope.md) |
| 34 | 10-09 | 修订类型的“不支持”怎么定 | 全部接受；只有单元格修订提示“结果可能不准确”，表格属性、分节设置修订改为支持 | [reading §4](spec/reading.md) |
| 35 | 10-09 | 段落作为选择单位是否太大 | 维持段落，一段内多处修改整段取舍；段内展开以后再考虑 | [comparison §2.2](spec/comparison.md) G6 |
| 36 | 10-09 | 差异切分规则 G1–G5、G7–G12 | 试用示例 01、02、03、06、10、12、13 后按现行做法全部确认 | [comparison §2.2](spec/comparison.md) |
| 37 | 10-09 | 标题级别变化、移动时改了文字，要不要提示 | 都要醒目提示：标题级别变化只提示、不能选择；移动且改了文字时卡片标注 “Moved and text changed” | [comparison §1、§3](spec/comparison.md)、[ui §3](spec/ui.md) |
| 38 | 10-09 | 自动编号不同要不要显示 | 显示：编号旁标 “№ 旧 → 新”，默认开、可在 View 关闭；只提示，不能选择 | [comparison §6](spec/comparison.md)、[ui §3](spec/ui.md) |
| 39 | 10-09 | 下一步是否做 Track Changes 导出（Stage 4） | 暂缓；修改计划仍为它预留，以后需要时再做 | [export §1、§3](spec/export.md)、[scope §2](spec/scope.md) |
| 40 | 10-09 | 说明文字放在哪里 | 主页面只放短标签（“是什么”），“为什么、怎么办”放进浮窗：标签旁加 ⓘ，鼠标移上去立即出现，键盘聚焦或点击也能打开。影响结果正确性的警告仍在页面上保留短句。按钮的快捷键提示仍用浏览器自带提示 | [ui §3](spec/ui.md) |
| 41 | 10-10 | Stage 5 的范围和顺序（用户授权开发方先行决定） | 五项都做：段内逐处选择、带回含脚注等元素的旧内容可以选择；格式、其他部分、批注只提示、不能选择，导出保留新版。版本 v0.5.0，引擎 engine-5。格式检查后被决定 47 撤回 | [stage5-design](implementation/stage5-design.md) §1、[scope §4](spec/scope.md) |
| 42 | 10-10 | 段内逐处选择（G6 的段内展开） | 一对一的修改段落、有 2 处以上词级变化时，可展开 “Choose per change” 逐处选 Old / New；状态 “Mixed”；整段按钮照旧；进度文件 formatVersion 2 | [comparison §2.2](spec/comparison.md) G6、[merge §2](spec/merge.md) |
| 43 | 10-10 | 含脚注、超链接、域、图片、公式的旧内容能否带回 | 能：复制链接地址、图片、脚注（尾注）进新版；修改段落含这些元素时整段替换内容（保留段落属性和新版标记）。仍不可用：图表、形状、SmartArt、文本框、嵌入对象、链接的图片、引用新版中不存在书签的交叉引用、新版没有脚注（尾注）部件；只看旧版一侧。自检加比脚注文字、图片、链接地址 | [merge §3](spec/merge.md)、[export §2.5、§4](spec/export.md) |
| 44 | 10-10 | 格式检查（**已撤回，见决定 47**） | 比较配对段落和表格的段落样式、对齐、缩进、间距、列表类型、文字格式（加粗、斜体、下划线、删除线、大写、字体、字号、颜色、突出显示）、表格样式；按生效格式比较；Formatting 标签页列出，正文标 “Aa”；只提示，导出保留新版格式；标题级别变化的段落不列入（⚑ 已提示） | [comparison §1、§9](spec/comparison.md)、[ui §3](spec/ui.md) |
| 45 | 10-10 | 原来“只检测”的部分 | 新增 Other parts 标签页逐项比较：脚注、尾注、页眉页脚（按节）、文本框、超链接地址、图片、文档属性；只提示，导出保留新版 | [comparison §5、§8](spec/comparison.md)、[ui §3](spec/ui.md) |
| 46 | 10-10 | 批注处理 | 旧版批注也显示（灰色 “Old comment”）；Other parts › Comments 逐条比较（相同、批注文字改了、锚定文字改了、只在一边）；导出仍只保留新版批注、不带入旧版批注；导出前提示有几处 Use old 的内容挂着新版批注 | [comparison §5](spec/comparison.md)、[export §1](spec/export.md) |
| 47 | 10-10 | 格式检查是否留在 Stage 5 | 撤回决定 44，删除格式检查：Formatting 标签页恢复为 “not checked”，正文不再显示 “Aa”，View 菜单去掉对应开关。原因：用户本来打算格式检查以后单独做；内容和格式基本互不相关，一起显示会让比较页面太拥挤。以后的设想：内容比较、格式比较各出一套结果，用户可选只看内容、只看格式，或者两者同时显示（同时显示也要提供）。到时再单独讨论。已删除的实现见 stage5-design §4，留作参考。版本 v0.5.1 | [comparison §1、§9](spec/comparison.md)、[ui §3](spec/ui.md)、[stage5-design](implementation/stage5-design.md) §4 |

## 2. 界面决定 A1–A12（原型阶段，2026-10-07）

| # | 问题 | 决定 | 写进 |
|---|---|---|---|
| A1 | 最终结果预览：切换视图还是第三栏 | 两种都保留（Third column / Preview only） | [ui §3](spec/ui.md) |
| A2 | 连续变化的段落是否合成一个差异 | 每对修改的段落各为一个差异；连续新增、连续删除的段落仍合并（= 决定 14） | [comparison §2](spec/comparison.md) |
| A3 | “采用旧版”不可用的判断范围 | 旧版或新版任一侧含脚注、图片、超链接、域，就禁用（= 决定 15） | [merge §3](spec/merge.md) |
| A4 | 未处理差异如何显示 | 两侧都不淡化，卡片用虚线框；明确选择后才淡化放弃的一侧 | [ui §3](spec/ui.md) |
| A5 | 选择按钮的位置 | 两栏中间的窄栏；表格行内用单行按钮；手机上移到两栏上方 | [ui §3](spec/ui.md) |
| A6 | 隐藏某类差异 | 差异中所有词级变化都属于被隐藏类别时才整体隐藏，否则只去掉对应高亮 | [comparison §7](spec/comparison.md) |
| A7 | 进度分母 | 包含被隐藏的差异，并显示 “· N hidden”；导航只算可见差异 | [merge §2](spec/merge.md) |
| A8 | 编号 | 可选择的差异 #1…#N，仅提示的差异 #i1、#i2 | [merge §2](spec/merge.md) |
| A9 | 批量操作“本节” | Batch 菜单中用下拉框选节，默认当前差异所在的节，显示每节的差异数和未处理数 | [ui §3](spec/ui.md) |
| A10 | 新版批注的位置 | 正文中显示 “Comment · 作者” 标记；含新版批注的差异卡片注明 “Has a new-file comment”；旧版批注不显示（= 决定 19） | [ui §3](spec/ui.md) |
| A11 | 浏览器本地自动保存进度 | 每次选择后自动保存；再次打开时询问 “Restore your previous choices?”（= 决定 16） | [ui §4](spec/ui.md) |
| A12 | 页眉页脚不一致如何提示 | 按节、按首页／奇偶页逐个提示；正文中标 “§ Section n”；各节相同不标（= 决定 17） | [comparison §5](spec/comparison.md) |

## 3. 待决定

（暂无）
