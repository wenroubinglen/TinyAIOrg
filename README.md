# TinyAIOrg

**TinyAIOrg** 是一个通过多层级组织树方式实现无限嵌套多智能体通信架构的AI项目——我相信不管未来有没有AGI，每个人背后可以是无数组织的组合，这不应该是大公司独一无二的密码，用来做研发，组织管理，以及任何需要大量智能体协助的复杂场景，必须让所有人平权，项目基于自研多智能体协助通讯架构的，NPM基座在开源前目前还需要将前端使用体验完善的地方请理解。

## 演示

**全局搜索聚焦** —— 搜索框按世界分发，输入即定位到画布或城市中的目标成员：

![3D 天空之城演示](public/1.gif)

**抽屉式会话** —— 在组织/团队/成员三类视图中就地弹出会话抽屉，不打断当前页面：

![抽屉会话演示](public/2.gif)


**3D 天空之城** —— 组织树与队友的可视化世界，点开建筑即达成员会话：
![搜索聚焦演示](public/3.gif)

## 功能

- **公司 / 3D天空之城**：组织结构与队友的可视化，点开成员即达会话
- **队友（Agents）**：创建/编辑 AI 队友、身份卡、技能面板、定时任务、快照区
- **团队（Teams）**：团队聊天室、成员管理、团队级定时任务
- **组织（Orgs）**：多层级组织树、团队挂载、指挥室（command room）
- **设置**：模型配置、Web 搜索

## 前置要求

- Node.js ≥ 20（本仓开发用 bun 管理依赖亦可）
- 本机已安装并配置 pyb 引擎（npm 包名 `pybao-xc-sdk`）：

```bash
npm install -g pybao-xc-sdk
pyb daemon start   # 启动常驻引擎（默认 127.0.0.1:3779）
```

> 模型供应商与 API Key 无需在此步配置——启动 TinyOrg 后在「设置 → 模型」页完成配置（内置 10 家厂商模板 + 自定义 OpenAI/Anthropic 兼容端点，支持在线测试连通）。

## 启动

```bash
git clone https://github.com/wenroubinglen/TinyAIOrg.git && cd TinyOrg
bun install        # 或 npm install
bun run dev        # 或 npm run dev → http://localhost:3000
```

UI 默认连接 `http://127.0.0.1:3779`（pyb daemon 默认端口）。确保 daemon 在跑（已在上一步启动；`pyb daemon status` 可随时查看状态，`pyb daemon stop` 停止）。

### 连接自定义端口

右上角设置 → 连接，可手动覆盖 API 端点（持久化到 localStorage）；也支持构建期 `NEXT_PUBLIC_API_URL`。

## 开发

```bash
bun run build   # next build（产物 .next/）
bun run lint    # eslint
```

### API 契约 smoke

`scripts/contract-smoke.mjs` 对运行中的 daemon 探测 TinyOrg 依赖的全部端点，用于引擎升级后快速验证兼容性：

```bash
node scripts/contract-smoke.mjs            # 默认 127.0.0.1:3779
node scripts/contract-smoke.mjs 127.0.0.1:3800
```

## 技术栈

Next.js 16 (App Router) · React 19 · Tailwind CSS 4 · Zustand-free（React 状态原语） · @xyflow/react · Three.js / @react-three/fiber · shiki

## License

[MIT](./LICENSE)
