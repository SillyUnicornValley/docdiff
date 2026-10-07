# Ruler 工作流程

> 创建：2026-10-07（参照 ai_enablement_platform 的做法）

本项目在不同设备上使用 Claude Code、OpenAI Codex 和 Kiro。三者读取说明和技能的位置不同：

| 工具 | 说明文件 | 技能 |
|---|---|---|
| Claude Code | `CLAUDE.md` | `.claude/skills/*/SKILL.md` |
| Kiro | `AGENTS.md`、`.kiro/steering/` | `.kiro/skills/*/SKILL.md` |
| OpenAI Codex | `AGENTS.md` | `.agents/skills/*/SKILL.md` |

用 [Ruler](https://ai.intellectronica.net/ruler) 以 `.ruler/` 为唯一来源，一条命令同步到三个工具。

```
.ruler/                     ← 唯一来源（只改这里）
├── AGENTS.md               ← 项目说明
├── ruler.toml              ← 生成哪些工具的文件
└── skills/                 ← 本项目自己的技能
scripts/apply-ruler.sh      ← 运行它来分发
skills-lock.json            ← 第三方技能（npx skills 安装，如 archify）
```

生成的文件（不要直接改，全部提交到 git）：`AGENTS.md`、`CLAUDE.md`、`.kiro/steering/`、`.claude/skills/`、`.kiro/skills/`、`.agents/skills/`。

## 日常操作

- **改项目说明**：改 `.ruler/AGENTS.md` → 运行 `scripts/apply-ruler.sh` → 提交。
- **加或改自己的技能**：改 `.ruler/skills/<名称>/SKILL.md` → 运行脚本 → 提交。
- **加工具**：在 `.ruler/ruler.toml` 中启用 → 运行脚本 → 提交。

## 第三方技能（archify）

archify 用 `npx skills` 安装在本仓库（不是全局），已复制到三个工具的技能目录，并记录在 `skills-lock.json`：

```bash
npx skills add tt-a1i/archify -a claude-code -a codex -a kiro-cli --copy -y   # 安装
npx skills update -p                                                         # 更新
```

`apply-ruler.sh` 的 rsync 会排除 `skills-lock.json` 中列出的技能，所以不会把它们删掉。不要把第三方技能放进 `.ruler/skills/`。

## 新设备

生成的文件和 archify 都已提交，`git clone` 后三个工具即可直接使用，无需额外设置。只有修改 `.ruler/` 后才需要运行脚本（需要 Node.js、rsync、git）。

## 注意

- 第一次运行时，如果项目原来有手写的 `AGENTS.md`，可能出现内容重复；再运行一次即可。
- Ruler 提示 “agents do not support native skills” 可忽略，技能由 rsync 分发。
- 工具没读到新内容时，重开会话。
