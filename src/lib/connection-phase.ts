"use client";

/**
 * 全局连接相位 store。
 *
 * 相位权威源：
 *  - daemon 活性 = SSE 双边沿（CONNECTION_SSE_DOWN / SSE_RECONNECTED，
 *    live-events.ts 派发）——断连边立即触发一次 /health 仲裁（区分
 *    daemon 死与仅 SSE 抖动），重连边触发 engine 仲裁收尾。
 *  - engine 三态 = 边沿触发的一次性 /health 探测（挂载/SSE 边沿时）
 *    + 30s 兜底轻探——daemonEngineHost 状态机转换不推送 SSE（审计坐实），
 *    engine 静默降级盲区由兜底覆盖（纯边沿探测不可照搬的结构性原因）。
 *
 * 四相位映射：
 *  booting    = /health 200 且 engine='starting'（启动进度，非错误）
 *  ready      = engine='hosted'|'none' 且 SSE 活
 *  degraded   = engine='degraded' 或 SSE 断连（5s 去抖防闪断）
 *  unreachable= /health 请求失败（daemon 死）
 *
 * 互补层铁律（总则3）：本 store 只管全局 UX 相位；数据链完整性归各自
 * usePolling 退避——ENGINE_READY_EVENT 是给数据链的「即时 refresh 信号」
 * 非替代退避。
 */
import { useSyncExternalStore } from "react";
import { getApiBase } from "./api";
import { SSE_RECONNECTED_EVENT, CONNECTION_SSE_DOWN_EVENT } from "./live-events";

/** engine 进入 hosted 的相位边沿（数据链 refresh 信号）。 */
export const ENGINE_READY_EVENT = "pyb-desktop:engine-ready";

export type ConnectionPhase = "booting" | "ready" | "degraded" | "unreachable";

const DEBOUNCE_MS = 5_000;
const FALLBACK_PROBE_MS = 30_000;

type State = {
  phase: ConnectionPhase;
  /** SSE 连接活（onopen 后至下一次 onerror 前）。 */
  sseAlive: boolean;
  /** 最近一次 /health 的 engine 字段（null=未探得）。 */
  engineStatus: "starting" | "hosted" | "degraded" | "none" | null;
};

let state: State = { phase: "booting", sseAlive: false, engineStatus: null };
const listeners = new Set<() => void>();
let started = false;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let fallbackTimer: ReturnType<typeof setInterval> | null = null;
let probing = false;

function notify(): void {
  for (const fn of [...listeners]) fn();
}

function setPhase(patch: Partial<State>): void {
  const prev = state.phase;
  const next = { ...state, ...patch };
  // 相位推导：engineStatus/sseAlive 合成四相位（映射表）。
  let phase: ConnectionPhase;
  if (next.engineStatus === null && next.phase === "booting") {
    phase = "booting"; // 首探未归——维持 booting
  } else if (next.engineStatus === null) {
    phase = "unreachable"; // /health 不可达
  } else if (next.engineStatus === "starting") {
    phase = "booting";
  } else if (!next.sseAlive || next.engineStatus === "degraded") {
    phase = "degraded";
  } else {
    phase = "ready"; // hosted | none 均等价 ready
  }
  state = { ...next, phase };
  if (prev !== "ready" && state.phase === "ready") {
    window.dispatchEvent(new Event(ENGINE_READY_EVENT));
  }
  notify();
}

async function probeEngine(trigger: string): Promise<void> {
  if (probing) return;
  probing = true;
  try {
    // 审计修正：checkDaemonHealth 把 starting/degraded/none 全部
    // 塌缩成 "degraded"（api.ts L55 三态判定）——消费它则 booting 相位在真实
    // 管线永远不可达。直读 /health 原始 engine 字段（starting/hosted/
    // degraded/none 四值，webServer.ts:450-480 引擎宿主自报）。
    const res = await fetch(`${getApiBase()}/health`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) {
      setPhase({ engineStatus: null });
      return;
    }
    const body = (await res.json().catch(() => null)) as {
      engine?: string;
    } | null;
    const raw = body?.engine;
    if (
      raw === "starting" ||
      raw === "hosted" ||
      raw === "degraded" ||
      raw === "none"
    ) {
      setPhase({ engineStatus: raw });
    } else {
      setPhase({ engineStatus: null });
    }
  } catch {
    setPhase({ engineStatus: null });
  } finally {
    probing = false;
  }
}

/** degraded 去抖：SSE 边沿来的降级信号 5s 后才落相位（防闪断）。
 *  unreachable（health 死）不去抖——daemon 死是确凿事实应立即示警。 */
function debouncedDegraded(patch: Partial<State>): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    setPhase(patch);
  }, DEBOUNCE_MS);
}

function onSseDown(): void {
  if (state.sseAlive === false) return; // 去重（onerror 可能重复触发）
  state = { ...state, sseAlive: false };
  // SSE 断但 health 活=仅事件流抖动；health 死=unreachable。立即仲裁。
  void probeEngine("sse-down").then(() => {
    if (state.engineStatus !== null) debouncedDegraded({ sseAlive: false });
  });
}

function onSseUp(): void {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null; // 去抖窗口内恢复——不落 degraded（防闪断）
  }
  void probeEngine("sse-up").then(() => {
    setPhase({ sseAlive: true });
  });
}

function start(): void {
  if (started || typeof window === "undefined") return;
  started = true;
  void probeEngine("mount");
  window.addEventListener(CONNECTION_SSE_DOWN_EVENT, onSseDown);
  window.addEventListener(SSE_RECONNECTED_EVENT, onSseUp);
  // 30s 兜底：engine 静默降级盲区（状态机转换无推送）的唯一覆盖。
  fallbackTimer = setInterval(() => void probeEngine("fallback"), FALLBACK_PROBE_MS);
}

function stop(): void {
  started = false;
  window.removeEventListener(CONNECTION_SSE_DOWN_EVENT, onSseDown);
  window.removeEventListener(SSE_RECONNECTED_EVENT, onSseUp);
  if (fallbackTimer) clearInterval(fallbackTimer);
  if (debounceTimer) clearTimeout(debounceTimer);
  fallbackTimer = null;
  debounceTimer = null;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  start();
  return () => listeners.delete(listener);
}

function getSnapshot(): ConnectionPhase {
  return state.phase;
}

/** 全局连接相位 hook（root 横幅与收编消费方共用）。 */
export function useConnectionPhase(): ConnectionPhase {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** 测试隔离缝（模块级单例——测试复位相位并停掉定时器）。 */
export function __resetConnectionPhaseForTest(): void {
  stop();
  listeners.clear();
  state = { phase: "booting", sseAlive: false, engineStatus: null };
}

/** unreachable 横幅「立即重试」入口——绕过 30s 兜底立即探测一次。 */
export function retryConnectionProbe(): void {
  void probeEngine("manual-retry");
}
