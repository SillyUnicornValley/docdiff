# docdiff 总览：目标、路线、设计、状态

> 这是项目的总入口，只做概括和链接。现行规则在 `spec/`，决定索引在 `decisions.md`，给同事看的使用说明在 [user-guide.md](user-guide.md)（英文）。
> **每完成一个阶段或做出新决定，更新本文件的「状态」部分。**
> 最后更新：2026-10-10（v0.5.1）

---

## 1. 产品是什么

在公司 Windows 浏览器里，不用装任何软件，就能对比、合并两版 Word（.docx）文件。

- 像 VS Code 的左右 diff 一样并排看旧版和新版，内容差异高亮。
- 每一处差异选「采用旧版」或「采用新版」（默认新版），最后导出合并好的 Word 文件。
- 所有处理都在浏览器本地完成，文件不离开电脑。可以发布到 Posit Connect，也可以作为单个 HTML 文件离线使用。

**当前范围**：英文 Word 文档的**内容**比较（正文、标题、列表、表格）。格式不比较；Excel 以后再做。详见 [spec/scope.md](spec/scope.md)。

---

## 2. 开发路线

### 2.1 基本功能（已完成）

产品的基本功能按下面的顺序做完，到 v0.5.1 为止已经形成完整的工作闭环：**选两份文件 → 看内容差异 → 逐处选择 → 导出合并后的 Word**。

| 步骤 | 内容 | 版本 | 原阶段编号 |
|---|---|---|---|
| ① 界面原型 | 左右对照、差异卡片、选择按钮、最终结果预览、检查范围面板（用手写 mock 数据） | v0.1.0 | Stage 1 |
| ② Word 内容比较 | 读取 .docx（先接受已有修订）、段落和表格对齐、移动识别、词级高亮；只比较内容，不比较格式 | v0.2.0 | Stage 2 |
| ③ 逐处选择 | 每处差异选旧版或新版；撤销重做、批量操作、保存和恢复进度 | v0.1.0 起，v0.3.0 完善 | Stage 1、3 |
| ④ 合并导出 | 以新版为底稿、只改选了旧版的地方，导出 Clean .docx，导出后自检 | v0.3.0 | Stage 3 |
| ⑤ 扩展检查 | 段内逐处选择；含脚注、链接、图片、公式的旧内容也能采用旧版；Other parts 标签页逐项对比页眉页脚、脚注、批注等（只提示） | v0.5.0 | Stage 5 |

格式检查在 v0.5.0 里试做过，v0.5.1 撤回（决定 47）：内容和格式基本互不相关，放在一起比较页面太拥挤，以后单独做。

> **关于阶段编号**：Stage 1–6 是按开发顺序编的（Stage 4 暂缓，Stage 5 后加）。代码注释、决定记录和 `implementation/` 下的设计文档仍使用这些编号，所以保留；新的讨论按本节的路线说。

### 2.2 下一步：发布前验证 → v1.0

功能已经完成，但还没有在公司环境中试过。下面几项都通过后，版本号改为 v1.0.0，再把工具交给同事使用（决定 48）。

- [ ] 在 Windows Word 中打开导出文件，确认没有「发现无法读取的内容」提示（验收标准 12）
- [ ] 公司 Edge／Chrome 能否双击打开本地 HTML 文件；能否使用 Web Worker（[web-worker-check.md](dev%20guidance/web-worker-check.md)）
- [ ] 通过邮件或 Teams 收到的 HTML 文件是否被拦截
- [ ] 用两三对真实的公司文档完整走一遍：比较、选择、导出、在 Word 中检查

具体步骤见 [dev guidance/release-checklist.md](dev%20guidance/release-checklist.md)。

### 2.3 以后的方向（未排期）

| 方向 | 说明 | 依据 |
|---|---|---|
| 格式比较 | 内容比较、格式比较各出一套结果，用户可以只看内容、只看格式，或同时显示 | 决定 47，[comparison §9](spec/comparison.md) |
| Track Changes 导出 | 导出带修订标记的文件，标出“新版 → 最终版”的变化；导出的修改计划已为它预留 | 决定 39，[export §3](spec/export.md)（原 Stage 4） |
| 其他部分可以选择 | 页眉页脚、脚注文字等现在只提示，以后按需要做成可以采用旧版的差异 | 决定 41 |
| Excel | 单独设计工作表、单元格和记录的匹配规则 | 原 Stage 6 |

---

## 3. 设计（关键原则）

| 原则 | 含义 | 出处 |
|---|---|---|
| 先接受已有修订 | 上传的文件如果带 Track Changes，先按「全部接受」处理，再比较 | [reading](spec/reading.md)，决定 22 |
| 只比较内容 | 字体、加粗、run 拆分（Word 内部的文字切法，见 comparison §1）不同不算差异；上下标、隐藏文字算内容。格式以后单独比较 | [comparison §1、§9](spec/comparison.md)，决定 47 |
| 默认结果 = 新版 | 没有选择的差异按新版处理；全部采用新版时，导出等于接受修订后的新版 | [merge §1](spec/merge.md) |
| 以新版为底稿 | 导出时在新版文件上修改，只改用户选了旧版的地方，其余保持原样 | [export](spec/export.md) |
| 不确定就不做 | 能安全复制进新版的（脚注、超链接、域、图片、公式）才能带回；图表、文本框、嵌入对象、跨段的域和内容控件等不提供「采用旧版」 | [merge §3](spec/merge.md)，决定 43 |
| 看不到的要说出来 | 没有比较的内容放占位符，并在「检查范围」面板列出，不能显示成「无差异」 | [comparison §5](spec/comparison.md) |
| 导出必须自检 | 导出后重新读取文件，与「最终结果」预览逐块核对 | [export §4](spec/export.md)，决定 30 |
| 进度可恢复 | 差异编号按内容生成，同样两份文件再比较，编号不变，进度文件可以恢复 | [ui §4](spec/ui.md) |

每条原则的完整规则在 [spec/](spec/) 下对应的主题文档里；所有决定的索引见 [decisions.md](decisions.md)。

---

## 4. 实现

```
 旧版.docx ─┐                                   ┌─ 用户逐处选择（review）
            ├─ engine/docx ──► DocModel ×2 ──► engine/align + engine/compare ──► DiffResult ──► ui/ 左右对比 + 最终结果预览
 新版.docx ─┘  解析、接受修订      (主线程)         对齐、词级比较 (Web Worker)                       │
                                                                                                    ▼
                                                    engine/export：以新版为底稿套用选择 ──► 合并后.docx ──► 重新读取自检
```

| 层 | 代码 | 设计文档 |
|---|---|---|
| 数据模型（引擎和界面共用的接口） | `src/model/`，核心是 `diff.ts` 的 `DiffResult` | [stage2-design](implementation/stage2-design.md) §2 |
| 解析 .docx | `src/engine/docx/` | [stage2-design](implementation/stage2-design.md) §2 |
| 对齐与比较 | `src/engine/align/`、`src/engine/compare/` | [stage2-design](implementation/stage2-design.md) §3–§4 |
| 导出与自检 | `src/engine/export/` | [stage3-design](implementation/stage3-design.md)、[stage5-design](implementation/stage5-design.md) §3 |
| 其他部分比较 | `src/engine/compare/otherParts.ts` | [stage5-design](implementation/stage5-design.md) §5–§6 |
| 界面 | `src/ui/`（React，长文档用虚拟滚动） | [spec/ui.md](spec/ui.md) |
| 打包 | Vite + singlefile → `dist/index.html` 单文件 | — |

技术栈：TypeScript、React 19、jszip、Vite、vitest。没有后端。每个文件的用途见 [repo-map.md](repo-map.md)。

---

## 5. 状态

### 5.1 验收标准（全文见 [scope §5](spec/scope.md)）

✅ 已满足且有自动测试　⚠️ 部分满足 / 还缺验证　⏸ 暂缓

| # | 验收标准（简写） | 状态 | 依据 |
|---|---|---|---|
| 1 | 只改样式不产生虚假文字修改 | ✅ | `engine.test.ts` 01 formatting-only；`advanced.test.ts` 08 |
| 2 | run 拆分、换行、分页不同不算变化 | ✅ | `engine.test.ts` 01 run-split；`parseDocx.test.ts` 01 |
| 3 | 新增段落后，后续内容仍能对齐 | ✅ | `engine.test.ts` 02、06、07 |
| 4 | 只改一个词或数字时精确高亮（含上下标） | ✅ | `engine.test.ts` 01「12 → 24」、06；`advanced.test.ts` 08 |
| 5 | 表格识别单元格修改、行增删；结构变化时整表选择 | ✅ | `engine.test.ts` 03；`advanced.test.ts` 10 |
| 6 | 已有修订先接受再比较 | ✅ | `parseDocx.test.ts` 04；`engine.test.ts` 04；`advanced.test.ts` 12 |
| 7 | 默认结果 = 新版；全选新版导出 = 新版 | ✅ | `src/testing/invariants.ts`；`export.test.ts` |
| 8 | 选择和撤销只影响选中的部分 | ✅ | `reviewOps.test.ts` |
| 9 | 移动内容合成一处，不重复不丢失 | ✅ | `invariants.ts`；`advanced.test.ts` 13 |
| 10 | 自动编号顺延不算变化（只以 № 提示，决定 38） | ✅ | `engine.test.ts` 02；`parseDocx.test.ts` 02；`hints.test.ts` 02 |
| 11 | 采用旧版不破坏分节、页面设置、书签、批注结构 | ✅ | `export.test.ts`（05、09、书签和批注标记） |
| 12 | Clean 导出无未决修订，保留批注和样式，Word 能正常打开 | ⚠️ | 前两点有测试（`export.test.ts` 04、12），v0.5.0 的 90 个导出文件（18 对 × 5 种选择）通过 XSD 校验；**还没有在 Windows Word 中实际打开过**（§2.2） |
| 13 | Track Changes 导出只反映新版到最终版的差异 | ⏸ | 暂缓（决定 39） |
| 14 | 原始上传文件不变 | ✅ | 按设计成立：浏览器只读上传文件，导出另存新文件 |
| 15 | 没比较的内容有说明和占位 | ✅ | `engine.test.ts` 05 检查范围；`parseDocx.test.ts` 05 |
| 16 | 进度可保存，在同样两份文件上恢复 | ✅ | `reviewOps.test.ts` progress files；`engine.test.ts` 编号稳定 |

### 5.2 已知限制

使用说明 [user-guide.md](user-guide.md) §6 向同事说明了这些限制。

- 格式不比较（决定 47）；标题级别、自动编号的变化只提示，不能选择（决定 37、38）。
- 页眉页脚、脚注文字、批注、文档属性只提示，不能采用旧版，导出保留新版（决定 41、45、46）。
- 修改的段落含脚注、链接等元素时整段替换内容，这段中没变的字也换成旧版的文字格式（决定 43）。
- 带回的列表项找不到相邻列表、旧列表定义在新版中又不存在时，会丢失编号。
- 复制的旧版表格引用了新版没有的表格样式时，只保留直接设置的边框和底纹。
- 表格列或合并单元格结构变化时只能整表选择（决定 6）。

技术层面的限制见 [stage3-design](implementation/stage3-design.md) §9、[stage5-design](implementation/stage5-design.md) §8。

---

## 6. 文档索引

| 想知道 | 看哪里 |
|---|---|
| 怎么使用这个工具（给同事看，英文） | [user-guide.md](user-guide.md) |
| 目标、范围、部署、验收标准 | [spec/scope.md](spec/scope.md) |
| 怎么读取 .docx、已有修订怎么处理、支持哪些文件 | [spec/reading.md](spec/reading.md) |
| 什么算差异、差异怎么切分（G1–G12）、每种 Word 元素的状态 | [spec/comparison.md](spec/comparison.md) |
| 用户怎么选择、什么时候不能采用旧版 | [spec/merge.md](spec/merge.md) |
| 导出的文件怎么改、怎么自检 | [spec/export.md](spec/export.md) |
| 界面怎么呈现、进度怎么保存 | [spec/ui.md](spec/ui.md) |
| 做过哪些决定（按编号） | [decisions.md](decisions.md) |
| 引擎、导出、扩展检查的技术设计 | [implementation/](implementation/)：stage2、stage3、stage5-design |
| 发布前要验证什么、怎么手工测试 | [dev guidance/release-checklist.md](dev%20guidance/release-checklist.md)、[../testdocs/README.md](../testdocs/README.md) |
| 当初为什么这样定（不再维护的原文） | [archive/](archive/README.md) |
| 每个文件是干嘛的 | [repo-map.md](repo-map.md) |
| AI agent 指令怎么管理 | [dev guidance/ruler-workflow.md](dev%20guidance/ruler-workflow.md) |
