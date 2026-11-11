"use client";

// roster 变更通知——创建/删除/改名成功后派发 window 事件，
// 常驻 Sidebar 监听并立即 refresh（不再等 30s 轮询）。不引 SSE/引擎依赖。
// badge 事件（新消息到达→Sidebar 刷新未读
// 聚合，与 roster 刷新正交——徽标数据走 /api/pyb-read/state）。
export const ROSTER_CHANGED_EVENT = "pyb:roster-changed";
export const BADGE_REFRESH_EVENT = "pyb:badge-refresh";

export type RosterKind = "agents" | "teams" | "orgs";

export function notifyRosterChanged(kind: RosterKind): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(ROSTER_CHANGED_EVENT, { detail: { kind } }));
}

export function notifyBadgeRefresh(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(BADGE_REFRESH_EVENT));
}
