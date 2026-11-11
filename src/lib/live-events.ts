"use client";

/**
 * daemon SSE 直连 hook——roster 即时刷新 +
 * 未读徽标刷新信号的统一入口。
 *
 * 数据链：引擎变更点 emitRosterChanged → roster.changed.v1 事件桥 →
 * teammateStreamForwarder（session/update + _meta.kind='roster_changed'）
 * → daemon SSE /api/events/stream（event 名 = 'session/update'）→ 本 hook
 * 解析 _meta 分发。agent 消息 chunk（_meta.agentId 无 kind 或 kind=
 * user_notification/group_message）触发徽标刷新（读 /api/pyb-read/state
 * 比对，见 Sidebar）。
 *
 * 降级：SSE 断连不重连兜重（EventSource 自动重连）；连接彻底不可用时
 * Sidebar 既有 30s 轮询仍兜底（不拆除）。
 */
import { useEffect } from "react";
import { getApiBase } from "@/lib/api";
import {
  ROSTER_CHANGED_EVENT,
  BADGE_REFRESH_EVENT,
  type RosterKind,
} from "@/lib/roster-events";

interface SessionUpdateMeta {
  kind?: string;
  scope?: string;
  agentId?: string;
  speaker?: string;
  /** 消息路由键（抓包实测全在流里） */
  toAgentId?: string;
  teamId?: string;
  messageId?: string;
}

/** 聊天消息到达事件（detail 带路由键，聊天组件按 toAgentId/teamId 匹配）。 */
export const CHAT_MESSAGE_EVENT = "pyb-desktop:chat-message";
/** SSE（重）连接触发——组件收到即全量重拉（snapshot 语义，断线期内容补齐）。 */
export const SSE_RECONNECTED_EVENT = "pyb-desktop:sse-reconnected";
/**
 * SSE 断连边（es.onerror 派发）——与
 * SSE_RECONNECTED_EVENT 构成双边沿，供 connection-phase store 判 daemon 活性。
 */
export const CONNECTION_SSE_DOWN_EVENT = "pyb-desktop:sse-down";

/**
 * 订阅 daemon SSE 并把引擎事件翻译回 window 事件（Sidebar/页面既有监听
 * 消费）。常驻布局挂载一次即可（Sidebar 已常驻）。
 */
export function useDaemonLiveEvents(): void {
  useEffect(() => {
    if (typeof window === "undefined") return;
    let es: EventSource | null = null;
    try {
      es = new EventSource(`${getApiBase()}/api/events/stream`);
    } catch {
      return; // SSE 不可用——轮询兜底
    }

    const onSessionUpdate = (e: MessageEvent) => {
      try {
        const params = JSON.parse(e.data) as {
          update?: { _meta?: SessionUpdateMeta };
        };
        const meta = params.update?._meta;
        if (!meta) return;
        if (meta.kind === "roster_changed") {
          // scope → 既有 roster window 事件（Sidebar/agents/teams 页消费）
          // 'orgs' 映射进 RosterKind——组织变更同链刷新
          const scope = meta.scope;
          const kind: RosterKind | undefined =
            scope === "agents"
              ? "agents"
              : scope === "teams"
                ? "teams"
                : scope === "orgs"
                  ? "orgs"
                  : undefined;
          window.dispatchEvent(
            new CustomEvent(ROSTER_CHANGED_EVENT, { detail: { kind } }),
          );
          return;
        }
        // 新消息信号（agent chunk：有 speaker/agentId 即有人说话）——徽标刷新
        if (meta.agentId || meta.speaker) {
          window.dispatchEvent(new CustomEvent(BADGE_REFRESH_EVENT));
        }
        // 消息路由分发——聊天组件监听 CHAT_MESSAGE_EVENT
        // 按 toAgentId（单聊）/teamId（群聊）匹配即时 refresh。user_notification/
        // group_message/user 消息 chunk 全覆盖（其他 kind 无路由意义不分发）。
        if (
          meta.kind === "user_notification" ||
          meta.kind === "group_message" ||
          (!meta.kind && (meta.toAgentId || meta.teamId))
        ) {
          window.dispatchEvent(
            new CustomEvent(CHAT_MESSAGE_EVENT, {
              detail: {
                toAgentId: meta.toAgentId,
                teamId: meta.teamId,
                agentId: meta.agentId,
                messageId: meta.messageId,
                speaker: meta.speaker,
              },
            }),
          );
        }
      } catch {
        /* 解析失败静默 */
      }
    };

    es.addEventListener("session/update", onSessionUpdate as EventListener);
    // onopen→SSE_RECONNECTED（含首次连接，幂等）——聊天组件收到即
    // 全量重拉历史（snapshot 重建语义；SSE 无重放，断线期内容靠此补齐）。
    es.onopen = () => {
      window.dispatchEvent(new CustomEvent(SSE_RECONNECTED_EVENT));
    };
    // onerror→CONNECTION_SSE_DOWN（断连边）。EventSource
    // 自动重连继续，重连成功由 onopen 发对偶边——去重与仲裁在 store 侧。
    es.onerror = () => {
      window.dispatchEvent(new CustomEvent(CONNECTION_SSE_DOWN_EVENT));
    };
    return () => {
      es.removeEventListener("session/update", onSessionUpdate as EventListener);
      es.close();
    };
  }, []);
}
