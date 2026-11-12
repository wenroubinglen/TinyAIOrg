"use client";

import {
  useState,
  useEffect,
  useCallback,
  useRef,
  useImperativeHandle,
  forwardRef,
} from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
// 票03：事件常量收口 lib/drawer-events（此前从 sidebar 导入——sidebar 又
// 消费本组件的打开态广播，互引成环）
import {
  ROSTER_DRAWER_OPEN_EVENT,
  AGENT_DRAWER_ACTIVE_EVENT,
} from "@/lib/drawer-events";
import { type AgentConfig, type ChatWindowContext } from "@/lib/api";
import { AgentAvatar } from "@/components/agent/agent-avatar";
import { IdentityCard } from "@/components/agent/identity-card";
import { SchedulePane } from "@/components/agent/schedule-pane";
import { TeammateChat } from "@/components/agent/teammate-chat";

/**
 * AgentDrawer —— 成员右侧抽屉（单聊 + 身份卡/定时任务右栏）。
 * agents/[id] 路由删除票：自画布页内联抽屉抽出（行为同源），画布/city 双宿主。
 *
 * 内聚：agentId 与窗上下文（orgId/teamId 派生 chatContext）、cardFlipped、
 * 右栏三态（editPanelOpen×rightPane）、双栏宽度拖拽（localStorage 键与画布
 * team/指挥室抽屉共享——初始值一致，各自拖拽后取最后写入）。
 *
 * 事件：ROSTER_DRAWER_OPEN_EVENT 的 agent 分支监听随组件走——任何宿主页
 * （画布/city）挂载即生效，sidebar 点击入口双页通吃；team/orgRoom 分支仍归
 * 画布页（指挥室/群抽屉是画布专属形态）。
 *
 * 互斥：宿主持有 team/指挥室抽屉态时经 onOpen 回调获知本抽屉打开并自行
 * 清己方态；本抽屉打开由宿主 close 群/指挥室。
 */
export interface AgentDrawerHandle {
  open: (
    agentId: string,
    ctx?: { orgId: string | null; teamId: string | null },
    opts?: { edit?: boolean },
  ) => void;
  close: () => void;
  chatWidthPx: () => number;
}

const DRAWER_W_KEY = "pyb-desktop_drawer_chat_width";
const EDIT_W_KEY = "pyb-desktop_drawer_edit_width";

export const AgentDrawer = forwardRef<
  AgentDrawerHandle,
  {
    agents: Record<string, AgentConfig> | undefined;
    onSaved?: () => void;
    onOpen?: (agentId: string) => void;
    onClose?: () => void;
  }
>(function AgentDrawer({ agents, onSaved, onOpen, onClose }, ref) {
  const [agentId, setAgentId] = useState<string | null>(null);
  const agentIdRef = useRef<string | null>(null);
  const [ctx, setCtx] = useState<{ orgId: string | null; teamId: string | null }>({
    orgId: null,
    teamId: null,
  });
  const [cardFlipped, setCardFlipped] = useState(false);
  // 两段式抽屉：默认只弹聊天框；分段双钮再滑出编辑/身份栏（选中新目标时复位）
  const [editPanelOpen, setEditPanelOpen] = useState(false);
  const [rightPane, setRightPane] = useState<"edit" | "schedule">("edit");
  const openRightPane = (pane: "edit" | "schedule") => {
    if (editPanelOpen && rightPane === pane) {
      setEditPanelOpen(false);
      return;
    }
    setRightPane(pane);
    setEditPanelOpen(true);
  };

  // ── 双栏宽度（画布页同款机制拷贝；键共享） ──
  const [drawerW, setDrawerW] = useState(440);
  const drawerWRef = useRef(440);
  const [resizing, setResizing] = useState(false);
  const [editW, setEditW] = useState(320);
  const editWRef = useRef(320);
  const [editResizing, setEditResizing] = useState(false);

  useEffect(() => {
    let init = Math.round(window.innerWidth / 3);
    try {
      const saved = Number(window.localStorage.getItem(DRAWER_W_KEY));
      if (saved >= 360) init = saved;
    } catch {
      /* 静默 */
    }
    setDrawerW(init);
    drawerWRef.current = init;
    let initEdit = 320;
    try {
      const savedEdit = Number(window.localStorage.getItem(EDIT_W_KEY));
      if (savedEdit >= 240 && savedEdit <= 600) initEdit = savedEdit;
    } catch {
      /* 静默 */
    }
    setEditW(initEdit);
    editWRef.current = initEdit;
  }, []);
  useEffect(() => {
    const onWinResize = () => {
      const max = Math.min(window.innerWidth * 0.85, window.innerWidth - 80);
      if (drawerWRef.current > max) {
        drawerWRef.current = Math.round(max);
        setDrawerW(Math.round(max));
      }
      if (editWRef.current > max) {
        editWRef.current = Math.round(max);
        setEditW(Math.round(max));
      }
    };
    window.addEventListener("resize", onWinResize);
    return () => window.removeEventListener("resize", onWinResize);
  }, []);
  const startResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setResizing(true);
    const w0 = drawerWRef.current;
    const x0 = e.clientX;
    const onMove = (ev: MouseEvent) => {
      const max = Math.min(window.innerWidth * 0.85, window.innerWidth - 80);
      const w = Math.max(360, Math.min(max, w0 + (x0 - ev.clientX)));
      drawerWRef.current = Math.round(w);
      setDrawerW(Math.round(w));
    };
    const onUp = () => {
      setResizing(false);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      try {
        window.localStorage.setItem(DRAWER_W_KEY, String(drawerWRef.current));
      } catch {
        /* 静默 */
      }
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, []);
  const startEditResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setEditResizing(true);
    const w0 = editWRef.current;
    const x0 = e.clientX;
    const onMove = (ev: MouseEvent) => {
      const w = Math.max(240, Math.min(600, w0 + (x0 - ev.clientX)));
      editWRef.current = Math.round(w);
      setEditW(Math.round(w));
    };
    const onUp = () => {
      setEditResizing(false);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      try {
        window.localStorage.setItem(EDIT_W_KEY, String(editWRef.current));
      } catch {
        /* 静默 */
      }
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, []);

  // ── 开合句柄 ──
  const close = useCallback(() => {
    if (agentIdRef.current === null) return;
    agentIdRef.current = null;
    setAgentId(null);
    onClose?.();
  }, [onClose]);

  const open = useCallback(
    (
      id: string,
      openCtx?: { orgId: string | null; teamId: string | null },
      opts?: { edit?: boolean },
    ) => {
      // 再点同一成员=收回抽屉（toggle；edit=true 恒开并翻到身份卡背面编辑态）
      if (!opts?.edit && agentIdRef.current === id) {
        close();
        return;
      }
      agentIdRef.current = id;
      setAgentId(id);
      setCtx(openCtx ?? { orgId: null, teamId: null });
      setCardFlipped(opts?.edit === true);
      setRightPane("edit");
      setEditPanelOpen(opts?.edit === true);
      onOpen?.(id);
    },
    [close, onOpen],
  );

  useImperativeHandle(ref, () => ({
    open,
    close,
    chatWidthPx: () => drawerWRef.current,
  }));

  // sidebar 全局面（agent 分支）——监听随组件走，city 页挂载即生效
  useEffect(() => {
    const onEvt = (e: Event) => {
      const d = (e as CustomEvent<{ kind?: string; id?: string; edit?: boolean }>)
        .detail;
      if (d?.kind !== "agent" || !d.id) return;
      open(d.id, { orgId: null, teamId: null }, { edit: d.edit === true });
    };
    window.addEventListener(ROSTER_DRAWER_OPEN_EVENT, onEvt);
    return () => window.removeEventListener(ROSTER_DRAWER_OPEN_EVENT, onEvt);
  }, [open]);

  // 打开态广播（sidebar 未读抑制）
  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent(AGENT_DRAWER_ACTIVE_EVENT, { detail: { agentId } }),
    );
  }, [agentId]);

  const agent = agentId && agents ? agents[agentId] : null;
  const drawerOpen = !!agent;
  const chatContext: ChatWindowContext | undefined = ctx.orgId
    ? {
        orgId: ctx.orgId,
        ...(ctx.teamId ? { teamId: ctx.teamId } : {}),
      }
    : undefined;

  return (
    <div
      className={cn(
        "absolute inset-y-0 right-0 z-10 bg-card shadow-2xl overflow-hidden flex",
        // 悬浮卡化：大屏四边留白+圆角+单侧投影（grok-bots 详情卡同族形态）；
        // 小屏保持全屏贴边。去 border-l（圆角后左竖线视觉断裂）。
        "sm:inset-y-3 sm:right-3 sm:rounded-3xl",
        "sm:shadow-[-24px_0_60px_-20px_rgba(15,23,42,0.35)]",
        resizing
          ? "transition-none"
          : "transition-all duration-300 ease-in-out",
        !drawerOpen && "pointer-events-none",
      )}
      style={{
        width: drawerW + (editPanelOpen ? editW : 0),
        maxWidth: "85vw",
        transform: drawerOpen ? "translateX(0)" : "translateX(calc(100% + 12px))",
      }}
    >
      {/* 左边缘拖拽调节柄：卡内贴左缘（悬浮卡圆角下骑缝柄会被圆角切断） */}
      <div
        onMouseDown={startResize}
        className={cn(
          "absolute left-0 inset-y-0 z-20 w-1.5 cursor-col-resize",
          "hover:bg-primary/40 transition-colors",
          "sm:inset-y-4 sm:rounded-full",
          resizing && "bg-primary/60",
        )}
        title="拖拽调整宽度"
      />
      {agent ? (
        <>
          <div className="flex min-w-0 flex-1 flex-col h-full">
            {/* 头部主题色渐变：单聊=agent avatarColor（160deg 12% alpha 渐至透明） */}
            <div
              className="flex items-center justify-between px-4 py-3 border-b"
              style={
                agent.avatar_color
                  ? {
                      background: `linear-gradient(160deg, ${agent.avatar_color}1F 0%, transparent 100%)`,
                    }
                  : undefined
              }
            >
              <div className="flex items-center gap-2 min-w-0">
                <AgentAvatar
                  agentId={agent.agent_id ?? agentId ?? ""}
                  name={agent.name}
                  shape={agent.avatar_shape}
                  colorHex={agent.avatar_color}
                  size={28}
                />
                <span className="truncate text-sm font-medium">
                  {agent.name}
                </span>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {/* 凹陷分段双钮（设置编辑/定时任务）——再点当前段=收起右栏 */}
                <div className="flex items-center rounded-[10px] border bg-muted p-0.5 text-xs">
                  {(
                    [
                      ["edit", "编辑"],
                      ["schedule", "任务"],
                    ] as Array<["edit" | "schedule", string]>
                  ).map(([pane, label]) => (
                    <button
                      key={pane}
                      type="button"
                      onClick={() => openRightPane(pane)}
                      className={
                        "rounded-[8px] px-2.5 py-1 transition-colors " +
                        (editPanelOpen && rightPane === pane
                          ? "bg-primary font-medium text-primary-foreground"
                          : "text-muted-foreground hover:text-primary")
                      }
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={close}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
            <div className="min-h-0 flex-1">
              <TeammateChat
                agentId={agentId ?? ""}
                agentName={agent.name}
                chatContext={chatContext}
              />
            </div>
          </div>
          <div
            className={cn(
              "relative h-full shrink-0 border-l bg-card flex-col",
              "transition-transform duration-300 ease-in-out overflow-hidden",
              !editPanelOpen && "translate-x-full absolute right-0 top-0",
            )}
            style={{ display: editPanelOpen ? "flex" : "none", width: editW }}
          >
            {/* 编辑栏左缘拖拽柄：左右拉伸编辑/身份栏（聊天框宽度不联动） */}
            <div
              onMouseDown={startEditResize}
              className={cn(
                "absolute left-0 inset-y-0 z-20 w-1.5 cursor-col-resize",
                "hover:bg-primary/40 transition-colors",
                editResizing && "bg-primary/60",
              )}
              title="拖拽调整栏宽"
            />
            {rightPane === "schedule" ? (
              <div className="min-h-0 flex-1">
                <SchedulePane
                  recipient={{ kind: "agent", id: agentId ?? "" }}
                  recipientLabel={agent.name}
                />
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between px-4 py-3 border-b">
                  <h2 className="text-xs font-semibold tracking-widest text-muted-foreground uppercase">
                    身份卡
                  </h2>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs"
                    title="收起身份卡"
                    onClick={() => setEditPanelOpen(false)}
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <div className="min-h-0 flex-1 px-3 pb-3">
                  <IdentityCard
                    agentId={agentId ?? ""}
                    agent={agent}
                    onSaved={onSaved}
                    flipped={cardFlipped}
                    onFlippedChange={setCardFlipped}
                  />
                </div>
              </>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
});
