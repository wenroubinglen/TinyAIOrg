/**
 * 抽屉事件常量收口（agents/[id] 路由删除票03）。
 * 此前 ROSTER_DRAWER_OPEN_EVENT 定义在 sidebar.tsx，票03 起 sidebar 又需
 * 消费 AgentDrawer 的打开态广播——组件与 sidebar 互引成环（ESM 常量导出
 * 循环链 TDZ 风险）。事件名是无逻辑常量，收口独立模块双向安全。
 */

/** sidebar/全局 → 画布/city：开右侧抽屉（detail={kind:"agent"|"team"|"orgRoom", id, edit?}）。 */
export const ROSTER_DRAWER_OPEN_EVENT = "pyb-desktop:roster-drawer-open";

/** AgentDrawer → 全局：打开态广播（detail={agentId: string|null}——null 即关闭）。sidebar 未读豁免消费。 */
export const AGENT_DRAWER_ACTIVE_EVENT = "pyb-desktop:agent-drawer-active";

/** 跨路由抽屉意图（sessionStorage 键——非画布路由跳 /company 前写入，画布挂载时消费即清）。 */
export const DRAWER_INTENT_KEY = "pyb-desktop_open_drawer";
