"use client";

/**
 * 全局连接相位横幅——root 层单点渲染
 * （挂 layout.tsx，照 PermissionAskToast 先例）。
 *
 * 相位→呈现：
 *  ready       不渲染
 *  booting     启动进度提示（非错误色——引擎冷启动是预期瞬态）
 *  degraded    去抖后黄条（store 已去抖，此处只渲染）
 *  unreachable 错误横幅+立即重试按钮（retryConnectionProbe 即时探测）
 */
import { useConnectionPhase, retryConnectionProbe } from "@/lib/connection-phase";

export function ConnectionPhaseBanner() {
  const phase = useConnectionPhase();

  if (phase === "ready") return null;

  if (phase === "booting") {
    return (
      <div className="fixed inset-x-0 top-0 z-[60] flex items-center justify-center gap-2 border-b bg-muted/80 py-1 text-xs text-muted-foreground backdrop-blur">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
        pyb 引擎启动中，页面将在就绪后自动恢复…
      </div>
    );
  }

  if (phase === "degraded") {
    return (
      <div className="fixed inset-x-0 top-0 z-[60] flex items-center justify-center gap-2 border-b bg-yellow-500/10 py-1 text-xs text-yellow-700 dark:text-yellow-400 backdrop-blur">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-yellow-500" />
        连接降级中（引擎恢复中或事件流断开），数据将在恢复后自动同步…
      </div>
    );
  }

  return (
    <div className="fixed inset-x-0 top-0 z-[60] flex items-center justify-center gap-3 border-b bg-destructive/10 py-1.5 text-xs text-destructive backdrop-blur">
      <span>无法连接 pyb daemon（127.0.0.1:3779）——请确认已启动，或</span>
      <button
        className="rounded-md border px-2 py-0.5 hover:bg-accent"
        onClick={retryConnectionProbe}
      >
        立即重试
      </button>
    </div>
  );
}
