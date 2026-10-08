# docdiff 总览：目标、设计、实现、状态

> 这是项目的总入口，只做概括和链接。现行规则在 `spec/`，决定索引在 `decisions.md`。
> **每完成一个阶段或做出新决定，更新本文件的「状态」部分。**
> 最后更新：2026-10-08（v0.3.0）

---

## 1. 目标

在公司 Windows 浏览器里，不用装任何软件，就能对比、合并两版 Word（.docx）文件。

- 像 VS Code 的左右 diff 一样并排看旧版和新版，差异高亮。
- 每一处差异选「采用旧版」或「采用新版」，最后导出合并好的 Word 文件。
- 所有处理都在浏览器本地完成，文件不离开电脑。可以发布到 Posit Connect，也可以作为单个 HTML 文件离线使用。
- 先做英文文档的正文和表格内容比较；格式比较、Excel 以后再做。

详见 [spec/scope.md](spec/scope.md)。

---

## 2. 设计（关键原则）

| 原则 | 含义 | 出处 |
|---|---|---|
| 先接受已有修订 | 上传的文件如果带 Track Changes，先按「全部接受」处理，再比较 | [reading](spec/reading.md)，决定 22 |
| 只比内容，不比格式 | 字体、加粗、run 拆分不同不算差异；上下标、隐藏文字算内容 | [comparison §1](spec/comparison.md) |
| 默认结果 = 新版 | 没有选择的差异按新版处理；全部采用新版时，导出等于接受修订后的新版 | [merge §1](spec/merge.md) |
| 以新版为底稿 | 导出时在新版文件上修改，只改用户选了旧版的地方，其余保持原样 | [export](spec/export.md) |
| 不确定就不做 | 含脚注、图片、超链接、域、跨段内容控件等的差异，不提供「采用旧版」 | [merge §3](spec/merge.md)，决定 15 |
| 看不到的要说出来 | 没有比较的内容放占位符，并在「检查范围」面板列出，不能显示成「无差异」 | [comparison §5](spec/comparison.md) |
| 导出必须自检 | 导出后重新读取文件，与「最终结果」预览逐块核对 | [export §4](spec/export.md)，决定 30 |
| 进度可恢复 | 差异编号按内容生成，同样两份文件再比较，编号不变，进度文件可以恢复 | [ui §4](spec/ui.md) |

每条原则的完整规则在 [spec/](spec/) 下对应的主题文档里；所有决定（第 1–32 条、界面决定 A1–A12）的索引见 [decisions.md](decisions.md)。

---

## 3. 实现

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
| 导出与自检 | `src/engine/export/` | [stage3-design](implementation/stage3-design.md) |
| 界面 | `src/ui/`（React，长文档用虚拟滚动） | [spec/ui.md](spec/ui.md) |
| 打包 | Vite + singlefile → `dist/index.html` 单文件 | — |

每个文件的用途见 [repo-map.md](repo-map.md)。

技术栈：TypeScript、React 19、jszip、Vite、vitest。没有后端。

---

## 4. 状态

### 4.1 阶段

| # | 阶段 | 状态 | 版本 | 文档 |
|---|---|---|---|---|
| 1 | 界面原型（mock 数据） | ✅ 完成 | v0.1.0 | [spec/ui.md](spec/ui.md) |
| 2 | 主体内容比较（解析、对齐、移动识别、词级差异） | ✅ 完成（M1–M6） | v0.2.0 | [stage2-design](implementation/stage2-design.md) |
| 3 | 合并与 Clean 导出（结构保护、撤销、进度、自检） | ✅ 完成 | v0.3.0 | [stage3-design](implementation/stage3-design.md) |
| 4 | Track Changes 导出 | ⬜ 未开始 | — | [export §3](spec/export.md) |
| 5 | 扩展检查（格式、自动编号比较、段内词级选择、批注等） | ⬜ 未开始 | — | [scope §4](spec/scope.md) |
| 6 | Excel | ⬜ 未开始 | — | — |

### 4.2 验收标准（全文见 [scope §5](spec/scope.md)）

✅ 已满足且有自动测试　⚠️ 部分满足 / 还缺验证　⬜ 未做

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
| 10 | 自动编号顺延不算变化 | ✅ | `engine.test.ts` 02；`parseDocx.test.ts` 02 |
| 11 | 采用旧版不破坏分节、页面设置、书签、批注结构 | ✅ | `export.test.ts`（05、09、书签和批注标记） |
| 12 | Clean 导出无未决修订，保留批注和样式，Word 能正常打开 | ⚠️ | 前两点有测试（`export.test.ts` 04、12），64 个导出文件通过 XSD 校验；**还没有在 Windows Word 中实际打开过** |
| 13 | Track Changes 导出只反映新版到最终版的差异 | ⬜ | Stage 4 |
| 14 | 原始上传文件不变 | ✅ | 按设计成立：浏览器只读上传文件，导出另存新文件 |
| 15 | 没比较的内容有说明和占位 | ✅ | `engine.test.ts` 05 检查范围；`parseDocx.test.ts` 05 |
| 16 | 进度可保存，在同样两份文件上恢复 | ✅ | `reviewOps.test.ts` progress files；`engine.test.ts` 编号稳定 |

### 4.3 待办与待讨论（总清单）

**需要在公司环境确认**
- [ ] 在 Windows Word 中打开 08、09、11、12 的「全部采用旧版」导出，确认没有「发现无法读取的内容」提示（[stage3-design](implementation/stage3-design.md) §8，[prototype-test-guide](dev%20guidance/prototype-test-guide.md)）
- [ ] 公司浏览器是否允许 Web Worker（不允许时会自动退回主线程，但长文档可能卡顿）（[scope §3.3](spec/scope.md)）
- [ ] Posit Connect 的部署条件（[scope §3.3](spec/scope.md)）

**需要和用户讨论**
- [ ] 差异颗粒度 G1–G12：差异切得太碎还是太粗（[comparison §2.2](spec/comparison.md)）。建议先用真实文档试完整流程，再讨论

**已知限制**（[stage3-design](implementation/stage3-design.md) §9）
- 段内只能整段取舍（G6），以后做段内词级选择
- 带回的列表项找不到相邻列表、旧列表定义在新版中又不存在时，会丢失编号
- 复制的旧版表格引用了新版没有的表格样式时，只保留直接设置的边框和底纹

**后续阶段**
- [ ] Stage 4：Track Changes 导出
- [ ] Stage 5：格式检查、自动编号比较、未比较元素逐项比较、带回含脚注等元素的旧版内容、段内词级选择、批注处理
- [ ] Stage 6：Excel

**仓库整理**
- [ ] `tsconfig.tsbuildinfo` 是本机编译缓存，应该加进 `.gitignore` 并从 git 移除
- [ ] 确认 `testdocs/docs/real examples/` 里的公司文档可以留在 repo 中

---

## 5. 文档索引

| 想知道 | 看哪里 |
|---|---|
| 目标、范围、部署、验收标准 | [spec/scope.md](spec/scope.md) |
| 怎么读取 .docx、已有修订怎么处理 | [spec/reading.md](spec/reading.md) |
| 什么算差异、差异怎么切分（含待讨论的 G1–G12） | [spec/comparison.md](spec/comparison.md) |
| 用户怎么选择、什么时候不能采用旧版 | [spec/merge.md](spec/merge.md) |
| 导出的文件怎么改、怎么自检 | [spec/export.md](spec/export.md) |
| 界面怎么呈现、进度怎么保存 | [spec/ui.md](spec/ui.md) |
| 做过哪些决定（按编号） | [decisions.md](decisions.md) |
| 支持哪些文件、哪些修订类型 | [spec/reading.md](spec/reading.md) §1、§4 |
| 每种 Word 元素是比较、只检测还是只显示 | [spec/comparison.md](spec/comparison.md) §8 |
| 引擎的技术设计 | [implementation/stage2-design.md](implementation/stage2-design.md) |
| 导出的技术设计与测试 | [implementation/stage3-design.md](implementation/stage3-design.md) |
| 当初为什么这样定（不再维护的原文） | [archive/](archive/README.md) |
| 怎么手工测试 | [dev guidance/prototype-test-guide.md](dev%20guidance/prototype-test-guide.md)、[../testdocs/README.md](../testdocs/README.md) |
| 每个文件是干嘛的 | [repo-map.md](repo-map.md) |
| AI agent 指令怎么管理 | [dev guidance/ruler-workflow.md](dev%20guidance/ruler-workflow.md) |
