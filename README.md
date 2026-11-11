# TinyOrg

**TinyOrg** 是 [pyb](https://www.npmjs.com/package/pyb) 多智能体引擎的浏览器工作台——把你的 AI 队友、团队、组织搬进一个页面：像素风 3D 城市、组织画布、会话收件箱、定时任务，全部在浏览器里直接操作。

pyb 引擎在本地运行（`pyb daemon`，默认 `http://127.0.0.1:3779`），TinyOrg 是它的纯 Web 前端——不含引擎、不存密钥、不做代理，所有数据都在你本机。

## 功能

- **公司 / 3D 城市**：组织结构与队友的像素风可视化（React Flow 画布 + Three.js 城市），点开成员即达会话
- **队友（Agents）**：创建/编辑 AI 队友、身份卡、技能面板、定时任务、快照区
- **团队（Teams）**：团队聊天室、成员管理、团队级定时任务
- **组织（Orgs）**：多层级组织树、团队挂载、指挥室（command room）
- **收纳箱（Inbox）**：跨队友消息汇聚、澄清向导、每周回顾
- **设置**：模型配置（profile 切换/方言探测）、Web 搜索、连接与 API 端点覆盖

## 前置要求

- Node.js ≥ 20（本仓开发用 bun 管理依赖亦可）
- 本机已安装并配置 pyb 引擎（npm 包名 `pybao-xc-sdk`，安装后命令为 `pyb`）：

```bash
npm install -g pybao-xc-sdk
pyb daemon start   # 启动常驻引擎（默认 127.0.0.1:3779）
```

> 模型供应商与 API Key 无需在此步配置——启动 TinyOrg 后在「设置 → 模型」页完成配置（内置 10 家厂商模板 + 自定义 OpenAI/Anthropic 兼容端点，支持在线测试连通）。

## 启动

```bash
git clone <repo-url> && cd tinyorg
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
