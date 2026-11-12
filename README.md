# TinyAIOrg

<div align="center">

[![GitHub Stars](https://img.shields.io/github/stars/wenroubinglen/TinyAIOrg?style=social)](https://github.com/wenroubinglen/TinyAIOrg/stargazers)
[![GitHub Forks](https://img.shields.io/github/forks/wenroubinglen/TinyAIOrg?style=social)](https://github.com/wenroubinglen/TinyAIOrg/network/members)
[![GitHub Issues](https://img.shields.io/github/issues/wenroubinglen/TinyAIOrg)](https://github.com/wenroubinglen/TinyAIOrg/issues)
[![License](https://img.shields.io/badge/License-MIT-blue)](./LICENSE)
[![中文](https://img.shields.io/badge/🇨🇳_简体中文-当前-blue)](README.md)
[![English](https://img.shields.io/badge/🇺🇸_English-Available-green)](README.en.md)

**简体中文** · [English](README.en.md)

</div>

**TinyAIOrg** 项目基于自研多智能体协助通讯架构是一个通过多层级组织树方式实现无限嵌套多智能体通信架构的AI项目——我相信不管未来有没有AGI，每个人背后可以是无数组织的组合，这不应该是大公司独一无二的密码，用来做研发，组织管理，以及任何需要大量智能体协助的复杂场景。

<p align="center">
  <a href="#演示">演示</a> · <a href="#功能">功能</a> · <a href="#前置要求">前置要求</a> · <a href="#启动">启动</a> · <a href="#开发">开发</a> · <a href="#技术栈">技术栈</a>
</p>

---

## 演示

<table>
  <tr>
    <td width="33%" align="center" valign="top">
      <img src="public/1.gif" width="100%" alt="全局搜索聚焦：搜索框按世界分发，输入即定位到画布或城市中的目标成员">
      <br><sub>全局搜索聚焦</sub>
    </td>
    <td width="33%" align="center" valign="top">
      <img src="public/2.gif" width="100%" alt="抽屉式会话：在组织/团队/成员三类视图中就地弹出会话抽屉">
      <br><sub>抽屉式会话</sub>
    </td>
    <td width="33%" align="center" valign="top">
      <img src="public/3.gif" width="100%" alt="3D 天空之城：组织树与队友的可视化世界，点开建筑即达成员会话">
      <br><sub>3D 天空之城</sub>
    </td>
  </tr>
</table>

---

## 功能

- **公司 / 3D天空之城**：组织结构与队友的可视化，点开成员即达会话
- **队友（Agents）**：创建/编辑 AI 队友、身份卡、技能面板、定时任务、快照区
- **团队（Teams）**：团队聊天室、成员管理、团队级定时任务
- **组织（Orgs）**：多层级组织树、团队挂载、指挥室（command room）
- **设置**：模型配置、Web 搜索

---

## 前置要求

- Node.js ≥ 20（本仓开发用 bun 管理依赖亦可）
- 本机已安装并配置 pyb 引擎（npm 包名 `pybao-xc-sdk`）：

```bash
npm install -g pybao-xc-sdk
pyb daemon start   # 启动常驻引擎（默认 127.0.0.1:3779）
```

> 模型供应商与 API Key 无需在此步配置——启动 TinyAIOrg 后在「设置 → 模型」页完成配置（内置 10 家厂商模板 + 自定义 OpenAI/Anthropic 兼容端点，支持在线测试连通）。

## 启动

```bash
git clone https://github.com/wenroubinglen/TinyAIOrg.git && cd TinyAIOrg
bun install        # 或 npm install
bun run dev        # 或 npm run dev → http://localhost:3000
```

UI 默认连接 `http://127.0.0.1:3779`（pyb daemon 默认端口）。确保 daemon 在跑（已在上一步启动；`pyb daemon status` 可随时查看状态，`pyb daemon stop` 停止）。

### 连接自定义端口

右上角设置 → 连接，可手动覆盖 API 端点（持久化到 localStorage）；也支持构建期 `NEXT_PUBLIC_API_URL`。

---

## 开发

```bash
bun run build   # next build（产物 .next/）
bun run lint    # eslint
```

---

## 技术栈

| 类别 | 技术 |
|------|------|
| 框架 | Next.js 16 (App Router) |
| UI | React 19 · Tailwind CSS 4 |
| 状态 | Zustand-free（React 状态原语） |
| 画布 | @xyflow/react |
| 3D | Three.js / @react-three/fiber |
| 高亮 | shiki |

---

## ⭐ Star History

如果这个项目对你有帮助，欢迎点一个 ⭐ Star，让更多人发现 TinyAIOrg。

<a href="https://www.repostars.dev/?repos=wenroubinglen%2FTinyAIOrg&theme=ocean">
  <img alt="Star History Chart" src="https://www.repostars.dev/api/embed?repo=wenroubinglen%2FTinyAIOrg&theme=ocean" />
</a>

---

## License

[MIT](./LICENSE)
