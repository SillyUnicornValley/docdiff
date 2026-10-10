# Repo 地图：每个文件夹和根目录文件是干嘛的

> 写于 2026-10-08（v0.3.0），2026-10-10（v0.5.1）更新。用来在一段时间没看 repo 后快速找回方向。
> 标记：**[提交]** = 在 git 里；**[忽略]** = 被 `.gitignore` 排除，只在本机；**[生成]** = 由脚本生成，不要手改。

## 一眼看全貌

```
docdiff/
├── src/            应用源码（React UI + 解析/比较/导出引擎）
├── docs/           项目文档（中文）
├── testdocs/       测试用 .docx 文档对 + 生成脚本
├── scripts/        构建/维护脚本
├── dist/           构建产物 [忽略]
├── node_modules/   npm 依赖 [忽略]
├── .ruler/         AI agent 指令的唯一源头
├── .claude/ .kiro/ .agents/   各 AI agent 的生成配置 [生成]
└── 根目录配置文件（见下）
```

数据流：用户选两个 .docx → `engine/docx` 解析成 `DocModel` → `engine/align` + `engine/compare` 生成 `DiffResult` → `ui/` 展示、用户逐条选择 → `engine/export` 写出合并后的 .docx 并自检。

---

## 根目录文件

| 文件 | 作用 |
|---|---|
| `package.json` | 项目名、版本号（**版本号的唯一来源**，构建时注入页面）、npm 脚本（dev / build / test / typecheck / build:artifact）、依赖。运行时依赖只有 React、jszip（读写 .docx 压缩包）、@tanstack/react-virtual（长文档虚拟滚动）。 |
| `package-lock.json` | npm 锁定的精确依赖版本，`npm install` 自动维护，不用手改。 |
| `index.html` | Vite 的页面入口，只有一个 `<div id="root">` 和加载 `src/main.tsx` 的 script。 |
| `vite.config.ts` | Vite 配置：React 插件 + `vite-plugin-singlefile`（把整个应用打成**单个 HTML 文件**，可离线用/发到 Posit Connect）；注入 `__APP_VERSION__`、`__BUILD_DATE__`；vitest 只扫 `src/**/*.test.ts`（避免扫 agent 文件夹卡住）。 |
| `tsconfig.json` | TypeScript 编译选项（严格模式、只做类型检查不输出）。 |
| `tsconfig.tsbuildinfo` | `tsc -b` 的增量编译缓存。**[忽略]** |
| `.gitignore` | 忽略 `node_modules/`、`dist/`、`.DS_Store`、`*.local`、`tsconfig.tsbuildinfo`。 |
| `CLAUDE.md` | 给 Claude Code 的项目说明。**[生成]** 自 `.ruler/AGENTS.md`，不要直接改。 |
| `AGENTS.md` | 同一份说明，给 Codex 等通用 agent 读。**[生成]** |
| `skills-lock.json` | 用 `npx skills` 装的第三方 skill 清单（目前只有 `archify`，画架构图用），`apply-ruler.sh` 据此跳过它们。 |
| `.DS_Store` | macOS Finder 自动生成的文件。**[忽略]** 无用。 |

---

## `src/` —— 应用源码

| 路径 | 作用 |
|---|---|
| `main.tsx` | React 启动入口：挂载 `<App>`，引入样式。 |
| `version.ts` | 把构建时注入的版本号、构建日期导出给 UI。 |
| `samples.ts` | 选择页上的"示例文档对"：把 `testdocs/docs/` 01–18 的 .docx 内置进页面，点一下就用真引擎比较（不包含 `real examples/`）。 |

### `src/model/` —— 数据模型（引擎和 UI 共用的"合同"）

| 文件 | 作用 |
|---|---|
| `document.ts` | `DocModel`：**一个**文件解析后的样子（已接受全部修订，只留内容，不建模字体格式）。 |
| `diff.ts` | `DiffResult`：比较结果，比较完就不再改变。整个项目最核心的类型。 |
| `review.ts` | 用户的选择（每条差异选 new/old），与 DiffResult 分开存；没选的算 new。 |
| `reviewOps.ts` | 对选择状态的纯函数操作 + 撤销/重做历史。 |
| `final.ts` | 由选择拼出"最终结果"。 |
| `useOld.ts` | 判断某条差异能不能"Use old"：引擎用 Stage 5 规则（只看旧版一侧能否安全复制进新版），mock 仍用 Stage 3 规则。 |
| `selection.ts` | 段内逐处选择（决定 42）：选择的归一化、校验，以及按逐处选择拼出最终段落。 |
| `hints.ts` | 配对段落和表格；标题级别（⚑）、自动编号（№）的提示。 |
| `scope.ts` | "检查范围"面板的数据：哪些内容比较了 / 只检测 / 只显示。 |
| `flatten.ts` | 段落展平为文本的规则（tab→`\t` 等），文本偏移量都基于它。 |
| `docIndex.ts` | 按 id 查找块/行/单元格。 |
| `invert.ts` | 交换新旧（mock 模式下"交换文件"用）。 |
| `reviewOps.test.ts` | 测试。 |

### `src/engine/` —— 真引擎

| 路径 | 作用 |
|---|---|
| `index.ts` | 引擎入口：两个 .docx → DiffResult。解析在主线程，比较在 Web Worker。 |
| `compare.worker.ts` | Web Worker：在后台线程跑比较，避免页面卡死。 |
| `hash.ts` | 指纹：内容用快速哈希，文件用 SHA-256（自动保存/进度文件识别同一对文件）。 |
| `docx/` | **读取 .docx**：`package.ts` 打开 zip 包并解析关系；`acceptRevisions.ts` 先接受所有已有修订；`readBody.ts` 读正文成 DocModel；`styles.ts` 标题级别/样式继承；`numbering.ts` 计算 Word 显示的自动编号（"3."、"a)"）；`xml.ts` DOM 小工具；`parseDocx.ts` 串起来。 |
| `align/` | **序列对齐**：`myers.ts` 经典 Myers diff；`alignBlocks.ts` 先用唯一内容做锚点再对齐段落/表格行。 |
| `compare/` | **生成 DiffResult**：`compare.ts` 主流程（正文、单元格、嵌套表格同一套逻辑）；`wordDiff.ts` 段落内逐词比较与相似度；`keys.ts` 内容键；`sections.ts` 按内容配对节并提示页眉页脚差异；`scopeRows.ts` 统计"只检测"项；`otherParts.ts` 脚注、页眉页脚、文本框、链接、图片、属性、批注的逐项比较（决定 45、46）。 |
| `export/` | **Stage 3 导出 Clean .docx**：`exportDocx.ts` 主流程（以接受修订后的新文件为底，套用用户选择）；`paragraphEdit.ts` 对修改过的段落就地改回旧文本；`importOld.ts` 把旧文件内容搬进来；`carry.ts` 把旧内容引用的链接、图片、脚注复制进新文件（决定 43）；`structure.ts` 删除内容时保护书签/批注等结构；`dom.ts` 写 XML 的工具（保证元素顺序符合 schema）；`selfCheck.ts` 导出后重新读取并与预览逐块核对。 |
| `testing/` | 测试辅助：`files.ts` 读 testdocs；`makeDocx.ts` 用一段 XML 造最小 .docx。 |
| `*.test.ts` | 引擎测试（`engine`、`advanced` = testdocs 08–15、`stage5` = testdocs 16–18、`boundaries`、`export`、`parseDocx`、`myers`）。 |

### `src/ui/` —— React 界面

| 文件 | 作用 |
|---|---|
| `App.tsx` | 顶层：在选择页/比较页之间切换，离开前提醒未保存的选择。 |
| `SelectScreen.tsx` | 选文件页（上传两个文件或点示例；`?mock` 显示手写 mock）。 |
| `CompareView.tsx` | 主比较界面：左右并排、差异导航、选择、预览最终结果。 |
| `rows.ts` | 把 DiffResult 转成左右对齐的行，供虚拟滚动列表用。 |
| `render.tsx` | 段落/表格的渲染与逐词高亮。 |
| `finalView.tsx` | "最终结果"视图，标出来自旧文件的内容。 |
| `ScopePanel.tsx` | 检查范围面板。 |
| `OtherPartsTab.tsx` | Other parts 标签页：批注、脚注、页眉页脚、文本框、链接、图片、属性（决定 45、46）。 |
| `ExportDialog.tsx` | 导出对话框。 |
| `autosave.ts` | 浏览器本地自动保存选择（辅助手段，进度文件才是正式保存方式）。 |
| `kit.tsx` | 通用小组件和工具（如保存文件，兼容 claude.ai Artifact 的下载方式）。 |
| `labels.ts` | 界面上的英文标签/图标映射。 |
| `styles.css` | 全局样式。 |

### `src/mock/` —— 手写假数据（Stage 1 原型留下）

URL 带 `?mock` 时使用。`builder.ts` 用"相同/变化"描述快速造出 DiffResult；`cases.ts` 对应 testdocs 01–06 的手写结果；`large.ts` 生成约 200 页的大文档测性能；`index.ts` 注册表；`mocks.test.ts` 测试。

### `src/testing/` —— 共享测试工具

`invariants.ts`：所有 DiffResult（mock 或真引擎）都必须满足的不变量；`describe.ts`：把 DiffResult 打印成易读的文字大纲，方便写测试和调试。

---

## `docs/` —— 项目文档（中文）

| 文件 | 作用 |
|---|---|
| `overview.md` | **总入口**：产品是什么、开发路线（已完成 → 发布前验证 → 以后的方向）、设计原则、架构、验收标准逐条状态、已知限制、文档索引。 |
| `user-guide.md` | **给同事看的使用说明（英文）**：功能、使用步骤、注意事项、常见问题。docs/ 中唯一的英文文档（决定 48）。 |
| `decisions.md` | 决定索引：第 1–48 条和界面决定 A1–A12，每条一行，链接到写进的主题文档。代码里的 "decision N" 指这里。 |
| `spec/` | 现行规则，按主题拆分：`scope`（目标、范围、部署、验收标准）、`reading`（支持的文件、已有修订）、`comparison`（比较规则、颗粒度 G1–G12、元素逐项状态）、`merge`（合并模型）、`export`（导出规则）、`ui`（界面与进度）。代码里的 "spec/xxx §n" 指这里。 |
| `implementation/` | 技术设计：`stage2-design.md`（解析和比较引擎，里程碑 M1–M6）、`stage3-design.md`（导出实现、自检、XSD 校验）、`stage5-design.md`（扩展检查）。 |
| `archive/` | 不再维护的原文快照（设计审阅 v0.1、原型说明），以及旧章节号到新文件的对照表。 |
| `dev guidance/` | `release-checklist.md` 发布前验证清单（公司环境、Windows Word、真实文档）；`web-worker-check.md` 检查公司浏览器能否使用 Web Worker；`ruler-workflow.md` AI agent 指令的管理方法。 |
| `repo-map.md` | 本文件。 |

---

## `testdocs/` —— 测试文档

| 路径 | 作用 |
|---|---|
| `README.md` | 每对测试文档的**预期结果**。 |
| `build_testdocs.py` | 生成 01–07 号文档对（基础文本、列表、表格、修订、批注、边界对齐、长文档）。 |
| `build_testdocs_advanced.py` | 生成 08–15 号（导出格式、节与页眉、复杂表格、域与控件、修订+批注、重排与重复、Unicode、真实 SOP）。 |
| `build_testdocs_stage5.py` | 生成 16–18 号（格式、脚注链接图片、批注），Stage 5 用。 |
| `docs/*_old.docx` / `*_new.docx` | 生成好的文档对；`07`、`15` 另有 `*_changes.txt` 列出改了什么。 |
| `docs/real examples/` | 两份真实的 Data Management Plan（v1.01 和 V3.02），用来手工试真实文件。已提交进 git（用户确认可以，2026-10-09）；`samples.ts` 不会把它们打进页面。 |

---

## `scripts/` —— 脚本

| 文件 | 作用 |
|---|---|
| `make-artifact.mjs` | `npm run build:artifact` 的第二步：把 `dist/index.html` 去掉外壳，生成可发布为 claude.ai Artifact 的 `dist/artifact.html`。 |
| `apply-ruler.sh` | 改完 `.ruler/` 后运行：生成 `CLAUDE.md`、`AGENTS.md`、`.kiro/steering/` 等，并同步 skills（跳过第三方 skill）。 |

## `dist/` —— 构建产物 [忽略]

`npm run build` 生成 `index.html`（单文件版，可直接离线打开）；`npm run build:artifact` 再生成 `artifact.html`。可随时删除重建。

## `node_modules/` [忽略]

npm 依赖，`npm install` 生成。

---

## AI agent 相关文件夹

规则：**只改 `.ruler/`，然后运行 `scripts/apply-ruler.sh`**，其余都是生成的。

| 路径 | 作用 |
|---|---|
| `.ruler/AGENTS.md` | agent 指令的**唯一源头**（CLAUDE.md / AGENTS.md 都由它生成）。 |
| `.ruler/ruler.toml` | Ruler 配置：启用 claude、agentsmd、kiro、codex 四种 agent。 |
| `.ruler/skills/` | 项目自有 skill 的源头（目前为空，只有 `.gitkeep`）。 |
| `.claude/launch.json` | Claude 桌面应用启动 dev server 的配置（`docdiff-dev` 固定 5173 端口，`docdiff-dev-auto` 自动选端口）。 |
| `.claude/skills/` | Claude Code 读取的 skills（目前只有第三方的 `archify`）。 |
| `.kiro/steering/` | Kiro 读取的指令。**[生成]** |
| `.kiro/skills/` | Kiro 的 skills（`archify`）。 |
| `.agents/skills/` | Codex 的 skills（`archify`）。 |

`archify` 在三个 skills 文件夹里各有一份完整拷贝（每份约 300 个文件），这是 `npx skills` 安装方式决定的，不是重复错误。
