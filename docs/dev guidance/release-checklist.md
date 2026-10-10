# 发布前验证清单（v1.0 之前）

> 用途：基本功能已经完成（v0.5.1），发布 v1.0.0、交给同事使用之前，在公司环境中逐项确认（决定 48）。
> 每一项通过后打 ✓，并在 [../overview.md](../overview.md) §2.2 中勾掉对应条目；发现的问题直接告诉开发方。
> 每对样例文档的详细期望结果见 [../../testdocs/README.md](../../testdocs/README.md)；界面怎么操作见 [../user-guide.md](../user-guide.md)。

## 0. 准备

在项目目录生成单文件版本：

```bash
npm install
```

```bash
npm run build
```

得到 `dist/index.html`。把它和 `testdocs/docs/` 文件夹一起拷到公司 Windows 电脑上。

其他打开方式（不能代替公司电脑上的验证）：

- 开发服务器：`npm run dev`，浏览器打开显示的地址（一般是 `http://localhost:5173`）。
- claude.ai Artifacts（手机也能看）：https://claude.ai/artifact/4bAK3f1LjdBEzzs49wVifg 。Save progress 和 Export 下载文件前会先弹出确认框，其余功能相同。

## 1. 公司浏览器

| # | 操作 | 期望结果 | ✓ |
|---|---|---|---|
| 1.1 | 在 Edge 中双击 `dist/index.html` | 页面正常显示，左上角是 `docdiff v0.5.1 · pre-release` 和构建日期 | |
| 1.2 | 在 Chrome 中做同样的操作 | 同上 | |
| 1.3 | 点首页的 Sample pair “07 · Long document” | 几秒内进入比较页；滚动不卡顿 | |
| 1.4 | 把 `index.html` 用 Outlook 邮件发给自己，再用 Teams 发一次，下载后打开 | 没有被拦截，能正常打开。被拦截时记下提示文字 | |
| 1.5 | 打开任一样例，做几处选择后 Export | 浏览器正常下载 .docx，没有被安全策略拦截 | |
| 1.6 | 按 [web-worker-check.md](web-worker-check.md) 检查 Edge 和 Chrome 能否使用 Web Worker | 见该文档 | |
| 1.7 | 把 `dist/index.html` 发布到 Posit Connect，用链接打开，重复 1.3、1.5、1.6；确认访问权限设置 | 结果与本地文件相同；只有需要的同事能打开链接 | |

## 2. Windows Word 打开导出文件（验收标准 12）

每一项：打开样例，按“选择”一栏操作，Export，用 Windows Word 打开下载的文件。

所有文件都要确认：Word **没有**提示“发现无法读取的内容”或要求修复；Word 询问是否更新域（点 Yes）。

| # | 样例 | 选择 | 另外检查 | ✓ |
|---|---|---|---|---|
| 2.1 | 05 · Not-compared elements | Batch › 所有节都 Use old | 全文为纵向（附录被撤回，没有变成横向）；新版的三条批注还在；旧版 Carol 的批注不在 | |
| 2.2 | 08 · Export formatting | 全部 Use old | “10 business days” 带下划线且在批注范围内；m² 的 2 是上标；恢复的 “Retention Period” 是二级标题；“Record every dose.” 是圆点列表的一项 | |
| 2.3 | 09 · Sections, headers, footers | 只对 “Appendix B …” 那处 Use old | 附录 B 消失；最后一节沿用前一节的横向页面设置，页眉页脚正常 | |
| 2.4 | 11 · Fields and content controls | 全部 Use old | 域和内容控件正常显示 | |
| 2.5 | 12 · Tracked changes and comments | 不做任何选择 | 审阅窗格中没有任何修订；Dan、Erin 的批注都在 | |
| 2.6 | 17 · Notes, links and pictures | 全部 Use old | 带回的脚注、超链接、图片、公式都能正常显示，链接可点击 | |
| 2.7 | 15 · Realistic SOP v1.0 → v2.0 | 随意选十几处 Use old | 选了旧版的地方是旧版内容；页眉页脚、横向附录、图片、脚注正常 | |

## 3. 真实文档试用

用两三对真实的公司文档（最好包括一份长文档、一份表格多的文档、一份带修订和批注的文档）完整走一遍：

| # | 检查 | 记录 | ✓ |
|---|---|---|---|
| 3.1 | 比较所需时间；页面是否卡顿 | | |
| 3.2 | 差异是否合理：有没有明显的误报（没改却显示为差异）或漏报（改了却没显示） | | |
| 3.3 | 差异的切分粒度：要点的次数是否可以接受 | | |
| 3.4 | 选择、撤销、批量操作、保存进度、关掉页面再载入进度 | | |
| 3.5 | 导出后在 Word 中与原文件对照：样式、编号、表格、页眉页脚、批注是否符合预期 | | |
| 3.6 | 看 Check scope 面板和 Other parts 标签页，提示是否看得懂 | | |

## 4. 全部通过之后

1. `package.json` 版本号改为 `1.0.0`，重新构建。
2. 更新 [../overview.md](../overview.md) §2.2、§5.1（验收标准 12 改为 ✅）和 [../spec/scope.md](../spec/scope.md) §3.3。
3. 发布到 Posit Connect，把链接和 [../user-guide.md](../user-guide.md) 发给同事。
