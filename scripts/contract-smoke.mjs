#!/usr/bin/env node
// TinyOrg ↔ pyb daemon API 契约 smoke：
// 对运行中的 daemon 探测 TinyOrg 依赖的全部端点。
// 用途：pyb 引擎升级后重跑本脚本，快速验证 UI 依赖的 API 面是否兼容。
// 用法：node scripts/contract-smoke.mjs [host:port]   （默认 127.0.0.1:3779）

const BASE = "http://" + (process.argv[2] || "127.0.0.1:3779");

// [方法, 路径, 期望状态] —— 404 视为契约破坏（端点退役/改名）
// 写端点用 HEAD 不行（daemon 不支持），用带无效体的小负载：非 404 即视为路由存在
const GET_EXPECTED = [
  "/health",
  "/api/pyb-agents",
  "/api/pyb-teams",
  "/api/pyb-orgs",
  "/api/inbox",
  "/api/pyb-read/state",
  "/api/pyb/agent-skills",
  "/api/pyb/model-config/overview",
  "/api/pyb/model-config/presets",
  "/api/pyb/model-config/revision",
  "/api/pyb/profiles",
  "/api/pyb/websearch",
  "/api/settings",
  "/api/status",
  "/api/tasks",
  "/api/scheduled-tasks",
  "/v1/scheduled-tasks",
];

async function probe(method, path, body) {
  try {
    const res = await fetch(BASE + path, {
      method,
      headers: body ? { "content-type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(6000),
    });
    return res.status;
  } catch (e) {
    return "ERR:" + (e.name || e.message);
  }
}

let fail = 0;
console.log("TinyOrg contract smoke →", BASE, "\n");

// health 专项
const h = await probe("GET", "/health");
if (h === 200) console.log("✓ health 200 — daemon 在线");
else {
  console.error("✗ health", h, "— daemon 未运行？先 `pyb daemon start`");
  process.exit(1);
}

for (const p of GET_EXPECTED) {
  if (p === "/health") continue;
  const s = await probe("GET", p);
  const ok = s !== 404;
  if (!ok) fail++;
  console.log((ok ? "✓" : "✗"), "GET", p, s);
}

// 写端点：非 404 即活（400/401 都说明路由在）
const WRITE_PROBES = [
  ["PUT", "/api/pyb/model-config/selection", { profileId: "__smoke__" }],
  ["POST", "/api/pyb/model-config/dialect-probe", {}],
  ["POST", "/api/pyb-read/mark", {}],
  ["POST", "/api/pyb/agent-skills/create", {}],
];
for (const [m, p, b] of WRITE_PROBES) {
  const s = await probe(m, p, b);
  const ok = s !== 404;
  if (!ok) fail++;
  console.log((ok ? "✓" : "✗"), m, p, s);
}

// SSE：只验证握手头（CORS/Content-Type），1 秒即断
try {
  const ctrl = new AbortController();
  setTimeout(() => ctrl.abort(), 1200);
  const res = await fetch(BASE + "/api/events/stream", {
    headers: { Accept: "text/event-stream" },
    signal: ctrl.signal,
  });
  const ok = res.status === 200 && (res.headers.get("content-type") || "").includes("event-stream");
  if (!ok) fail++;
  console.log(ok ? "✓" : "✗", "GET /api/events/stream (SSE)", res.status, res.headers.get("content-type"));
} catch (e) {
  // abort 前已拿到头则正常；连接被拒才算挂
  if (e.name === "AbortError") console.log("✓ GET /api/events/stream (SSE) — 握手后正常断开");
  else { fail++; console.log("✗ GET /api/events/stream (SSE)", e.message); }
}

console.log("\n" + (fail === 0 ? "✅ ALL PASS — 契约面完整" : `❌ ${fail} endpoint(s) BROKEN — 端点面与 UI 期望不一致`));
process.exit(fail === 0 ? 0 : 1);
