"use client";

import { useState, useEffect, useCallback, useRef, Suspense } from "react";
import { use } from "react";
import { useSearchParams } from "next/navigation";
import { usePolling } from "@/lib/hooks";
import { cn } from "@/lib/utils";
import { getAgents, type AgentConfig } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
// 五快照组件脱挂保留（暂不可达，组件文件仍在 @/components/agent/ 待命）
// Drawer 形态改 inline 推压 aside（非遮挡压缩），Sheet 组件不再用于此页
import { IdentityCard } from "@/components/agent/identity-card";
import { AgentAvatar } from "@/components/agent/agent-avatar";
import { TeammateChat } from "@/components/agent/teammate-chat";
// 本页去 cron 化——SchedulePane 已迁画布
// 右侧抽屉（单聊/群抽屉「设置编辑/定时任务」凹陷分段双钮），此页回归
// 纯聊天页（TeammateChat 恒主体）。
import { Bot, ArrowLeft } from "lucide-react";
import Link from "next/link";

// 七 tab 排拆除——TeammateChat 恒主体；
// 四快照组件（ProfileTab/SnapshotZoneTab/SkillsListTab）脱挂不删，保留待命
// （一等快照面暂不可达，归宿后续再定）。顶栏头像
// 块可点击 → 右侧身份卡 Drawer。

function AgentConfigPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: agentId } = use(params);
  const searchParams = useSearchParams();
  const openCardEdit = searchParams.get("card") === "edit";
  const { data: agents, refresh: refreshAgents } = usePolling<
    Record<string, AgentConfig>
  >(getAgents, 0);
  const [drawerOpen, setDrawerOpen] = useState(true);
  // 身份卡栏宽：与聊天窗分界线可拖拽（280~560 钳制；增量式+localStorage
  // 记忆——与公司页抽屉编辑栏同模式，含原 min(420,45vw) 的视口保护语义：
  // 拖拽值与 45vw 取小）。
  const CARD_W_KEY = "pyb-desktop_agent_card_width";
  const [cardW, setCardW] = useState(340);
  const cardWRef = useRef(340);
  const [cardResizing, setCardResizing] = useState(false);
  useEffect(() => {
    try {
      const saved = Number(window.localStorage.getItem(CARD_W_KEY));
      if (saved >= 280 && saved <= 560) {
        setCardW(saved);
        cardWRef.current = saved;
      }
    } catch {
      /* 静默 */
    }
  }, []);
  const startCardResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setCardResizing(true);
    const w0 = cardWRef.current;
    const x0 = e.clientX;
    const onMove = (ev: MouseEvent) => {
      const w = Math.max(280, Math.min(560, w0 - (ev.clientX - x0)));
      cardWRef.current = Math.round(w);
      setCardW(Math.round(w));
    };
    const onUp = () => {
      setCardResizing(false);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      try {
        window.localStorage.setItem(CARD_W_KEY, String(cardWRef.current));
      } catch {
        /* 静默 */
      }
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, []);
  const [cardFlipped, setCardFlipped] = useState(false);

  // sidebar「编辑」入口：?card=edit → 开身份卡并翻到编辑面
  useEffect(() => {
    if (openCardEdit) {
      setDrawerOpen(true);
      setCardFlipped(true);
    }
  }, [openCardEdit]);

  const agent = agents?.[agentId];

  if (!agents) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <div className="h-3 w-3 animate-spin border-2 border-primary border-t-transparent" />
          加载中...
        </div>
      </div>
    );
  }

  if (!agent) {
    return (
      <div className="p-8">
        <Card>
          <CardContent className="p-12 text-center">
            <Bot className="h-10 w-10 text-muted-foreground mx-auto mb-4" />
            <p className="text-lg font-medium">未找到 Teammate</p>
            <p className="text-sm text-muted-foreground mt-1">
              不存在 ID 为 &quot;{agentId}&quot; 的 Teammate
            </p>
            <Link href="/agents">
              <Button variant="outline" className="mt-4">
                <ArrowLeft className="h-4 w-4" />
                返回 Teammates
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen">
      {/* Top bar：左对齐头像+名称（垂直居中；顶栏精简——去返回箭头/@id/描述行） */}
      {/* Top bar：头像+名称相邻靠左、垂直居中（顶栏精简——去返回箭头/@id/描述行）；
       * 头像与名称整组可点击：开关身份卡抽屉（再点收起） */}
      <div className="flex items-center px-6 py-3 border-b bg-card">
        <button
          type="button"
          onClick={() => setDrawerOpen((v) => !v)}
          title="身份卡"
          className="flex items-center cursor-pointer rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <AgentAvatar
            agentId={agent.agent_id ?? agentId}
            name={agent.name}
            shape={agent.avatar_shape}
            colorHex={agent.avatar_color}
            size={40}
          />
          <h1 className="text-base font-semibold ml-3">{agent.name}</h1>
        </button>
        {/* 去 cron 化：顶栏右侧分段器已删——定时任务面迁画布抽屉 */}
      </div>

      {/* 主体区：聊天窗 + 身份卡侧栏 flex 推压（非遮挡压缩——
       * inline aside 常驻 width 0，开时过渡到 420px，聊天窗 flex-1 自适应） */}
      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1 overflow-auto">
          <TeammateChat agentId={agentId} agentName={agent.name} />
        </div>
        {/* aside 即卡——整个右侧区域是一张身份卡本体，无额外面板留白 */}
        <aside
          className={cn(
            "relative h-full shrink-0 bg-card overflow-hidden",
            cardResizing
              ? "transition-none"
              : "transition-[width] duration-300 ease-in-out",
          )}
          style={{ width: drawerOpen ? `min(${cardW}px, 45vw)` : 0 }}
          aria-hidden={!drawerOpen}
        >
          {/* 身份卡左缘拖拽柄：左右拉伸（聊天窗 flex-1 自适应让位） */}
          <div
            onMouseDown={startCardResize}
            className={cn(
              "absolute left-0 inset-y-0 z-20 w-[2px] bg-border cursor-col-resize",
              "hover:w-1.5 hover:bg-primary/60 transition-all",
              cardResizing && "w-1.5 bg-primary/60",
            )}
            title="拖拽调整栏宽"
          />
          <div className="flex h-full flex-col w-full">
            <div className="flex items-center justify-between px-5 py-3">
              <h2 className="text-xs font-semibold tracking-widest text-muted-foreground uppercase">
                身份卡
              </h2>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                onClick={() => setDrawerOpen(false)}
              >
                收起
              </Button>
            </div>
            <div className="min-h-0 flex-1 px-3 pb-3">
              <IdentityCard
                agentId={agentId}
                agent={agent}
                onSaved={refreshAgents}
                flipped={cardFlipped}
                onFlippedChange={setCardFlipped}
              />
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

// 0.1.28 ceb5947 修法（robocopy 镜像回归重修）：useSearchParams 页面必须
// 包 Suspense 边界（Next 16 静态预渲染 CSR bailout）——默认导出拆内层+外层包装。
export default function AgentConfigPageWithSuspense({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return (
    <Suspense
      fallback={
        <div className="p-8 text-sm text-muted-foreground">加载中...</div>
      }
    >
      <AgentConfigPage params={params} />
    </Suspense>
  );
}
