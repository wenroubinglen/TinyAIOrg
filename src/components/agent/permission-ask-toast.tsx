"use client";

/**
 * 全局权限弹窗挂载点（按 agent 身份分窗）。
 * 数据链：引擎 G3 挂起 → permission.ask.pending.v1 广播 → ACP forwarder
 * （_meta.kind=permission_ask）→ pyb-host kind 分支 → SSE pyb:permission:ask
 * → 本组件。轮询 ask.list 兜底（SSE 断连/页面刚打开时拉齐）。
 * 决议：ask.resolve（TTL 10min 倒计时，超时 fail-closed 由引擎保证）。
 */
import { useState, useEffect, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ShieldAlert, X, Check } from "lucide-react";
import { getApiBase } from "@/lib/api";

interface PendingAsk {
  requestId: string;
  agentId: string;
  toolName: string;
  message: string;
  createdAt: number;
}

const TTL_MS = 10 * 60 * 1000;

async function listAsks(): Promise<PendingAsk[]> {
  try {
    const r = await fetch(`${getApiBase()}/api/pyb-agents/asks`);
    const j = (await r.json()) as { asks?: PendingAsk[] };
    return j.asks ?? [];
  } catch {
    return [];
  }
}

async function resolveAsk(requestId: string, agentId: string, allow: boolean): Promise<void> {
  try {
    await fetch(`${getApiBase()}/api/pyb-agents/asks/resolve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestId, agentId, allow }),
    });
  } catch {
    /* 决议失败由轮询重新拉齐（ask 仍在即重试面） */
  }
}

export function usePermissionAsks() {
  const [asks, setAsks] = useState<PendingAsk[]>([]);

  const refresh = useCallback(async () => {
    setAsks(await listAsks());
  }, []);

  useEffect(() => {
    void refresh();
    const poll = setInterval(() => void refresh(), 10_000);
    // SSE 订阅：pyb:permission:ask 事件即时拉齐
    let es: EventSource | null = null;
    try {
      es = new EventSource(`${getApiBase()}/api/events/stream`);
      es.addEventListener("pyb:permission:ask", () => void refresh());
    } catch {
      /* SSE 不可用——轮询兜底 */
    }
    return () => {
      clearInterval(poll);
      es?.close();
    };
  }, [refresh]);

  const resolve = useCallback(
    async (requestId: string, agentId: string, allow: boolean) => {
      setAsks(prev => prev.filter(a => a.requestId !== requestId));
      await resolveAsk(requestId, agentId, allow);
      void refresh();
    },
    [refresh],
  );

  return { asks, resolve, refresh };
}

export function PermissionAskToast() {
  const { asks, resolve } = usePermissionAsks();
  const [, forceTick] = useState(0);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // TTL 倒计时秒级刷新
  useEffect(() => {
    tickRef.current = setInterval(() => forceTick(n => n + 1), 1000);
    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
    };
  }, []);

  if (asks.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[100] space-y-3 max-w-sm">
      {asks.map(ask => {
        const elapsed = Date.now() - ask.createdAt;
        const remain = Math.max(0, Math.floor((TTL_MS - elapsed) / 1000));
        const mm = String(Math.floor(remain / 60)).padStart(2, "0");
        const ss = String(remain % 60).padStart(2, "0");
        const expired = remain === 0;
        return (
          <div
            key={ask.requestId}
            className="rounded-lg border border-primary/40 bg-card shadow-lg p-4 space-y-2"
          >
            <div className="flex items-center gap-2">
              <ShieldAlert className="h-4 w-4 text-primary shrink-0" />
              <span className="text-sm font-semibold truncate flex-1">
                {ask.agentId}
              </span>
              <Badge variant="outline" className="font-mono text-[10px] shrink-0">
                {ask.toolName}
              </Badge>
              {!expired && (
                <span className="text-[10px] text-muted-foreground font-mono shrink-0">
                  {mm}:{ss}
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground line-clamp-4 whitespace-pre-wrap">
              {ask.message}
            </p>
            <div className="flex items-center gap-2 pt-1">
              <Button
                size="sm"
                className="h-7 text-xs"
                disabled={expired}
                onClick={() => void resolve(ask.requestId, ask.agentId, true)}
              >
                <Check className="h-3 w-3" />
                允许
              </Button>
              <Button
                size="sm"
                variant="destructive"
                className="h-7 text-xs"
                disabled={expired}
                onClick={() => void resolve(ask.requestId, ask.agentId, false)}
              >
                <X className="h-3 w-3" />
                拒绝
              </Button>
              {expired && (
                <span className="text-[10px] text-destructive">已超时（fail-closed）</span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
