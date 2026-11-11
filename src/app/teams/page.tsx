"use client";

import {useState, useCallback, useMemo, useEffect, Suspense} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { usePolling } from "@/lib/hooks";
import { useConnectionPhase } from "@/lib/connection-phase";
import {
  getAgents, getTeams, saveTeam, deleteTeam, createPybTeam, savePybTeam, deletePybTeam, checkDaemonHealth,
  type AgentConfig, type TeamConfig,
} from "@/lib/api";
import { notifyRosterChanged } from "@/lib/roster-events";
import {
  ReactFlow,
  type Node,
  type Edge,
  type NodeTypes,
  type NodeProps,
  ReactFlowProvider,
  Handle,
  Position,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import {
  Users, Crown, Bot, Plus, Pencil, Trash2,
  X, Check, Loader2,
} from "lucide-react";
import { agentColor } from "@/components/sidebar";
import { TeamEditor, type TeamFormData } from "@/components/team-editor";
import { GroupAvatar } from "@/components/team/group-avatar";
import { cn } from "@/lib/utils";

// 一等化：无双轨——team 均为一等群（pyb team.*），leader 恒 main。
// leader 为可选行为标签（默认无；从成员中单选，
// 空串=清除），FormData.leader 承载，提交走 createPybTeam/savePybTeam。
// 表单类型与编辑器抽至 @/components/team-editor 共享（组织架构抽屉同源）。
type FormData = TeamFormData;

const emptyForm: FormData = {
  id: "", name: "", description: "", agents: [], leader: "",
};

function MiniLeaderNode({ data }: NodeProps) {
  return (
    <div className="bg-card border-2 border-primary/60 rounded-lg shadow-sm px-3 py-1.5 ring-1 ring-primary/20" style={{ width: MINI_NODE_W }}>
      <Handle type="source" position={Position.Bottom} className="!bg-primary !w-1.5 !h-1.5" />
      <div className="flex items-center gap-1.5">
        <div className={cn(
          "flex h-5 w-5 items-center justify-center rounded text-[8px] font-bold uppercase shrink-0 text-white",
          data.color as string,
        )}>
          {(data.label as string).slice(0, 2)}
        </div>
        <span className="text-xs font-medium text-foreground truncate flex-1">
          {data.label as string}
        </span>
        <Crown className="h-2.5 w-2.5 text-primary shrink-0" />
      </div>
    </div>
  );
}

function MiniAgentNode({ data }: NodeProps) {
  return (
    <div className="bg-card border rounded-lg shadow-sm px-3 py-1.5 border-border" style={{ width: MINI_NODE_W }}>
      <Handle type="target" position={Position.Top} className="!bg-muted-foreground !w-1.5 !h-1.5" />
      <div className="flex items-center gap-1.5">
        <div className={cn(
          "flex h-5 w-5 items-center justify-center rounded text-[8px] font-bold uppercase shrink-0 text-white",
          data.color as string,
        )}>
          {(data.label as string).slice(0, 2)}
        </div>
        <span className="text-xs font-medium text-foreground truncate flex-1">
          {data.label as string}
        </span>
      </div>
    </div>
  );
}

const miniNodeTypes: NodeTypes = {
  leader: MiniLeaderNode,
  agent: MiniAgentNode,
};

const MINI_NODE_W = 150;
const MINI_NODE_H = 30;
const MINI_V_GAP = 50;

function buildMiniTree(
  team: TeamConfig,
  agents: Record<string, AgentConfig>,
): { nodes: Node[]; edges: Edge[]; height: number } {
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  // group-leader-model P1：leader 数据驱动——无 leader（""）时成员平铺，
  // 不再 || 'main' 兜底画顶层节点（用户不占席）。
  const leaderId = team.leader_agent || "";
  const leader = leaderId ? agents[leaderId] : undefined;
  const workerIds = team.agents.filter((a) => a !== leaderId && agents[a]);

  const H_GAP = 20;
  const totalWorkersWidth = workerIds.length > 0
    ? workerIds.length * MINI_NODE_W + (workerIds.length - 1) * H_GAP
    : 0;
  const contentWidth = Math.max(MINI_NODE_W, totalWorkersWidth);

  if (leaderId && leader) {
    // 有 leader：顶层节点 + 成员下行
    const leaderNodeId = "leader";
    nodes.push({
      id: leaderNodeId,
      type: "leader",
      position: { x: contentWidth / 2 - MINI_NODE_W / 2, y: 0 },
      data: {
        label: leader.name || leaderId,
        color: agentColor(leaderId),
      },
    });
    const workerY = MINI_NODE_H + MINI_V_GAP;
    workerIds.forEach((aid, i) => {
      const nodeId = `agent-${aid}`;
      const x = (contentWidth - totalWorkersWidth) / 2 + i * (MINI_NODE_W + H_GAP);
      nodes.push({
        id: nodeId,
        type: "agent",
        position: { x, y: workerY },
        data: { label: agents[aid].name, color: agentColor(aid) },
      });
      edges.push({
        id: `${leaderNodeId}->${nodeId}`,
        source: leaderNodeId,
        target: nodeId,
        type: "smoothstep",
        style: { stroke: "var(--color-border)" },
      });
    });
    const height = workerIds.length > 0 ? workerY + MINI_NODE_H + 10 : MINI_NODE_H + 10;
    return { nodes, edges, height };
  }

  // 无 leader：全员同层平铺（平权底座）
  const allIds = team.agents.filter((a) => agents[a]);
  const totalWidth = allIds.length > 0
    ? allIds.length * MINI_NODE_W + (allIds.length - 1) * H_GAP
    : 0;
  const width = Math.max(MINI_NODE_W, totalWidth);
  allIds.forEach((aid, i) => {
    nodes.push({
      id: `agent-${aid}`,
      type: "agent",
      position: {
        x: (width - totalWidth) / 2 + i * (MINI_NODE_W + H_GAP),
        y: 0,
      },
      data: { label: agents[aid].name, color: agentColor(aid) },
    });
  });
  const height = MINI_NODE_H + 10;
  return { nodes, edges, height };
}

// ── Main page ─────────────────────────────────────────────────────────────

function TeamsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: agents } = usePolling<Record<string, AgentConfig>>(getAgents, 0);
  const { data: teams, loading, failures, refresh } = usePolling<Record<string, TeamConfig>>(getTeams, 0);
  // 全局相位——错误出口按相位校准
  //（非 ready 态让位 root 横幅，ready 态保留本链独立出口）。
  const connectionPhase = useConnectionPhase();
  const phaseNotReady = connectionPhase !== "ready";
  const [editing, setEditing] = useState<FormData | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [error, setError] = useState("");

  const openNew = () => {
    setEditing({ ...emptyForm });
    setIsNew(true);
    setError("");
  };

  // 侧栏「添加 Team」入口：?new=1 直开新建表单；?edit=<id> 直开编辑
  useEffect(() => {
    if (searchParams.get("new") === "1") {
      openNew();
      return;
    }
    const editId = searchParams.get("edit");
    if (editId && teams?.[editId]) {
      openEdit(editId, teams[editId]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const openEdit = (id: string, team: TeamConfig) => {
    setEditing({
      id,
      name: team.name,
      description: team.description ?? "",
      agents: [...new Set(team.agents)],
      // P2：leader_agent 投影含 role:'leader' 派生（不在册时为空=无标签）
      leader: team.agents.includes(team.leader_agent) ? team.leader_agent : "",
    });
    setIsNew(false);
    setError("");
  };

  const cancel = () => { setEditing(null); setError(""); };

  const handleSave = useCallback(async () => {
    if (!editing) return;
    const { id, name, agents: teamAgents, leader } = editing;
    if (!name.trim()) {
      setError("名称为必填项");
      return;
    }
    if (teamAgents.length === 0) {
      setError("至少需要一个 Agent");
      return;
    }
    // P2：leader 标签成员必须在册（UI 单选已保证，提交前守门）
    if (leader && !teamAgents.includes(leader)) {
      setError("Leader 必须是群成员");
      return;
    }
    setSaving(true);
    setError("");
    try {
      // P2：leader 作为可选行为标签随成员册提交（''=清除，undefined=保留）
      if (isNew) {
        // D 柱：群职能描述引擎必填——空置先拦（文案对齐引擎语义）
        if (!editing?.description?.trim()) {
          setError("团队简介必填：一句话说明本团队职能（其功能/能力）");
          return;
        }
        const created = await createPybTeam({
          name: name.trim(),
          description: editing.description.trim(),
          members: teamAgents,
          ...(leader ? { leader } : {}),
        });
        setEditing(null);
        notifyRosterChanged("teams");
        router.push(`/team/${created.team_id}`);
        return;
      } else {
        await savePybTeam(id, {
          members: teamAgents,
          ...(name ? { name } : {}),
          ...(editing?.description?.trim()
            ? { description: editing.description.trim() }
            : {}),
          // 编辑态显式携带（含空串=用户主动清除标签）
          leader: leader || "",
        });
        notifyRosterChanged("teams");
      }
      setEditing(null);
      refresh();
    } catch (err) {
      const msg = (err as Error).message;
      if (msg.includes("Failed to fetch") || msg.includes("fetch")) {
        setError("无法连接 pyb daemon（127.0.0.1:3779）——请先启动：终端运行 pyb daemon start");
      } else {
        setError(msg);
      }
    } finally {
      setSaving(false);
    }
  }, [editing, refresh, router]);

  const handleDelete = useCallback(async (id: string) => {
    setDeleting(id);
    try {
      await deletePybTeam(id);
      refresh();
      notifyRosterChanged("teams");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setDeleting(null);
    }
  }, [teams, refresh]);

  // Find unassigned agents
  const assignedAgentIds = new Set<string>();
  if (teams) {
    for (const team of Object.values(teams)) {
      for (const aid of team.agents) assignedAgentIds.add(aid);
    }
  }
  const unassignedAgents = agents
    ? Object.entries(agents).filter(([id]) => !assignedAgentIds.has(id))
    : [];

  return (
    <div className="p-8 space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Users className="h-5 w-5 text-primary" />
            Teams
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            协作执行任务的 Agent Team
          </p>
        </div>
        <Button onClick={openNew} disabled={!!editing}>
          <Plus className="h-4 w-4" />
          添加 Team
        </Button>
      </div>

      {/* Editor */}
      {editing && (
        <TeamEditor
          form={editing}
          setForm={setEditing}
          isNew={isNew}
          saving={saving}
          error={error}
          onSave={handleSave}
          onCancel={cancel}
          availableAgents={agents || {}}
        />
      )}

      {/* Team Cards */}
      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <div className="h-3 w-3 animate-spin border-2 border-primary border-t-transparent" />
          加载 Team 中...
        </div>
      ) : failures >= 10 && !teams ? (
        /* 一次性拉取失败即死缺陷——hooks 层已自动退避重试，
           这里是「从未成功」错误出口（≥10 轮约 40s）。
           相位校准——非 ready 态让位 root 横幅
           （消除同屏重复与错误归因），ready 态保留独立出口。 */
        phaseNotReady ? (
          <div className="flex flex-col items-center gap-2 py-12 text-muted-foreground">
            <p className="text-sm">
              {connectionPhase === "unreachable"
                ? "等待连接恢复…（顶部横幅可手动重试）"
                : "引擎恢复中，数据将在就绪后自动加载…"}
            </p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3 py-12 text-muted-foreground">
            <p className="text-sm">无法连接 pyb daemon（127.0.0.1:3779）——正在自动重试</p>
            <button
              className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent"
              onClick={() => refresh()}
            >
              立即重试
            </button>
          </div>
        )
      ) : teams && Object.keys(teams).length > 0 ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {Object.entries(teams).map(([id, team]) => (
            <TeamCard
              key={id}
              id={id}
              team={team}
              agents={agents || {}}
              onEdit={() => openEdit(id, team)}
              onDelete={() => handleDelete(id)}
              deleting={deleting === id}
            />
          ))}
        </div>
      ) : !editing ? (
        <Card>
          <CardContent className="p-12 text-center">
            <Users className="h-10 w-10 text-muted-foreground mx-auto mb-4" />
            <p className="text-lg font-medium">暂无 Team</p>
            <p className="text-sm text-muted-foreground mt-1">
              拉一个群，让多个队友协作干活
            </p>
            <div className="flex items-center justify-center gap-2 mt-4">
              <Button onClick={openNew}>
                <Plus className="h-4 w-4" />
                创建 Team
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* Unassigned Agents */}
      {unassignedAgents.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-muted-foreground flex items-center gap-2">
            <Bot className="h-4 w-4" />
            未分配的 Agent
            <Badge variant="outline" className="ml-1">{unassignedAgents.length}</Badge>
          </h2>
          <div className="flex flex-wrap gap-3">
            {unassignedAgents.map(([id, agent]) => (
              <Link key={id} href={`/agents/${id}`}>
                <div className="flex items-center gap-2 border border-dashed px-3 py-2 hover:border-primary/50 transition-colors cursor-pointer">
                  <div className={cn(
                    "flex h-6 w-6 items-center justify-center text-[9px] font-bold uppercase shrink-0 text-white",
                    agentColor(id),
                  )}>
                    {agent.name.slice(0, 2)}
                  </div>
                  <div>
                    <p className="text-sm font-medium">{agent.name}</p>
                    <p className="text-[10px] text-muted-foreground">@{id}</p>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Team Editor ───────────────────────────────────────────────────────────

// TeamEditor 已抽至 @/components/team-editor（组织架构抽屉同源消费）。

// ── Team Card with mini ReactFlow ─────────────────────────────────────────

function TeamCard({
  id, team, agents, onEdit, onDelete, deleting,
}: {
  id: string;
  team: TeamConfig;
  agents: Record<string, AgentConfig>;
  onEdit: () => void;
  onDelete: () => void;
  deleting: boolean;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);

  const { nodes, edges, height } = useMemo(
    () => buildMiniTree(team, agents),
    [team, agents],
  );

  return (
    <Link href={`/team/${id}`} className="block">
      <Card className="transition-colors hover:border-primary/50 cursor-pointer">
        <CardHeader>
          <div className="flex items-start justify-between">
            <div className="flex items-start gap-2.5 min-w-0">
              <div className="pt-1 shrink-0">
                <GroupAvatar memberIds={team.agents} agents={agents} size={34} />
              </div>
              <div className="min-w-0">
                <CardTitle className="text-lg flex items-center gap-2">
                  {team.name}
                </CardTitle>
                <CardDescription>@{id}</CardDescription>
              </div>
            </div>
            <div className="flex items-center gap-1" onClick={(e) => e.preventDefault()}>
              <Badge variant="outline">
                {team.agents.length} agent{team.agents.length !== 1 ? "s" : ""}
              </Badge>
              <Button variant="ghost" size="icon" onClick={(e) => { e.preventDefault(); onEdit(); }} className="h-8 w-8">
                <Pencil className="h-3.5 w-3.5" />
              </Button>
              {confirmDelete ? (
                <div className="flex items-center gap-1">
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={(e) => { e.preventDefault(); onDelete(); setConfirmDelete(false); }}
                    disabled={deleting}
                    className="h-8 text-xs"
                  >
                    {deleting ? <Loader2 className="h-3 w-3 animate-spin" /> : "Delete"}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={(e) => { e.preventDefault(); setConfirmDelete(false); }} className="h-8 text-xs">
                    No
                  </Button>
                </div>
              ) : (
                <Button variant="ghost" size="icon" onClick={(e) => { e.preventDefault(); setConfirmDelete(true); }} className="h-8 w-8 text-muted-foreground hover:text-destructive">
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div style={{ height: height + 20 }} className="w-full">
            <ReactFlowProvider>
              <ReactFlow
                nodes={nodes}
                edges={edges}
                nodeTypes={miniNodeTypes}
                fitView
                fitViewOptions={{ padding: 0.3 }}
                panOnDrag={false}
                zoomOnScroll={false}
                zoomOnPinch={false}
                zoomOnDoubleClick={false}
                nodesDraggable={false}
                nodesConnectable={false}
                elementsSelectable={false}
                proOptions={{ hideAttribution: true }}
                className="bg-transparent"
              />
            </ReactFlowProvider>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

// 0.1.28 ceb5947 修法（robocopy 镜像回归重修）：useSearchParams 页面必须
// 包 Suspense 边界（Next 16 静态预渲染 CSR bailout）——默认导出拆内层+外层包装。
export default function TeamsPageWithSuspense() {
  return (
    <Suspense fallback={<div className="p-8 text-sm text-muted-foreground">加载中...</div>}>
      <TeamsPage />
    </Suspense>
  );
}
