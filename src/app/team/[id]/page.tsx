"use client";

import {use, useState, useCallback, useEffect, useRef, Suspense} from "react";
import { useSearchParams } from "next/navigation";
import { usePolling } from "@/lib/hooks";
import { ROSTER_CHANGED_EVENT } from "@/lib/roster-events";
import { SSE_RECONNECTED_EVENT } from "@/lib/live-events";
import { getAgents, getTeams, savePybTeam, type AgentConfig, type TeamConfig } from "@/lib/api";
import { ChatRoomView } from "@/components/chatroom-view";
import { GroupAvatar } from "@/components/team/group-avatar";
import { TeamEditor, type TeamFormData } from "@/components/team-editor";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

function TeamChatPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const searchParams = useSearchParams();
  const { data: agents, refresh: refreshAgents } = usePolling<Record<string, AgentConfig>>(getAgents, 0);
  const { data: teams, refresh: refreshTeams } = usePolling<Record<string, TeamConfig>>(getTeams, 0);
  const team = teams?.[id];

  // roster/SSE 直听——teammate 经工具建/删实体时本页数据即时刷新（成员册
  // 与群数据两源都刷）；单次加载无兜底，不接事件则实体变更后停留旧数据。
  // 删 agent 走 all 语义——all/缺省兜底全刷。
  useEffect(() => {
    const onRosterChanged = (e: Event) => {
      const kind = (e as CustomEvent<{ kind?: string }>).detail?.kind;
      if (kind === "teams" || kind === "all" || !kind) refreshTeams();
      if (kind === "agents" || kind === "all" || !kind) refreshAgents();
    };
    const onReconnected = () => {
      refreshTeams();
      refreshAgents();
    };
    window.addEventListener(ROSTER_CHANGED_EVENT, onRosterChanged);
    window.addEventListener(SSE_RECONNECTED_EVENT, onReconnected);
    return () => {
      window.removeEventListener(ROSTER_CHANGED_EVENT, onRosterChanged);
      window.removeEventListener(SSE_RECONNECTED_EVENT, onReconnected);
    };
  }, [refreshTeams, refreshAgents]);

  // 群编辑抽屉（对齐成员页身份卡模式：默认随页打开，用户自行关闭）
  const [drawerOpen, setDrawerOpen] = useState(true);
  // 群编辑栏宽：与聊天窗分界线可拖拽（280~560；增量式+localStorage 记忆，
  // 与身份卡同模式；保留原 min(x,45vw) 视口保护语义）。
  const EDIT_W_KEY = "pyb-desktop_team_edit_width";
  const [editW, setEditW] = useState(340);
  const editWRef = useRef(340);
  const [editResizing, setEditResizing] = useState(false);
  useEffect(() => {
    try {
      const saved = Number(window.localStorage.getItem(EDIT_W_KEY));
      if (saved >= 280 && saved <= 560) { setEditW(saved); editWRef.current = saved; }
    } catch { /* 静默 */ }
  }, []);
  const startEditResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setEditResizing(true);
    const w0 = editWRef.current;
    const x0 = e.clientX;
    const onMove = (ev: MouseEvent) => {
      const w = Math.max(280, Math.min(560, w0 - (ev.clientX - x0)));
      editWRef.current = Math.round(w);
      setEditW(Math.round(w));
    };
    const onUp = () => {
      setEditResizing(false);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      try { window.localStorage.setItem(EDIT_W_KEY, String(editWRef.current)); } catch { /* 静默 */ }
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, []);
  const [teamForm, setTeamForm] = useState<TeamFormData | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // team 数据到达即预填表单（默认开抽屉需要数据就绪；含 Set 去重防御）
  useEffect(() => {
    if (team && !teamForm) {
      setTeamForm({
        id,
        name: team.name,
        description: team.description ?? "",
        agents: [...new Set(team.agents)],
        leader: team.agents.includes(team.leader_agent) ? team.leader_agent : "",
      });
      setError("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [team]);

  // 侧栏「编辑」入口：?edit=1 → 进页即开群编辑抽屉（带聊天窗上下文）
  useEffect(() => {
    if (searchParams.get("edit") === "1" && team) {
      setTeamForm({
        id,
        name: team.name,
        description: team.description ?? "",
        agents: [...new Set(team.agents)],
        leader: team.agents.includes(team.leader_agent) ? team.leader_agent : "",
      });
      setError("");
      setDrawerOpen(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, team?.name]);

  const openDrawer = useCallback(() => {
    if (!team) return;
    setTeamForm({
      id,
      name: team.name,
      description: team.description ?? "",
      // 存量脏数据防御：成员册 Set 去重入表单
      agents: [...new Set(team.agents)],
      leader: team.agents.includes(team.leader_agent) ? team.leader_agent : "",
    });
    setError("");
    setDrawerOpen(v => !v);
  }, [team, id]);

  const save = useCallback(async () => {
    if (!teamForm) return;
    setSaving(true);
    setError("");
    try {
      await savePybTeam(id, {
        members: teamForm.agents,
        ...(teamForm.name.trim() ? { name: teamForm.name.trim() } : {}),
        ...(teamForm.description.trim()
          ? { description: teamForm.description.trim() }
          : {}),
        leader: teamForm.leader || "",
      });
      refreshTeams();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }, [teamForm, id, refreshTeams]);

  return (
    <div className="flex h-full flex-col">
      {/* Top bar：GroupAvatar+群名相邻靠左（对齐成员页顶栏形态），
       * 整组点击开关群编辑抽屉 */}
      <div className="flex items-center px-6 py-3 border-b bg-card">
        <button
          type="button"
          onClick={openDrawer}
          title="群编辑"
          disabled={!team}
          className="flex items-center cursor-pointer rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-60"
        >
          <GroupAvatar memberIds={team?.agents ?? []} agents={agents} size={40} />
          <h1 className="text-base font-semibold ml-3">
            {team?.name ?? id}
          </h1>
        </button>
      </div>

      {/* 主体区：聊天窗 + 群编辑侧栏（对齐成员页推压抽屉模式） */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        <div className="flex-1 min-h-0">
          <ChatRoomView
            teamId={id}
            teamName={team?.name || id}
          />
        </div>
        <aside
          className={cn(
            "relative h-full shrink-0 bg-card overflow-hidden",
            editResizing ? "transition-none" : "transition-[width] duration-300 ease-in-out",
          )}
          style={{ width: drawerOpen ? `min(${editW}px, 45vw)` : 0 }}
          aria-hidden={!drawerOpen}
        >
          {/* 群编辑栏左缘拖拽柄：左右拉伸（聊天窗 flex-1 自适应让位） */}
          <div
            onMouseDown={startEditResize}
            className={cn(
              "absolute left-0 inset-y-0 z-20 w-[2px] bg-border cursor-col-resize",
              "hover:w-1.5 hover:bg-primary/60 transition-all",
              editResizing && "w-1.5 bg-primary/60",
            )}
            title="拖拽调整栏宽"
          />
          {teamForm ? (
            <div className="flex h-full flex-col w-full">
              {/* org-ui 裁定：去掉「群编辑」标题行——X 浮右上角与表单首行同水平 */}
              <Button
                variant="ghost"
                size="sm"
                className="absolute right-1.5 top-1.5 z-10 h-7 text-xs"
                title="收起团队编辑"
                onClick={() => setDrawerOpen(false)}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
              <div className="min-h-0 flex-1">
                <TeamEditor
                  form={teamForm}
                  setForm={setTeamForm}
                  isNew={false}
                  saving={saving}
                  error={error}
                  onSave={save}
                  availableAgents={agents ?? {}}
                  compact
                />
              </div>
            </div>
          ) : null}
        </aside>
      </div>
    </div>
  );
}

// 0.1.28 ceb5947 修法（robocopy 镜像回归重修）：useSearchParams 页面必须
// 包 Suspense 边界（Next 16 静态预渲染 CSR bailout）——默认导出拆内层+外层包装。
export default function TeamChatPageWithSuspense({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<div className="p-8 text-sm text-muted-foreground">加载中...</div>}>
      <TeamChatPage params={params} />
    </Suspense>
  );
}
