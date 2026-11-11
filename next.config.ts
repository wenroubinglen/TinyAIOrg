import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    root: import.meta.dirname,
  },
  // 体积优化：standalone 输出——.next/standalone 含最小 server
  // 树（server.js + 按需 node_modules 子集），取代全量 production 树随包
  // （744M→目标 ≤80M）。与动态路由兼容（output:export 的 [id] 冲突不存在）。
  output: "standalone",
};

export default nextConfig;
