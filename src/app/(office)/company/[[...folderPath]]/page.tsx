"use client";

import { useMemo, useCallback, useEffect, useState, useRef, Suspense } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  ReactFlow,
  Controls,
  type Node,
  type Edge,
  type NodeTypes,
  type NodeProps,
  useReactFlow,
  ReactFlowProvider,
  Handle,
  Position,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { usePolling } from "@/lib/hooks";
import {
  createOrgRoom,
  markPybRead,
  getAgents,
  getTeams,
  type AgentConfig,
  type TeamConfig,
} from "@/lib/api";
import {
  folderPathOf,
  resolveFolderBySlug,
  type AiOrgFolder,
  type AiOrgState,
} from "@/lib/ai-org-folders";
import {
  loadAiOrgFromEngine,
  savePybOrg,
  migrateLegacyAiOrgIfNeeded,
  engineCreateFolder,
  engineRenameFolder,
  engineDeleteFolder,
  engineMoveTeamToFolder,
  engineAssignAgentToOrg,
} from "@/lib/ai-org-engine";
import { AI_ORG_CHANGED_EVENT, SIDEBAR_FLOAT_CLOSE_EVENT } from "@/components/sidebar";
import { ROSTER_DRAWER_OPEN_EVENT } from "@/lib/drawer-events";
import { SSE_RECONNECTED_EVENT } from "@/lib/live-events";
import { ROSTER_CHANGED_EVENT } from "@/lib/roster-events";
import { useConnectionPhase } from "@/lib/connection-phase";
import {
  Bot,
  Building2,
  Crown,
  CircleMinus,
  UsersRound,
  Focus,
  X,
  Plus,
  UserPlus,
  LogOut,
  Trash2,
  Hash,
  ChevronRight,
  FolderTree,
  FolderInput,
  Pencil,
  Settings,
  MessageSquare,ChevronLeft} from "lucide-react";
import { agentColor } from "@/components/sidebar";
import { AgentAvatar, fallbackColorHex } from "@/components/agent/agent-avatar";
import { AgentDrawer, type AgentDrawerHandle } from "@/components/agent/agent-drawer";
// 单聊/群抽屉右栏 schedule 段载体
import { SchedulePane } from "@/components/agent/schedule-pane";
import { CmdRoomDrawer } from "@/components/cmdroom-drawer";
import { ChatRoomView } from "@/components/chatroom-view";
import { TeamEditor, type TeamFormData } from "@/components/team-editor";
import { GroupAvatar } from "@/components/team/group-avatar";
import {
  savePybTeam,
  createPybTeam,
  createPybAgent,
  deletePybAgent,
  deletePybTeam,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

// ── Custom Nodes ──────────────────────────────────────────────────────────

function CompanyNode({ data }: NodeProps) {
  // 管理者=真 teammate，头像机制完全继承
  // （AgentAvatar：身份卡 shape×color + agentId 哈希色兜底），斜戴皇冠。
  // 头像内显组织名前 2 字（AgentAvatar 取 name 前 2 字惯例）。
  if (data.managerAgentId) {
    // 套 NODE_W 宽容器让头像真正居中——React Flow 连线锚点按
    // 节点盒中心算，裸 w-fit 头像会偏左致连线不对称
    return (
      <div
        className="relative flex justify-center cursor-pointer"
        style={{ width: NODE_W }}
      >
        <div className="relative">
          <AgentAvatar
            agentId={data.managerAgentId as string}
            name={(data.label as string) || "?"}
            shape={data.managerAvatarShape as string | null}
            colorHex={data.managerAvatarColor as string | null}
            size={48}
          />
          <div className="absolute -top-2.5 -right-3 h-6 w-6 rotate-[20deg] rounded-full bg-amber-400 border border-amber-500 shadow-sm flex items-center justify-center pointer-events-none">
            <Crown className="h-3.5 w-3.5 text-amber-700" />
          </div>
        </div>
        <Handle
          type="source"
          position={Position.Bottom}
          className="!bg-primary !w-2 !h-2"
        />
      </div>
    );
  }
  return (
    <div className="bg-primary text-primary-foreground rounded-lg shadow-lg px-6 py-3 min-w-[160px]">
      <div className="flex items-center gap-2 justify-center">
        <Building2 className="h-5 w-5" />
        <span className="text-sm font-bold">{data.label as string}</span>
      </div>
      <Handle
        type="source"
        position={Position.Top}
        id="top"
        className="!bg-primary-foreground !w-2 !h-2"
      />
      <Handle
        type="source"
        position={Position.Bottom}
        id="bottom"
        className="!bg-primary-foreground !w-2 !h-2"
      />
    </div>
  );
}

function TeamNode({ data }: NodeProps) {
  // 盒宽固定 NODE_W(150px)——布局假设群盒=150，min-w 会被内容
  // 撑宽致连线锚点（盒底中点）右偏；名字 truncate 保证不溢出
  return (
    <div
      className="bg-primary/10 border border-primary/40 rounded-lg shadow-md px-3 py-2"
      style={{ width: NODE_W }}
    >
      <Handle
        type="target"
        position={Position.Top}
        className="!bg-primary !w-2 !h-2"
      />
      {/* 镜像态出线点：成员在 team 上方时，从 team 顶中点向上连成员 */}
      <Handle
        type="source"
        position={Position.Top}
        id="top-s"
        className="!bg-primary !w-2 !h-2"
      />
      {/* 镜像态锚点：根层 teams 放 AI 组织上方时，根连线落到 team 底部 */}
      <Handle
        type="target"
        position={Position.Bottom}
        id="bottom-mirror"
        className="!bg-primary !w-2 !h-2"
      />
      {/* 常规态出线点：成员在 team 下方时，从 team 下边线中点向下连成员 */}
      <Handle
        type="source"
        position={Position.Bottom}
        id="bot-s"
        className="!bg-primary !w-2 !h-2"
      />
      <div className="flex items-center gap-2 justify-center min-w-0">
        <GroupAvatar
          memberIds={(data.memberIds as string[] | undefined) ?? []}
          agents={
            (data.agents as Record<string, AgentConfig> | undefined) ??
            undefined
          }
          size={22}
        />
        <span className="text-sm font-medium text-foreground truncate">
          {data.label as string}
        </span>
        <span className="text-[10px] text-muted-foreground shrink-0">
          {(data.count as number) ?? 0} 人
        </span>
      </div>
      <Handle
        type="source"
        position={Position.Bottom}
        className="!bg-primary !w-2 !h-2"
      />
    </div>
  );
}

function AgentNode({ data }: NodeProps) {
  // teammate 节点=裸头像（名字在头像内），去白底
  // 卡片；leader 小皇冠保留（与组织节点的大皇冠徽章区分）
  return (
    <div className="relative w-fit cursor-pointer">
      <Handle
        type="target"
        position={Position.Top}
        id="top-t"
        className="!bg-muted-foreground !w-2 !h-2"
      />
      {/* 镜像态入线点：成员在 team 上方时，线从头像下中点入 */}
      <Handle
        type="target"
        position={Position.Bottom}
        id="bottom-t"
        className="!bg-muted-foreground !w-2 !h-2"
      />
      <AgentAvatar
        agentId={(data.agentId as string) ?? ""}
        name={data.label as string}
        shape={data.avatarShape as string | null}
        colorHex={data.avatarColor as string | null}
        size={48}
      />
      {data.isLeader ? (
        <div className="absolute -top-2 -right-2 h-5 w-5 rotate-[20deg] rounded-full bg-amber-400 border border-amber-500 shadow-sm flex items-center justify-center pointer-events-none">
          <Crown className="h-3 w-3 text-amber-700" />
        </div>
      ) : null}
      <Handle
        type="source"
        position={Position.Bottom}
        className="!bg-muted-foreground !w-2 !h-2"
      />
    </div>
  );
}

function UnassignedNode({ data }: NodeProps) {
  return (
    <div className="bg-card border-2 border-dashed border-muted-foreground/40 rounded-lg shadow-md px-4 py-2.5 min-w-[150px]">
      <Handle
        type="target"
        position={Position.Top}
        className="!bg-muted-foreground !w-2 !h-2"
      />
      <div className="flex items-center gap-2 justify-center">
        <Bot className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium text-muted-foreground">
          未分配
        </span>
      </div>
      <Handle
        type="source"
        position={Position.Bottom}
        className="!bg-muted-foreground !w-2 !h-2"
      />
    </div>
  );
}

// C 柱（真机修正）：parent 容器收不到 React Flow onNodeClick（子节点
// 全覆盖命中区）——标题栏原生 onClick 经模块级桥直达页面组件的处理器
//（React Flow 自定义节点拿不到额外 props；data 传函数在 useMemo 依赖
// 外不安全）。页面渲染时更新桥，卸载时置 null。
type OrgTitleClickBridge = ((folderId: string) => void) | null;
let orgTitleClickBridge: OrgTitleClickBridge = null;
let orgTitleDblClickBridge: OrgTitleClickBridge = null;
/** org-ui 裁定：组织右键菜单桥——管理者头像/容器标题栏右键直达（React Flow
 * 事件系统收不到 parent 容器 contextmenu，与 click 桥同法原生直达）。 */
let folderCtxMenuBridge: ((fid: string, x: number, y: number) => void) | null = null;
/**
 * 组织编辑面板（指挥室抽屉编辑栏——改名+换管理者）。
 * 与 TeamEditor 编辑栏同位同律；保存走 savePybOrg（PUT /api/pyb-orgs），
 * 成功后派 AI_ORG_CHANGED_EVENT 令画布组织树刷新。
 */
function OrgEditPanel({
  orgId,
  orgName,
  managerAgentId,
  onSaved,
}: {
  orgId: string;
  orgName: string;
  managerAgentId: string | null;
  onSaved: () => void;
}) {
  const [name, setName] = useState(orgName);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 px-4 py-6 overflow-y-auto">
      <h3 className="text-xs font-semibold tracking-widest text-muted-foreground uppercase">
        组织编辑
      </h3>
      <label className="flex flex-col gap-1 text-xs">
        组织名称
        <input
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setSaved(false);
          }}
          className="rounded-md border bg-background px-2 py-1.5 text-sm"
          placeholder="组织名称"
        />
      </label>
      <div className="text-[11px] text-muted-foreground">
        管理者：{managerAgentId ? managerAgentId : "（自动创建）"}
        （换管理者暂未开放，走引擎 OrgUpdate）
      </div>
      {error ? <div className="text-xs text-red-500">{error}</div> : null}
      {saved ? <div className="text-xs text-emerald-600">已保存</div> : null}
      <Button
        size="sm"
        className="h-8 text-xs"
        disabled={saving || !name.trim() || name.trim() === orgName}
        onClick={async () => {
          setSaving(true);
          setError("");
          try {
            await savePybOrg(orgId, { name: name.trim() });
            setSaved(true);
            onSaved();
          } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
          } finally {
            setSaving(false);
          }
        }}
      >
        {saving ? "保存中…" : "保存"}
      </Button>
    </div>
  );
}

/** 容器空白区点击桥——开组织指挥室（与标题栏 DM 桥
 * 分离；子节点 DOM 在上层点击不命中容器背景，天然隔离）。 */
let orgBodyClickBridge: ((fid: string) => void) | null = null;

/** folder 分组容器节点（Parent Node）——标题栏可点。
 * C 柱修正（真机坐实）：parent 容器节点收不到 React Flow onNodeClick
 * （子节点实体全覆盖命中区，点击 DOM 落在子节点上）——标题栏改挂原生
 * onClick + nodrag（绕过 React Flow 事件系统直接接住），单击=管理者 DM
 * 入口（有管理者映射时）/子画布导航（无映射回落），双击恒进子画布。 */
function FolderGroupNode({ data }: NodeProps) {
  const isPool = data.isPool === true;
  const folderId = typeof data.folderId === "string" ? data.folderId : null;
  // 容器边框/背景跟随管理者头像色（avatarColor 或 agentId 哈希
  // 兜底，与 AgentAvatar 兜底同源）——淡色虚线框+tint 背景，小组织视觉一体
  if (data.managerAgentId && !isPool) {
    const mgrColor =
      (data.managerAvatarColor as string | null) ||
      fallbackColorHex(data.managerAgentId as string);
    return (
      <div
        className="h-full w-full rounded-xl border-2 border-dashed nodrag nopan cursor-pointer"
        onClick={(e) => {
          // 空白区=开指挥室。nodrag 防拖动误触发。
          e.stopPropagation();
          if (!isPool && folderId) orgBodyClickBridge?.(folderId);
        }}
        style={{
          borderColor: `${mgrColor}66`,
          backgroundColor: `${mgrColor}0D`,
        }}
      >
        {/* 连线锚点：组织管理者头像头顶中间（头像浮于 -top-6，Handle
            同位上移使根连线尖端落在头像顶而非容器边框） */}
        <Handle
          type="target"
          position={Position.Top}
          id="mgr-head"
          style={{
            top: -28,
            left: "50%",
            transform: "translate(-50%, -50%)",
            background: "transparent",
            border: "none",
            width: 1,
            height: 1,
          }}
        />
        {/* 容器顶边中点：作为父容器内部子节点时接收上层管理者的连线 */}
        <Handle
          type="target"
          position={Position.Top}
          id="top-edge"
          style={{
            top: 0,
            left: "50%",
            transform: "translate(-50%, -50%)",
            background: "transparent",
            border: "none",
            width: 1,
            height: 1,
          }}
        />
        {/* 管理者头像下边缘中点：向下扇形连出容器内全部直属元素。
            2026-11-03 调整：起点上移至头像底缘(+22px)，紧贴头像直接扇出，
            消除头像与扇形起点间的空白段；内容行顶在 MGR_FAN_Y+FAN_DROP，
            扇形落差由该间距自然形成 */}
        <Handle
          type="source"
          position={Position.Bottom}
          id="mgr-bottom"
          style={{
            top: 22,
            left: "50%",
            transform: "translate(-50%, -50%)",
            background: "transparent",
            border: "none",
            width: 1,
            height: 1,
          }}
        />
        <div
          className="absolute -top-6 left-1/2 -translate-x-1/2 cursor-pointer nodrag nopan hover:scale-110 transition-transform"
          title={(data.managerName as string) ?? (data.label as string)}
          onClick={(e) => {
            e.stopPropagation();
            if (folderId) orgTitleClickBridge?.(folderId);
          }}
          onDoubleClick={(e) => {
            e.stopPropagation();
            if (folderId) orgTitleDblClickBridge?.(folderId);
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (folderId) folderCtxMenuBridge?.(folderId, e.clientX, e.clientY);
          }}
        >
          <div className="relative">
            <AgentAvatar
              agentId={data.managerAgentId as string}
              name={(data.label as string) || "?"}
              shape={data.managerAvatarShape as string | null}
              colorHex={data.managerAvatarColor as string | null}
              size={44}
            />
            <div className="absolute -top-2 -right-2.5 h-5 w-5 rotate-[20deg] rounded-full bg-amber-400 border border-amber-500 shadow-sm flex items-center justify-center pointer-events-none">
              <Crown className="h-3 w-3 text-amber-700" />
            </div>
          </div>
        </div>
      </div>
    );
  }
  return (
    <div
      onClick={(e) => {
        // 无管理者组织空白区同律开指挥室（chair 可为空室仍成立）
        e.stopPropagation();
        if (!isPool && folderId) orgBodyClickBridge?.(folderId);
      }}
      className={cn(
        "h-full w-full rounded-xl border-2 border-dashed nodrag nopan cursor-pointer",
        isPool
          ? "border-muted-foreground/40 bg-muted/[0.04]"
          : "border-primary/40 bg-primary/[0.03]",
      )}
    >
      <div
        className={cn(
          "flex items-center gap-1.5 border-b border-dashed px-3 py-1.5 select-none transition-colors nodrag nopan",
          isPool
            ? "border-muted-foreground/30 cursor-default"
            : "border-primary/30 cursor-pointer hover:bg-primary/10",
        )}
        onClick={(e) => {
          e.stopPropagation();
          if (!isPool && folderId) orgTitleClickBridge?.(folderId);
        }}
        onDoubleClick={(e) => {
          e.stopPropagation();
          if (!isPool && folderId) orgTitleDblClickBridge?.(folderId);
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (!isPool && folderId) folderCtxMenuBridge?.(folderId, e.clientX, e.clientY);
        }}
      >
        <FolderTree
          className={cn(
            "h-3.5 w-3.5 shrink-0",
            isPool ? "text-muted-foreground" : "text-primary",
          )}
        />
        <span
          className={cn(
            "text-xs font-semibold truncate",
            isPool ? "text-muted-foreground" : "text-foreground",
          )}
        >
          {data.label as string}
        </span>
      </div>
    </div>
  );
}

const nodeTypes: NodeTypes = {
  company: CompanyNode,
  team: TeamNode,
  agent: AgentNode,
  unassigned: UnassignedNode,
  folderGroup: FolderGroupNode,
};

// ── Layout ────────────────────────────────────────────────────────────────

const NODE_W = 180;
const NODE_H = 50;
const COL_GAP = 60;
const ROW_GAP = 50;
const TEAMMATE_GAP = 20;
const FOLDER_PAD = 24; // 容器内边距
const FOLDER_TITLE_H = 30; // 容器标题栏高
/** 管理者扇形水平分布线距容器顶边的高度（Handle top 与内容区顶共用） */
const MGR_FAN_Y = 60;
const FOLDER_WRAP = 4; // 子容器每行最多 4 个
const FOLDER_BLOCK_GAP = 40; // teams 区与子容器区间距

type TeamCol = {
  teamId: string;
  teamName: string;
  memberIds: string[];
  leaderId: string;
};

/**
 * 递归布局：folder 容器内 = 直属 teams 列区（上）+ 子 folder 容器区（下，每行 4 个换行）。
 * 绝对坐标布局后再转父相对坐标（React Flow parentId + extent:'parent'）。
 */
function buildAiOrgChart(
  agents: Record<string, AgentConfig>,
  teams: Record<string, TeamConfig>,
  aiOrg: AiOrgState,
  rootFolderId: string | null,
  managers: Record<
    string,
    { agentId: string; name: string; avatarShape?: string | null; avatarColor?: string | null }
  > = {},
  // 群聚焦——?focusTeam= 下钻视图：群节点居顶、成员水平平铺，
  // 复用 addTeamColumns 的思维导图式单群块布局
  focusTeamId: string | null = null,
): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  const parentOf = new Map<string, string | null>(); // nodeId → parentNodeId（null=顶层）
  const absPos = new Map<string, { x: number; y: number }>();

  // team → folder 归属（teamFolder 引用不存在 folder 的视为根）
  const folderIds = new Set(aiOrg.folders.map((f) => f.id));
  const teamFolderOf = new Map<string, string | null>();
  for (const [teamId, fid] of Object.entries(aiOrg.teamFolder)) {
    teamFolderOf.set(teamId, folderIds.has(fid) ? fid : null);
  }
  // org-ui 任务2：agent→org 独立挂靠（loadAiOrgFromEngine 运行时携带，
  // AiOrgState 类型未声明，交叉收窄——managers 同法）
  const agentOrg = (aiOrg as AiOrgState & { agentOrg?: Record<string, string> })
    .agentOrg ?? {};
  // 挂靠组织且该组织存在的独立成员（orgId 有效过滤）
  const orgDirectOf = new Map<string, string>();
  for (const [aid, oid] of Object.entries(agentOrg)) {
    if (folderIds.has(oid)) orgDirectOf.set(aid, oid);
  }

  function teamColumnsOf(folderId: string | null): TeamCol[] {
    const cols: TeamCol[] = [];
    for (const [teamId, team] of Object.entries(teams)) {
      if ((teamFolderOf.get(teamId) ?? null) !== folderId) continue;
      const leaderId = team.leader_agent || "";
      if (leaderId && !agents[leaderId]) continue;
      const seen = new Set<string>();
      const memberIds = team.agents.filter((a) => {
        if (a === leaderId || !agents[a] || seen.has(a)) return false;
        seen.add(a);
        return true;
      });
      if (leaderId) memberIds.unshift(leaderId);
      cols.push({ teamId, teamName: team.name, memberIds, leaderId });
    }
    return cols;
  }

  function addTeamColumns(
    cols: TeamCol[],
    origin: { x: number; y: number },
    parentNode: string | null,
    mirror = false,
  ): { w: number; h: number } {
    if (cols.length === 0) return { w: 0, h: 0 };
    // 思维导图式布局——群节点居上居中，成员
    // 水平平铺在其下一行（平级，非从属链）；群块之间水平并排。
    const AV = 48; // 裸头像尺寸（与 AgentNode/CompanyNode 一致）
    const AV_GAP = 16;
    const PER_ROW = 8; // 成员每行最多 8 个，超出换行
    let cursorX = origin.x;
    let maxH = 0;
    cols.forEach((col) => {
      const teamNodeId = `team-${col.teamId}`;
      const n = col.memberIds.length;
      const rows = Math.max(Math.ceil(n / PER_ROW), 1);
      const membersW =
        Math.max(Math.min(n, PER_ROW), 1) * (AV + AV_GAP) - AV_GAP;
      const blockW = Math.max(membersW, NODE_W);
      const blockX = cursorX;
      const baseY = origin.y;
      // 群节点：块顶居中
      nodes.push({
        id: teamNodeId,
        type: "team",
        position: { x: blockX + blockW / 2 - NODE_W / 2, y: baseY },
        data: {
          label: col.teamName,
          count: col.memberIds.length,
          teamId: col.teamId,
          memberIds: col.memberIds,
          agents,
        },
        draggable: false,
        selectable: false,
      });
      absPos.set(teamNodeId, {
        x: blockX + blockW / 2 - NODE_W / 2,
        y: baseY,
      });
      parentOf.set(teamNodeId, parentNode);

      if (parentNode) {
        edges.push({
          id: `${parentNode}->${teamNodeId}`,
          source: parentNode,
          target: teamNodeId,
          type: "smoothstep",
          style: { stroke: "var(--color-border)" },
        });
      }

      // 成员：群下方水平平铺（每行 PER_ROW 个），整块水平居中
      col.memberIds.forEach((aid, mi) => {
        const rowIdx = Math.floor(mi / PER_ROW);
        const inRowIdx = mi % PER_ROW;
        const inRowCount = Math.min(n - rowIdx * PER_ROW, PER_ROW);
        const rowW = inRowCount * (AV + AV_GAP) - AV_GAP;
        const nodeId = `agent-${col.teamId}-${aid}`;
        const x = blockX + blockW / 2 - rowW / 2 + inRowIdx * (AV + AV_GAP);
        const y = baseY + NODE_H + ROW_GAP + rowIdx * (AV + AV_GAP);
        nodes.push({
          id: nodeId,
          type: "agent",
          position: { x, y },
          data: {
            label: agents[aid].name,
            agentId: aid,
            color: agentColor(aid),
            avatarShape: agents[aid].avatar_shape ?? null,
            avatarColor: agents[aid].avatar_color ?? null,
            isLeader: aid === col.leaderId,
            teamId: col.teamId,
          },
        });
        absPos.set(nodeId, { x, y });
        parentOf.set(nodeId, parentNode);
        edges.push({
          id: `${teamNodeId}->${nodeId}`,
          source: teamNodeId,
          // 镜像态（成员在 team 上方）：team 顶中点 → 成员头像下中点；
          // 常规态（成员在 team 下方）：默认锚点（team 底 → 成员顶）
          ...(mirror
            ? { sourceHandle: "top-s", targetHandle: "bottom-t" }
            : { sourceHandle: "bot-s", targetHandle: "top-t" }),
          target: nodeId,
          type: "smoothstep",
          style: { stroke: "var(--color-border)" },
        });
      });

      maxH = Math.max(maxH, NODE_H + ROW_GAP + rows * (AV + AV_GAP) - AV_GAP);
      cursorX += blockW + COL_GAP;
    });
    return { w: cursorX - origin.x - COL_GAP, h: maxH };
  }

  /** 递归布局 folder 子树，返回容器节点（含绝对坐标与尺寸）。 */
  function layoutFolder(
    folderId: string,
    origin: { x: number; y: number },
    parentNode: string | null,
  ): { id: string; w: number; h: number } {
    const folder = aiOrg.folders.find((f) => f.id === folderId)!;
    const childFolders = aiOrg.folders.filter((f) => f.parentId === folderId);

    // 内容区起点：顶边 = 管理者扇形线(MGR_FAN_Y)之下 50px——mgr-bottom
    // 改 Bottom 出线后，smoothstep 需要足够垂直落差容纳圆角半径；10px 时
    // 各扇形线挤出行程不一的折弯（高低起伏），50px 恢复思维导图式均匀扇形
    const FAN_DROP = 50;
    const contentOrigin = {
      x: origin.x + FOLDER_PAD,
      y: origin.y + MGR_FAN_Y + FAN_DROP,
    };

    // 1) 直属 teams 列区（挂本容器 parentId——容器框约束内容，嵌套不逃逸；
    //    parentNode 传 null 只为不画容器→team 的边，改由显式集合回填 parentId）
    const groupId = `folder-${folderId}`;
    const teamCols = teamColumnsOf(folderId);
    const teamsBlock = addTeamColumns(teamCols, contentOrigin, null);
    for (const col of teamCols) {
      parentOf.set(`team-${col.teamId}`, groupId);
      for (const aid of col.memberIds)
        parentOf.set(`agent-${col.teamId}-${aid}`, groupId);
    }

    // 2026-11-03 拍板：容器内三种直属元素（team 列 / 独立成员 / 子组织容器）
    // 混排【同一平行行】——同一顶边 contentOrigin.y、统一 COL_GAP 间隔横向
    // 排开；管理者头像居容器顶中（容器宽=行宽），其下缘中点正对平行行中心
    // 扇形连出每个元素顶中点——与根层「平行带+中点对轴」同构。
    const orgDirectIds = [...orgDirectOf.entries()]
      .filter(([aid, oid]) => oid === folderId && agents[aid])
      .map(([aid]) => aid);

    // 1) 独立成员：teams 块右侧同顶行平铺
    let directBlockH = 0;
    let directBlockW = 0;
    let cursorX = contentOrigin.x + (teamCols.length > 0 ? teamsBlock.w + COL_GAP : 0);
    if (orgDirectIds.length > 0) {
      const rowY = contentOrigin.y;
      orgDirectIds.forEach((aid, i) => {
        const nodeId = "orgdirect-" + aid;
        const a = agents[aid];
        nodes.push({
          id: nodeId,
          type: "agent",
          position: {
            x: cursorX + i * (NODE_W + TEAMMATE_GAP),
            y: rowY,
          },
          data: {
            label: a.name,
            agentId: aid,
            teamId: null,
          },
        });
        parentOf.set(nodeId, groupId);
      });
      directBlockW =
        orgDirectIds.length * NODE_W +
        Math.max(orgDirectIds.length - 1, 0) * TEAMMATE_GAP;
      directBlockH = NODE_H;
      cursorX += directBlockW + COL_GAP;
    }

    // 2) 子组织容器：续接同一顶行（同 contentOrigin.y，不折行）
    let subBlockW = 0;
    let subBlockH = 0;
    const subOrigins: Array<{
      id: string;
      x: number;
      y: number;
      w: number;
      h: number;
    }> = [];
    if (childFolders.length > 0) {
      const subY = contentOrigin.y;
      childFolders.forEach((cf) => {
        const placed = layoutFolder(cf.id, { x: cursorX, y: subY }, null);
        subOrigins.push({
          id: placed.id,
          x: cursorX,
          y: subY,
          w: placed.w,
          h: placed.h,
        });
        subBlockH = Math.max(subBlockH, placed.h);
        cursorX += placed.w + COL_GAP;
      });
      for (const o of subOrigins)
        subBlockW = Math.max(subBlockW, o.x + o.w - contentOrigin.x);
    }

    // 行宽=三种元素横排总跨度；行高=最高块（teams 块含成员行 / 子组织容器）
    const contentW = Math.max(cursorX - contentOrigin.x - COL_GAP, NODE_W);
    const contentH = Math.max(teamsBlock.h, directBlockH, subBlockH);
    const w = contentW + FOLDER_PAD * 2;
    // 顶部占位 = 分布线 MGR_FAN_Y + 扇形落差 FAN_DROP（内容实际起点），
    // 底部留 FOLDER_PAD——原公式顶部按标题栏+pad(54px)计，漏算偏移致贴底
    const h = MGR_FAN_Y + FAN_DROP + contentH + FOLDER_PAD;

    // 容器节点（groupId 已前置声明）
    nodes.push({
      id: groupId,
      type: "folderGroup",
      position: { x: origin.x, y: origin.y },
      data: {
        label: folder.name,
        folderId,
        // 容器标题栏=管理者戴皇冠头像（继承聚焦画布样式）
        managerName: managers[folderId]?.name ?? null,
        managerAgentId: managers[folderId]?.agentId ?? null,
        managerAvatarShape: managers[folderId]?.avatarShape ?? null,
        managerAvatarColor: managers[folderId]?.avatarColor ?? null,
      },
      draggable: false,
      selectable: true,
      style: { width: w, height: h },
    });
    absPos.set(groupId, { x: origin.x, y: origin.y });
    parentOf.set(groupId, parentNode);

    // 子容器挂为本容器子节点
    for (const o of subOrigins) {
      parentOf.set(o.id, groupId);
    }

    // 2026-11-03 拍板：管理者头像下缘中点扇形连出容器内全部直属元素——
    // 每个 team 图标 / 独立成员头像 / 嵌套子组织容器的上边中点
    // 2026-11-03 拍板：内部扇形边加粗加黑（2px），与容器边框明显区分
    for (const col of teamCols) {
      edges.push({
        id: `${groupId}->team-${col.teamId}`,
        source: groupId,
        sourceHandle: "mgr-bottom",
        target: `team-${col.teamId}`,
        type: "smoothstep",
        style: { stroke: "var(--color-foreground)", strokeWidth: 2 },
      });
    }
    for (const aid of orgDirectIds) {
      edges.push({
        id: `${groupId}->orgdirect-${aid}`,
        source: groupId,
        sourceHandle: "mgr-bottom",
        target: `orgdirect-${aid}`,
        type: "smoothstep",
        style: { stroke: "var(--color-foreground)", strokeWidth: 2 },
      });
    }
    for (const o of subOrigins) {
      edges.push({
        id: `${groupId}->${o.id}`,
        source: groupId,
        sourceHandle: "mgr-bottom",
        target: o.id,
        targetHandle: "top-edge",
        type: "smoothstep",
        style: { stroke: "var(--color-foreground)", strokeWidth: 2 },
      });
    }

    return { id: groupId, w, h };
  }

  // ── 顶层组装 ──
  const companyId = "company";
  if (focusTeamId) {
    // 群聚焦视图——单群块居中（群节点+成员水平平铺），无根节点。
    // 左键交互（群=群聊抽屉/成员=成员抽屉）经 onNodeClick team/agent 分支继承。
    const team = teams[focusTeamId];
    if (!team) return { nodes: [], edges: [] };
    const leaderId = team.leader_agent || "";
    const seen = new Set<string>();
    const memberIds = team.agents.filter((a) => {
      if (a === leaderId || !agents[a] || seen.has(a)) return false;
      seen.add(a);
      return true;
    });
    if (leaderId && agents[leaderId]) memberIds.unshift(leaderId);
    const block = addTeamColumns(
      [
        {
          teamId: focusTeamId,
          teamName: team.name,
          memberIds,
          leaderId,
        },
      ],
      { x: 0, y: 80 },
      null,
    );
    // 居中：整体平移 -w/2（fitView 兜底）
    const offX = -(block.w ?? 0) / 2;
    for (const n of nodes) {
      const abs = absPos.get(n.id);
      if (abs) {
        abs.x += offX;
        n.position = { ...abs };
      }
    }
    return { nodes, edges };
  }
  if (rootFolderId === null) {
    // 聚合画布·纯层级连线：根直属 teams 与顶层组织容器平级横排（无“未分配区”）
    const topFolders = aiOrg.folders.filter(
      (f) => !f.parentId || !folderIds.has(f.parentId),
    );
    const unassignedCols = teamColumnsOf(null); // 根直属 teams（与容器平级，直接连线根）

    // 上下分层布局（2026-11-03 拍板）：直属 teams 放 AI 组织根【上方】连线
    // （边从根顶锚点出发落到群顶锚点）、组织容器留根【下方】、自由成员池
    // 左下不连线——三向分区根治根层连线凌乱。
    const perRow = FOLDER_WRAP;
    const contentY = NODE_H + ROW_GAP * 2;
    let cursorX = 0;
    let cursorY = contentY;
    let rowH = 0;
    let maxRight = 0;

    // 池数据前置声明（组织带后的游标重置在 looseAgentIds 声明前使用会 TDZ 崩）
    const assignedAgentIds = new Set<string>();
    for (const [, team] of Object.entries(teams)) {
      for (const aid of team.agents) assignedAgentIds.add(aid);
    }
    const looseAgentIds = Object.keys(agents).filter(
      // org-ui 任务2：已独立挂靠组织的成员不进游离池（渲染进组织容器）
      (id) => !assignedAgentIds.has(id) && agents[id] && !orgDirectOf.has(id),
    );

    // 直属 teams 列（2026-11-03 镜像对称拍板）：team 放 AI 组织根正上方，
    // 成员头像平铺在 team【上方】——与下方「组织容器装成员」照镜子对称。
    // 实现：按下方原点常规布局后，成员 Y 绕 team 行翻转（y'=2*baseY-y-AV），
    // 再整体平移使 team 底部距根顶 ROW_GAP*3；边从根顶锚点落到 team 底锚点。
    if (unassignedCols.length > 0) {
      const blockNodeIds = new Set<string>();
      for (const col of unassignedCols) {
        blockNodeIds.add(`team-${col.teamId}`);
        for (const aid of col.memberIds) blockNodeIds.add(`agent-${col.teamId}-${aid}`);
      }
      const baseY = contentY;
      const AV = 48; // 与 addTeamColumns 头像尺寸一致
      const unBlock = addTeamColumns(
        unassignedCols,
        { x: 0, y: baseY },
        null,
        true,
      );
      const dy = -(baseY + NODE_H + ROW_GAP * 3);
      for (const n of nodes) {
        if (!blockNodeIds.has(n.id)) continue;
        const isMember = n.id.startsWith("agent-");
        const flippedY = isMember
          ? 2 * baseY - n.position.y - AV // 成员镜像到 team 行上方
          : n.position.y; // team 节点不动
        n.position = { x: n.position.x, y: flippedY + dy };
        const ap = absPos.get(n.id);
        if (ap) ap.y = flippedY + dy;
      }
      maxRight = Math.max(maxRight, unBlock.w);
      for (const col of unassignedCols) {
        edges.push({
          id: `${companyId}->team-${col.teamId}`,
          source: companyId,
          sourceHandle: "top",
          target: `team-${col.teamId}`,
          targetHandle: "bottom-mirror",
          type: "smoothstep",
          style: { stroke: "var(--color-primary)" },
        });
      }
    }

    // 顶层组织容器（连线根，实线）
    topFolders.forEach((f) => {
      const placed = layoutFolder(f.id, { x: cursorX, y: cursorY }, null);
      edges.push({
        id: `${companyId}->${placed.id}`,
        source: companyId,
        sourceHandle: "bottom",
        target: placed.id,
        targetHandle: "mgr-head",
        type: "smoothstep",
        style: { stroke: "var(--color-primary)" },
      });
      rowH = Math.max(rowH, placed.h);
      cursorX += placed.w + COL_GAP;
      maxRight = Math.max(maxRight, cursorX);
      // 2026-11-03 拍板：组织带单行平齐（取消换行）——与上方 team 带同策略
    });

    // 2026-11-03 拍板：组织带与上方 team 带平齐对齐（都从 x=0 顶行起排，
    // 镜像对称）——自由成员池下移到组织带下方一行左侧
    if (looseAgentIds.length > 0) {
      cursorX = 0;
      cursorY += (rowH || 0) + (topFolders.length > 0 ? ROW_GAP : 0);
    }

    // 游离队友（无团队且无组织）→ 虚拟「自由成员」一级容器：只出不进、不可删、
    // 不进「移动到组织」菜单；成员渲染为普通 agent 节点（自带点击抽屉+右键加群）
    const UNASSIGNED_POOL_ID = "folder-__unassigned";
    if (looseAgentIds.length > 0) {
      const cols = Math.min(
        Math.max(Math.ceil(looseAgentIds.length / 6), 1),
        3,
      ); // 每列至多 6 人，至多 3 列
      const perCol = Math.ceil(looseAgentIds.length / cols);
      const poolW = cols * NODE_W + (cols - 1) * COL_GAP + FOLDER_PAD * 2;
      const poolH =
        Math.ceil(perCol) * (NODE_H + TEAMMATE_GAP) +
        FOLDER_PAD * 2 +
        FOLDER_TITLE_H;
      nodes.push({
        id: UNASSIGNED_POOL_ID,
        type: "folderGroup",
        position: { x: cursorX, y: cursorY },
        data: { label: "自由成员", folderId: null, isPool: true },
        draggable: false,
        selectable: false,
        style: { width: poolW, height: poolH },
      });
      absPos.set(UNASSIGNED_POOL_ID, { x: cursorX, y: cursorY });
      parentOf.set(UNASSIGNED_POOL_ID, null);
      // 2026-11-03 拍板：左侧收纳语义，不连线
      looseAgentIds.forEach((aid, i) => {
        const colIdx = Math.floor(i / perCol);
        const rowIdx = i % perCol;
        const nodeId = `loose-${aid}`;
        const ax = cursorX + FOLDER_PAD + colIdx * (NODE_W + COL_GAP);
        const ay =
          cursorY +
          FOLDER_TITLE_H +
          FOLDER_PAD +
          rowIdx * (NODE_H + TEAMMATE_GAP);
        nodes.push({
          id: nodeId,
          type: "agent",
          position: { x: ax, y: ay },
          data: {
            label: agents[aid].name,
            agentId: aid,
            color: agentColor(aid),
            avatarShape: agents[aid].avatar_shape ?? null,
            avatarColor: agents[aid].avatar_color ?? null,
            isLeader: false,
            teamId: null,
          },
        });
        absPos.set(nodeId, { x: ax, y: ay });
        parentOf.set(nodeId, UNASSIGNED_POOL_ID);
      });
      rowH = Math.max(rowH, poolH);
      maxRight = Math.max(maxRight, cursorX + poolW);
    }


    // 根节点按总宽居中（放最后，用实测宽度）
    const totalW = Math.max(maxRight - COL_GAP, NODE_W);
    // 2026-11-03 拍板：根定位自适应组织带——取首尾顶层组织容器锚点中心
    //（容器宽中心，即管理者头像头顶位置）的 min-max midpoint（同法），
    // 根下边线中点正对组织带平行线中点；无组织回落整幅宽居中
    const rootAnchorCenters: number[] = [];
    for (const f of topFolders) {
      const gp = nodes.find((n) => n.id === `folder-${f.id}`);
      if (gp)
        rootAnchorCenters.push(
          absPos.get(gp.id)!.x +
          (typeof gp.style?.width === "number" ? gp.style.width : NODE_W) / 2,
        );
    }
    const rootMid = rootAnchorCenters.length
      ? (Math.min(...rootAnchorCenters) + Math.max(...rootAnchorCenters)) / 2
      : totalW / 2;
    // 2026-11-03 拍板续：team 带中点自适应——上方 team 块整体水平平移，
    // 使其首尾锚点中点对准 rootMid（根上边线中点），上下连线双对称
    if (unassignedCols.length > 0) {
      const teamCenters: number[] = [];
      for (const col of unassignedCols) {
        const tp = absPos.get(`team-${col.teamId}`);
        if (tp) teamCenters.push(tp.x + NODE_W / 2);
      }
      if (teamCenters.length > 0) {
        const teamMid =
          (Math.min(...teamCenters) + Math.max(...teamCenters)) / 2;
        const dxTeam = rootMid - teamMid;
        if (dxTeam !== 0) {
          for (const n of nodes) {
            const isTeamBlock =
              unassignedCols.some((c) => n.id === `team-${c.teamId}`) ||
              unassignedCols.some((c) =>
                n.id.startsWith(`agent-${c.teamId}-`),
              );
            if (!isTeamBlock) continue;
            n.position = { x: n.position.x + dxTeam, y: n.position.y };
            const ap = absPos.get(n.id);
            if (ap) ap.x += dxTeam;
          }
        }
      }
    }
    nodes.push({
      id: companyId,
      type: "company",
      position: { x: rootMid - NODE_W / 2, y: 0 },
      data: { label: "AI 组织" },
      draggable: false,
      selectable: false,
    });
    absPos.set(companyId, { x: rootMid - NODE_W / 2, y: 0 });
    parentOf.set(companyId, null);
  } else {
    // 子画布：根 folder 自身不再画容器（不自包）——company 节点即本层，
    // 直属 teams 顶层布局，子 folder 容器照常（每行 4 个换行）。
    const folder = aiOrg.folders.find((f) => f.id === rootFolderId);
    if (!folder) return { nodes: [], edges: [] };

    const contentY = NODE_H + ROW_GAP * 2;
    const teamCols = teamColumnsOf(rootFolderId);
    const teamsBlock = addTeamColumns(teamCols, { x: 0, y: contentY }, null);
    for (const col of teamCols) {
      edges.push({
        id: `${companyId}->team-${col.teamId}`,
        source: companyId,
        target: `team-${col.teamId}`,
        type: "smoothstep",
        style: { stroke: "var(--color-primary)" },
      });
    }

    const childFolders = aiOrg.folders.filter(
      (f) => f.parentId === rootFolderId,
    );
    const perRow = Math.min(Math.max(childFolders.length, 1), FOLDER_WRAP);
    const forestY =
      contentY + (teamsBlock.h > 0 ? teamsBlock.h + FOLDER_BLOCK_GAP : 0);
    let cursorX = 0;
    let cursorY = forestY;
    let rowH = 0;
    let maxRight = teamsBlock.w;
    childFolders.forEach((f) => {
      const placed = layoutFolder(f.id, { x: cursorX, y: cursorY }, null);
      edges.push({
        id: `${companyId}->${placed.id}`,
        source: companyId,
        sourceHandle: "bottom",
        target: placed.id,
        targetHandle: "mgr-head",
        type: "smoothstep",
        style: { stroke: "var(--color-primary)" },
      });
      rowH = Math.max(rowH, placed.h);
      cursorX += placed.w + COL_GAP;
      maxRight = Math.max(maxRight, cursorX);
      if (cursorX / (NODE_W + COL_GAP) >= perRow) {
        cursorX = 0;
        cursorY += rowH + ROW_GAP;
        rowH = 0;
      }
    });

    const totalW = Math.max(maxRight - COL_GAP, NODE_W);
    // 根节点定位按「实际子锚点中心」min-max midpoint——totalW/2 是
    // 块几何中点，群块宽不等时 ≠ 各群节点中心的对称中点，致管理者偏移
    const anchorCenters: number[] = [];
    for (const col of teamCols)
      anchorCenters.push(absPos.get(`team-${col.teamId}`)!.x + NODE_W / 2);
    for (const f of childFolders) {
      const gp = nodes.find((n) => n.id === `folder-${f.id}`);
      if (gp)
        anchorCenters.push(
          absPos.get(gp.id)!.x +
            (typeof gp.style?.width === "number" ? gp.style.width : NODE_W) /
              2,
        );
    }
    const mid = anchorCenters.length
      ? (Math.min(...anchorCenters) + Math.max(...anchorCenters)) / 2
      : totalW / 2;
    nodes.push({
      id: companyId,
      type: "company",
      position: { x: mid - NODE_W / 2, y: 0 },
      data: {
        label: folder.name,
        managerName: managers[rootFolderId]?.name ?? null,
        managerAgentId: managers[rootFolderId]?.agentId ?? null,
        // 头像机制继承——AgentAvatar shape×color + 哈希色兜底
        managerAvatarShape: managers[rootFolderId]?.avatarShape ?? null,
        managerAvatarColor: managers[rootFolderId]?.avatarColor ?? null,
      },
      draggable: false,
      selectable: true,
    });
    absPos.set(companyId, { x: totalW / 2 - NODE_W / 2, y: 0 });
    parentOf.set(companyId, null);
  }

  // post-pass：转父相对坐标 + parentId/extent
  for (const n of nodes) {
    const pid = parentOf.get(n.id) ?? null;
    const abs = absPos.get(n.id) ?? n.position;
    if (pid) {
      const parentAbs = absPos.get(pid)!;
      n.position = { x: abs.x - parentAbs.x, y: abs.y - parentAbs.y };
      (n as Node & { parentId?: string; extent?: string }).parentId = pid;
      (n as Node & { extent?: string }).extent = "parent";
    } else {
      n.position = abs;
    }
  }

  // React Flow parentNode 约束：父节点必须先于子节点出现在数组中
  // （递归布局天然先子后父——按祖先链深度稳定重排，容器先于内容）。
  const depthCache = new Map<string, number>();
  const chainDepth = (id: string): number => {
    if (depthCache.has(id)) return depthCache.get(id)!;
    const pid = parentOf.get(id) ?? null;
    const d = pid ? chainDepth(pid) + 1 : 0;
    depthCache.set(id, d);
    return d;
  };
  nodes.sort((a, b) => chainDepth(a.id) - chainDepth(b.id));

  return { nodes, edges };
}

// ── Main Component ────────────────────────────────────────────────────────

function OrgChartInner() {
  const params = useParams<{ folderPath?: string[] }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  // ?focusTeam= 群聚焦下钻（挂在当前组织路径上，面包屑可返回）
  const focusTeamId = searchParams.get("focusTeam");
  const folderPath = params?.folderPath ?? [];
  const { data: agents, failures: agentsFailures, refresh: refreshAgents } = usePolling<
    Record<string, AgentConfig>
  >(getAgents, 0);
  const { data: teams, refresh: refreshTeams } = usePolling<
    Record<string, TeamConfig>
  >(getTeams, 0);
  const { fitView } = useReactFlow();

  // AI 组织状态接入 usePolling 退避网——
  // intervalMs=0 语义=「拉到成功为止」，冷启动 503
  // 窗口自动重试；成功后靠事件驱动刷新（见下方 effect）。原一次性 fetch+
  // 静默 catch 是竞态唯一受害面（组织永久消失），与 agents/teams 同律根治。
  const { data: aiOrgData, failures: orgsFailures, refresh: refreshAiOrg } =
    usePolling<AiOrgState & { managers?: Record<string, string> }>(loadAiOrgFromEngine, 0);
  // 全局相位——错误出口按相位校准（hooks
  // 规则：顶层调用，不在下方 !agents 早退分支内）。
  const connectionPhase = useConnectionPhase();
  // 非 ready 态的错误出口一律让位 root 横幅（单点诊断+重试，消除同屏
  // 重复与错误归因）；ready 态保留本链独立出口（端点级故障场景）。
  const phaseNotReady = connectionPhase !== "ready";
  const aiOrg: AiOrgState = aiOrgData ?? { version: 1, folders: [], teamFolder: {} };
  // orgId→managerId 映射（引擎 /api/pyb-orgs 携带）
  // 指挥室抽屉状态（orgId 锚定；与 agent/team 抽屉互斥）
  const [cmdRoomOrgId, setCmdRoomOrgId] = useState<string | null>(null);
  // 同步 ref——桥闭包读最新值做 toggle（effect deps 不含 opening，
  // 闭包 state 恒 stale；ref 旁路）
  const cmdRoomOrgIdRef = useRef<string | null>(null);
  const setCmdRoom = useCallback((v: string | null) => {
    cmdRoomOrgIdRef.current = v;
    setCmdRoomOrgId(v);
  }, []);
  const [orgManagers, setOrgManagers] = useState<Record<string, string>>({});
  // 管理者映射随 polling 数据播种（改名处 L~2162 仍有
  // 直写回填，故保留 state 形态；polling 成功即覆写回引擎真相）。
  useEffect(() => {
    setOrgManagers(aiOrgData?.managers ?? {});
  }, [aiOrgData]);
  // folderHref 产出 org_id URL——重命名不断链（id 是
  // 稳定锚），slug 名字段退役（旧 URL 由 rootFolderId 解析的兼容回退+
  // router.replace 渐进迁移）。
  const folderHref = useCallback(
    (id: string) =>
      `/company/${folderPathOf(aiOrg.folders, id)
        .map((f) => encodeURIComponent(f.id))
        .join("/")}`,
    [aiOrg],
  );

  // C 柱（真机修正）：组织节点标题栏原生 onClick 桥——parent 容器收不到
  // React Flow onNodeClick，经模块级桥直达此处理器（单击=管理者 DM/回落
  // 子画布，双击恒进子画布）。
  // 镜头函数经 ref 中转（本 effect 位于 focusFolderCamera/exitCameraFocus
  // 定义之前，依赖数组直接引用会 TDZ；ref 挂载 effect 在其后运行保序）。
  const cameraFnRef = useRef<{
    focus: (fid: string) => void;
    exit: () => void;
  }>({ focus: () => {}, exit: () => {} });
  useEffect(() => {
    // 容器空白区点击桥——静默幂等创建指挥室再开抽屉。
    // 单击空白=镜头聚焦+开指挥室叠加——
    // 与团队节点 focusTeamCamera 同款 2.5D 飞越（flyToFocus 子集 fitView）；
    // 同室点击=关抽屉+退出聚焦（两者同开同收，手势一致）。
    orgBodyClickBridge = (fid: string) => {
      if (!fid) return;
      // 优化：乐观切换（与团队行 openTeam 同级瞬时）——同室点击=关，
      // 异室=立即切（不等 createOrgRoom HTTP 往返；创建后台跑，失败 alert）
      if (cmdRoomOrgIdRef.current === fid) {
        setCmdRoom(null);
        setEditPanelOpen(false);
        cameraFnRef.current.exit();
        return;
      }
      agentDrawerRef.current?.close();
      setSelectedTeamId(null);
      setTeamForm(null);
      setEditPanelOpen(false);
      setCmdRoom(fid);
      // 镜头聚焦与团队同构（flyToFocus 收集子组织+群+成员飞越拉近）
      cameraFnRef.current.focus(fid);
      // 进室即 mark 已读（徽标熄灭）+ 幂等创建后台执行不阻塞切换
      void markPybRead(`cmdroom_${fid}`).catch(() => {});
      void createOrgRoom(fid).catch((err: unknown) => {
        window.alert(`指挥室创建失败：${err instanceof Error ? err.message : String(err)}`);
      });
    };
    orgTitleClickBridge = (fid: string) => {
      const mgr = orgManagers[fid];
      // 删零团队拦截（零团队组织指挥室照常运转，
      // org-ui 时期展示层裁定已过时）
      if (mgr) {
        setSelectedTeamId(null);
        setTeamForm(null);
        agentDrawerRef.current?.open(mgr, { orgId: fid, teamId: null });
      } else {
        router.push(folderHref(fid));
      }
    };
    orgTitleDblClickBridge = (fid: string) => router.push(folderHref(fid));
    folderCtxMenuBridge = (fid, x, y) => {
      const f = aiOrg.folders.find((fo) => fo.id === fid);
      setNodeCtx({
        x,
        y,
        kind: "folder",
        folderId: fid,
        folderName: f?.name ?? "",
      });
    };
    return () => {
      orgTitleClickBridge = null;
      orgBodyClickBridge = null;
      orgTitleDblClickBridge = null;
      folderCtxMenuBridge = null;
    };
  }, [orgManagers, folderHref, router, aiOrg]);
  // 组织数据加载已迁 usePolling；本 effect 只剩迁移
  // 钩子 + 事件→refresh 接线。SSE_RECONNECTED_EVENT 补齐断线期组织
  // 变更（SSE 无重放，重连即全量重拉——snapshot 语义，chat 链先例）。
  useEffect(() => {
    void migrateLegacyAiOrgIfNeeded().catch(() => {
      /* 迁移失败不阻塞加载 */
    });
    const onChanged = () => {
      // snapshot 语义：重连即全量重拉三路（SSE 无重放，断线期变更靠此补齐）
      refreshAiOrg();
      refreshAgents();
      refreshTeams();
    };
    window.addEventListener(AI_ORG_CHANGED_EVENT, onChanged);
    window.addEventListener(SSE_RECONNECTED_EVENT, onChanged);
    // roster 直听（按 scope 分派三路刷新）——不依赖 sidebar 转译存活：
    // teammate 经工具创建/删除 agent/team 时引擎推 roster_changed，若只
    // 转译链可达会因 agents/teams 无转译而永不刷新（三数据源单次加载无
    // 轮询兜底）。all/缺省兜底全刷，防跨 scope 变更漏刷。
    const onRosterChanged = (e: Event) => {
      const kind = (e as CustomEvent<{ kind?: string }>).detail?.kind;
      if (kind === "agents" || kind === "all" || !kind) {
        refreshAgents();
        // agent 挂靠关系（state.orgId）随创建/assign 变——画布归位依赖
        // aiOrg.agentOrg 映射（agents API org_id 投影），agents 事件同样
        // 需要重拉 org 投影（444 真机案：DevVerify04 已挂靠 444 但画布落
        // 自由成员容器——对齐 City 页三路全刷形态）。
        refreshAiOrg();
      }
      if (kind === "teams" || kind === "all" || !kind) refreshTeams();
      if (kind === "orgs" || kind === "all" || !kind) refreshAiOrg();
    };
    window.addEventListener(ROSTER_CHANGED_EVENT, onRosterChanged);
    return () => {
      window.removeEventListener(AI_ORG_CHANGED_EVENT, onChanged);
      window.removeEventListener(SSE_RECONNECTED_EVENT, onChanged);
      window.removeEventListener(ROSTER_CHANGED_EVENT, onRosterChanged);
    };
  }, [refreshAiOrg, refreshAgents, refreshTeams]);

  // 路由路径 → 目标 folder——org_id 直查优先（每段
  // decodeURIComponent 后按 id 精确命中），slug 名字段仅作旧 URL 兼容
  // 回退（命中后经 router.replace 重定向到 id 形态——收藏/历史不断链
  // 且渐进迁移）。
  const { rootFolderId, breadcrumb, legacySlugHit } = useMemo(() => {
    let parentId: string | null = null;
    const trail: Array<{ id: string; name: string }> = [];
    let legacy = false;
    for (const segRaw of folderPath) {
      const seg = decodeURIComponent(segRaw);
      const byId = aiOrg.folders.find((f) => f.id === seg) ?? null;
      const hit: AiOrgFolder | null =
        byId && byId.parentId === parentId
          ? byId
          : resolveFolderBySlug(aiOrg.folders, parentId, seg);
      if (!hit)
        return {
          rootFolderId: null as string | null,
          breadcrumb: trail,
          legacySlugHit: false,
        };
      if (hit.id !== seg) legacy = true;
      trail.push({ id: hit.id, name: hit.name });
      parentId = hit.id;
    }
    return { rootFolderId: parentId, breadcrumb: trail, legacySlugHit: legacy };
  }, [folderPath, aiOrg]);

  // 旧 slug URL → 重定向到 id 形态（一次性替换，不留在历史栈）
  useEffect(() => {
    if (legacySlugHit && rootFolderId) {
      const idPath = folderPathOf(aiOrg.folders, rootFolderId)
        .map((f) => encodeURIComponent(f.id))
        .join("/");
      if (idPath) router.replace(`/company/${idPath}`);
    }
  }, [legacySlugHit, rootFolderId, aiOrg, router, folderPath]);

  // 成员/群点击 → overlay 抽屉（从右滑入，不压缩画布）
  // 成员抽屉态（窗上下文/cardFlipped/右栏三态/双栏宽度）内聚 AgentDrawer
  // 组件——本页仅持 ref 句柄与互斥回调。
  const agentDrawerRef = useRef<AgentDrawerHandle>(null);
  const [agentDrawerAgentId, setAgentDrawerAgentId] = useState<string | null>(null);
  const handleAgentDrawerOpen = useCallback((id: string) => {
    // 互斥：成员抽屉开=清群/指挥室态
    setSelectedTeamId(null);
    setTeamForm(null);
    setCmdRoom(null);
    setAgentDrawerAgentId(id);
  }, []);
  const handleAgentDrawerClose = useCallback(() => {
    setAgentDrawerAgentId(null);
  }, []);
  // 群/指挥室抽屉的右栏显隐与三态（agent 分支已内聚 AgentDrawer 组件）
  const [editPanelOpen, setEditPanelOpen] = useState(false);
  const [rightPane, setRightPane] = useState<"edit" | "schedule">("edit");
  const openRightPane = (pane: "edit" | "schedule") => {
    if (editPanelOpen && rightPane === pane) {
      // 再点当前段=收起（凹陷分段双钮第三态）
      setEditPanelOpen(false);
      return;
    }
    setRightPane(pane);
    setEditPanelOpen(true);
  };
  // 抽屉宽度：默认窗口 1/3，左边缘可拖拽调节（360px~85vw 钳制），localStorage 记忆
  const DRAWER_W_KEY = "pyb-desktop_drawer_chat_width";
  const [drawerW, setDrawerW] = useState(440);
  const drawerWRef = useRef(440);
  const [resizing, setResizing] = useState(false);


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
  }, []);
  // 窗口缩放（全屏→小窗）实时钳制两栏宽度——否则记忆值超 85vw 时抽屉
  // 被 maxWidth 压变形、左缘越过侧栏（真机反馈）。
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
    // 增量式拖拽：以按下点为基准按位移量改宽——绝对定位式（宽=视口-鼠标x）
    // 在鼠标与边界有几像素偏差时首次 move 即「瞬移」跳线（真机反馈）。
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
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);

  // ── 镜头式聚焦状态群 ─────────────────────────
  // 瞬态 UI 态（不进 URL，刷新即丢，与 ?focusTeam= 下钻持久路由分层）。
  // focusedTeamId/focusedFolderId 互斥；null=全景态。
  const [focusedTeamId, setFocusedTeamId] = useState<string | null>(null);
  const [focusedFolderId, setFocusedFolderId] = useState<string | null>(null);

  // 镜头飞越——节点子集 fitView 平滑飞过去，世界不重建。
  // padding 不对称：右侧聊天抽屉开着时给抽屉让位（Padding 原生支持对象
  // 形式 {top,right,bottom,left}），关着时对称 0.3。
  const flyToFocus = useCallback(
    (ids: string[]) => {
      if (ids.length === 0) return;
      const drawerOpenNow =
        !!(agentDrawerAgentId || selectedTeamId || cmdRoomOrgIdRef.current);
      void fitView({
        nodes: ids.map((id) => ({ id })),
        duration: 600,
        maxZoom: 1.2,
        interpolate: "smooth",
        padding: drawerOpenNow
          ? {
              top: 0.2,
              right: `${Math.round(drawerWRef.current) + 24}px`,
              bottom: 0.2,
              left: 0.2,
            }
          : 0.3,
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fitView, agentDrawerAgentId, selectedTeamId],
  );

  // 聚焦群——team-{id} + agent-{teamId}-{aid}×memberIds（复合 id
  // 规约：一人多群=多实例，天然只亮本群实例）。明暗分层经 nodes useMemo
  // 的 focusedTeamId/focusedFolderId 依赖渲染。
  const focusTeamCamera = useCallback(
    (teamId: string) => {
      const team = teams?.[teamId];
      const ids = [`team-${teamId}`];
      if (team) {
        for (const aid of team.agents) ids.push(`agent-${teamId}-${aid}`);
      }
      setFocusedFolderId(null);
      setFocusedTeamId(teamId);
      flyToFocus(ids);
    },
    [teams, flyToFocus],
  );

  // 聚焦组织——folder-{id} 容器+递归全部子孙（parentId 真嵌套多级
  // 组织，一层扫描会漏子组织）：子组织容器→群→群成员。
  const focusFolderCamera = useCallback(
    (folderId: string) => {
      const ids = new Set<string>([`folder-${folderId}`]);
      const collectFolder = (fid: string) => {
        for (const f of aiOrg.folders) {
          if (f.parentId === fid) {
            ids.add(`folder-${f.id}`);
            collectFolder(f.id);
          }
        }
        for (const [tid, ofid] of Object.entries(aiOrg.teamFolder)) {
          if (ofid !== fid) continue;
          ids.add(`team-${tid}`);
          const t = teams?.[tid];
          if (t) for (const aid of t.agents) ids.add(`agent-${tid}-${aid}`);
        }
      };
      collectFolder(folderId);
      setFocusedTeamId(null);
      setFocusedFolderId(folderId);
      flyToFocus([...ids]);
    },
    [aiOrg, teams, flyToFocus],
  );

  // 退出聚焦——清状态+动画回全景（三入口共用：ESC/浮钮/点空白）
  const exitCameraFocus = useCallback(() => {
    if (!focusedTeamId && !focusedFolderId) return false;
    setFocusedTeamId(null);
    setFocusedFolderId(null);
    void fitView({ padding: 0.3, duration: 600, interpolate: "smooth" });
    return true;
  }, [focusedTeamId, focusedFolderId, fitView]);
  // 镜头函数挂 ref（orgBodyClickBridge 定义在前，经 ref 中转免 TDZ）
  useEffect(() => {
    cameraFnRef.current = {
      focus: focusFolderCamera,
      exit: () => void exitCameraFocus(),
    };
  }, [focusFolderCamera, exitCameraFocus]);
  // ── 聚焦状态群结束 ────────────────────────────────────────────────

  // ESC 退出聚焦（三入口之二；输入框/rename 聚焦时不抢——blur 或
  // 仅在无 activeElement 输入态时触发）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const el = document.activeElement;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)
        return; // 输入态的 ESC 归输入控件（取消/失焦），不抢
      exitCameraFocus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [exitCameraFocus]);
  // 编辑/身份栏宽度：与聊天框分界线可拖拽（240~600 钳制，聊天框宽度不
  // 联动——拖拽时抽屉总宽随编辑栏伸缩），localStorage 记忆（默认 320）。
  const EDIT_W_KEY = "pyb-desktop_drawer_edit_width";
  const [editW, setEditW] = useState(320);
  const editWRef = useRef(320);
  const [editResizing, setEditResizing] = useState(false);
  useEffect(() => {
    let init = 320;
    try {
      const saved = Number(window.localStorage.getItem(EDIT_W_KEY));
      if (saved >= 240 && saved <= 600) init = saved;
    } catch {
      /* 静默 */
    }
    setEditW(init);
    editWRef.current = init;
  }, []);
  const startEditResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setEditResizing(true);
    // 增量式拖拽（同抽屉左柄）：按位移量改宽，线钉在鼠标下不跳。
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
  const [teamForm, setTeamForm] = useState<TeamFormData | null>(null);
  const [teamSaving, setTeamSaving] = useState(false);
  const [teamError, setTeamError] = useState("");

  const openTeam = useCallback(
    (teamId: string, team: TeamConfig | undefined) => {
      if (!team) return;
      setCmdRoom(null);
      agentDrawerRef.current?.close();
      setAgentDrawerAgentId(null);
      setSelectedTeamId(teamId);
      setEditPanelOpen(false);
      setTeamForm({
        id: teamId,
        name: team.name,
        description: team.description ?? "",
        agents: [...new Set(team.agents)],
        leader: team.agents.includes(team.leader_agent)
          ? team.leader_agent
          : "",
      });
      setTeamError("");
    },
    [],
  );

  const onNodeClick = useCallback(
    (_: unknown, node: Node) => {
      if (
        node.type === "company" &&
        typeof node.data.managerAgentId === "string"
      ) {
        // 子画布根节点横幅=管理者 DM 入口。
        // 画布化：再点同一节点=收回抽屉（toggle）。互斥清指挥室。
        setSelectedTeamId(null);
        setTeamForm(null);
        setCmdRoom(null);
        const mgrId = node.data.managerAgentId as string;
        agentDrawerRef.current?.open(mgrId, { orgId: rootFolderId, teamId: null });
      } else if (node.type === "agent" && typeof node.data.agentId === "string") {
        setSelectedTeamId(null);
        setTeamForm(null);
        setCmdRoom(null);
        const agentId = node.data.agentId as string;
        // 记录窗 teamId（data.teamId 团队列成员=群 id；org 直挂成员/
        // 管理者节点=null——node.data.teamId 在两类节点上均有定义）。
        const nodeTeamId =
          typeof node.data.teamId === "string" ? node.data.teamId : null;
        agentDrawerRef.current?.open(agentId, { orgId: rootFolderId, teamId: nodeTeamId });
      } else if (node.type === "team" && typeof node.data.teamId === "string") {
        // 画布化：再点同一群=收回抽屉（toggle；非同群则正常切换）
        agentDrawerRef.current?.close();
        if (selectedTeamId === node.data.teamId) {
          setSelectedTeamId(null);
          setTeamForm(null);
          setEditPanelOpen(false);
        } else {
          openTeam(node.data.teamId, teams?.[node.data.teamId as string]);
          // 单击组合式——开抽屉的同时镜头飞到该群（抽屉开在看的
          // 地方，一次点击双效果；同心智交互）
          focusTeamCamera(node.data.teamId as string);
        }
      } else if (
        node.type === "folderGroup" &&
        typeof node.data.folderId === "string"
      ) {
        // 组织节点=与组织管理者对话的入口
        // （「对用户 UI 呈现为组织节点」）。有管理者映射→开 DM；无→
        // 回落子画布导航（渐进增强）。双击恒进子画布。
        const mgr = orgManagers[node.data.folderId];
        // 删零团队拦截；本分支为 parent 容器兜底
        //（C 柱：parent 不派发 onNodeClick，实际走原生桥）
        if (mgr) {
          setSelectedTeamId(null);
          setTeamForm(null);
          // org 节点开管理者 DM——窗=被点的 org（folderGroup 节点的
          // folderId；从根画布进入时 rootFolderId=null，必须用节点值）。
          const nodeOrgId = node.data.folderId as string;
          agentDrawerRef.current?.open(mgr, { orgId: nodeOrgId, teamId: null });
        } else {
          router.push(folderHref(node.data.folderId));
        }
      }
    },
    [teams, openTeam, router, folderHref, orgManagers, aiOrg, selectedTeamId, focusTeamCamera],
  );

  const saveTeamForm = useCallback(async () => {
    if (!teamForm || !selectedTeamId) return;
    setTeamSaving(true);
    setTeamError("");
    try {
      await savePybTeam(selectedTeamId, {
        members: teamForm.agents,
        ...(teamForm.name.trim() ? { name: teamForm.name.trim() } : {}),
        ...(teamForm.description.trim()
          ? { description: teamForm.description.trim() }
          : {}),
        leader: teamForm.leader || "",
      });
      refreshTeams();
    } catch (err) {
      setTeamError((err as Error).message);
    } finally {
      setTeamSaving(false);
    }
  }, [teamForm, selectedTeamId, refreshTeams]);

  // ── 右键菜单（成员/群/folder 三态） ─────────────────────────────────────
  const [nodeCtx, setNodeCtx] = useState<{
    x: number;
    y: number;
    kind: "agent" | "team" | "folder";
    agentId?: string;
    agentName?: string;
    sourceTeamId?: string | null;
    teamId?: string;
    teamName?: string;
    folderId?: string;
    folderName?: string;
  } | null>(null);
  const [openSubmenu, setOpenSubmenu] = useState<
    "join" | "joinOrg" | "move" | null
  >(null);
  const closeCtxMenu = useCallback(() => {
    setNodeCtx(null);
    setOpenSubmenu(null);
  }, []);

  const showErr = useCallback((prefix: string, err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    window.alert(`${prefix}：${msg}`);
  }, []);

  const leaveTeam = useCallback(
    async (agentId: string, sourceTeamId: string) => {
      const team = teams?.[sourceTeamId];
      if (!team) return;
      if (team.agents.length <= 1) {
        if (!window.confirm(`「${team.name}」将变空群，是否解散？`)) return;
        try {
          await deletePybTeam(sourceTeamId);
          refreshTeams();
        } catch (err) {
          showErr("解散失败", err);
        }
        return;
      }
      try {
        await savePybTeam(sourceTeamId, {
          members: team.agents.filter((a) => a !== agentId),
        });
        refreshTeams();
      } catch (err) {
        showErr("退出失败（可能受 owner 保护限制）", err);
      }
    },
    [teams, refreshTeams, showErr],
  );

  const deleteAgentOp = useCallback(
    async (agentId: string, agentName: string) => {
      if (
        !window.confirm(
          `确定删除 ${agentName}？它将从所有群中移除，此操作不可撤销。`,
        )
      )
        return;
      try {
        await deletePybAgent(agentId);
        agentDrawerRef.current?.close();
        refreshAgents();
      } catch (err) {
        showErr("删除失败", err);
      }
    },
    [refreshAgents, showErr],
  );

  const joinTeam = useCallback(
    async (agentId: string, targetTeamId: string) => {
      const team = teams?.[targetTeamId];
      if (!team || team.agents.includes(agentId)) return;
      try {
        await savePybTeam(targetTeamId, { members: [...team.agents, agentId] });
        refreshTeams();
      } catch (err) {
        showErr("加入失败", err);
      }
    },
    [teams, refreshTeams, showErr],
  );

  const dissolveTeam = useCallback(
    async (teamId: string, teamName: string) => {
      if (!window.confirm(`确定解散群「${teamName}」？此操作不可撤销。`))
        return;
      try {
        await deletePybTeam(teamId);
        if (selectedTeamId === teamId) {
          setSelectedTeamId(null);
          setTeamForm(null);
        }
        refreshTeams();
      } catch (err) {
        showErr("解散失败", err);
      }
    },
    [selectedTeamId, refreshTeams, showErr],
  );

  // team 移动到 folder / folder CRUD
  const applyAiOrg = useCallback(() => {
    // 引擎源——事件触发各组件自行 reload（不再本地写态）
    window.dispatchEvent(new Event(AI_ORG_CHANGED_EVENT));
  }, []);

  const moveTeam = useCallback(
    async (teamId: string, folderId: string | null) => {
      try {
        await engineMoveTeamToFolder(teamId, folderId);
        applyAiOrg();
      } catch (err) {
        showErr("移动失败", err);
      }
    },
    [applyAiOrg, showErr],
  );

  // 群内设为/取消队长。PUT 全量回写显式带 leader
  // （设新=引擎自动清旧标签=每群唯一；""=取消；读写均走 role 标签真相源）。
  const setLeader = useCallback(
    async (agentId: string, teamId: string, leader: boolean) => {
      const team = teams?.[teamId];
      if (!team || !team.agents.includes(agentId)) return;
      try {
        await savePybTeam(teamId, {
          members: team.agents,
          leader: leader ? agentId : "",
        });
        refreshTeams();
      } catch (err) {
        showErr(leader ? "设为队长失败" : "取消队长失败", err);
      }
    },
    [teams, refreshTeams, showErr],
  );

  // 成员挂/换挂/移出组织三合一。
  // 引擎 assign-agent 为覆盖式——folderId 非空即挂靠（已挂他组织=静默换挂），
  // null 即摘除回「自由成员」池。准入过滤在菜单层（唯一执法层，引擎零校验）。
  const joinOrg = useCallback(
    async (agentId: string, folderId: string | null) => {
      try {
        await engineAssignAgentToOrg(agentId, folderId);
        applyAiOrg();
      } catch (err) {
        showErr(folderId ? "加入组织失败" : "移出组织失败", err);
      }
    },
    [applyAiOrg, showErr],
  );

  const [renameTarget, setRenameTarget] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [renameInput, setRenameInput] = useState("");

  const doDeleteFolder = useCallback(
    async (folderId: string, folderName: string) => {
      const childCount = aiOrg.folders.filter(
        (f) => f.parentId === folderId,
      ).length;
      const teamCount = Object.values(aiOrg.teamFolder).filter(
        (fid) => fid === folderId,
      ).length;
      // 管理者 teammate 随组织连带真删（引擎级联）——
      // 文案明示去向；成功后 refreshAgents 让队友列表即时收敛（SSE 兜底外
      // 的主动刷新）。
      const msg =
        childCount + teamCount > 0
          ? `删除组织「${folderName}」？其中 ${childCount} 个子组织将上提到其父级，${teamCount} 个群将释放到 AI 组织未分配区，组织管理者将一并删除。`
          : `删除组织「${folderName}」？群（若有）将释放到 AI 组织未分配区，组织管理者将一并删除。`;
      if (!window.confirm(msg)) return;
      try {
        await engineDeleteFolder(folderId);
        applyAiOrg();
        refreshAgents();
      } catch (err) {
        showErr("删除失败", err);
      }
    },
    [aiOrg, applyAiOrg, showErr, refreshAgents],
  );

  const onNodeContextMenu = useCallback(
    (e: MouseEvent | React.MouseEvent, node: Node) => {
      e.preventDefault();
      if (node.type === "agent" && typeof node.data.agentId === "string") {
        setOpenSubmenu(null);
        setNodeCtx({
          x: (e as MouseEvent).clientX,
          y: (e as MouseEvent).clientY,
          kind: "agent",
          agentId: node.data.agentId,
          agentName: node.data.label as string,
          sourceTeamId: (node.data.teamId as string | null) ?? null,
        });
      } else if (node.type === "team" && typeof node.data.teamId === "string") {
        setOpenSubmenu(null);
        setNodeCtx({
          x: (e as MouseEvent).clientX,
          y: (e as MouseEvent).clientY,
          kind: "team",
          teamId: node.data.teamId,
          teamName: node.data.label as string,
        });
      } else if (
        node.type === "folderGroup" &&
        typeof node.data.folderId === "string"
      ) {
        setNodeCtx({
          x: (e as MouseEvent).clientX,
          y: (e as MouseEvent).clientY,
          kind: "folder",
          folderId: node.data.folderId,
          folderName: node.data.label as string,
        });
      } else if (node.type === "folderGroup" && node.data.isPool) {
        // 虚拟「自由成员」容器：系统组织，无右键菜单（只出不进/不可删）
      }
    },
    [],
  );

  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);
  const [createPanel, setCreatePanel] = useState<
    "agent" | "team" | "folder" | null
  >(null);
  const [newTeamForm, setNewTeamForm] = useState<TeamFormData>({
    id: "",
    name: "",
    description: "",
    agents: [],
    leader: "",
  });
  const [newAgentName, setNewAgentName] = useState("");
  const [newAgentDesc, setNewAgentDesc] = useState("");
  const [newFolderName, setNewFolderName] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");
  // 本群新建成员——创建浮层的锚定群（创建即入群实时渲染）；
  // 聚焦态自动锚定 focusTeam（画布锁定为该群视角）
  const [createForTeam, setCreateForTeam] = useState<string | null>(null);
  // org-ui 裁定：创建锚定组织——team=创建即挂靠（assign-team）；agent=暂无
  // org 挂靠数据位（任务2），创建后落自由成员池，用户可右键成员移入组织群
  const [createForFolder, setCreateForFolder] = useState<string | null>(null);

  const onPaneContextMenu = useCallback((e: MouseEvent | React.MouseEvent) => {
    e.preventDefault();
    setCtxMenu({ x: (e as MouseEvent).clientX, y: (e as MouseEvent).clientY });
  }, []);

  const openCreate = useCallback((kind: "agent" | "team" | "folder") => {
    // org-ui 修复：不再重置 createForFolder——此前「先锚定后 openCreate」
    // 被此 null 覆盖（React 批处理末值胜出），组织右键创建即挂靠全数失效。
    // 锚定与否由各调用点显式 setCreateForFolder 声明。
    setCtxMenu(null);
    setCreateError("");
    setCreatePanel(kind);
    if (kind === "team") {
      setNewTeamForm({ id: "", name: "", description: "", agents: [], leader: "" });
    } else if (kind === "agent") {
      setNewAgentName("");
      setNewAgentDesc("");
    } else {
      setNewFolderName("");
    }
  }, []);

  const createAgent = useCallback(async () => {
    if (!newAgentName.trim() || !newAgentDesc.trim()) {
      setCreateError("名称与描述均为必填（描述将成为人设）");
      return;
    }
    setCreating(true);
    setCreateError("");
    try {
      const res = await createPybAgent({
        name: newAgentName.trim(),
        description: newAgentDesc.trim(),
      });
      // org-ui 任务2：锚定组织时创建即挂靠（state.orgId——独立成员进组织）
      if (createForFolder) {
        await engineAssignAgentToOrg(res.agent_id, createForFolder);
        setCreateForFolder(null);
        applyAiOrg();
      }
      setCreatePanel(null);
      // 锚定群时创建即入群（savePybTeam 全量 members 回写）
      if (createForTeam && teams?.[createForTeam]) {
        const t = teams[createForTeam];
        if (!t.agents.includes(res.agent_id)) {
          await savePybTeam(createForTeam, {
            members: [...t.agents, res.agent_id],
          });
        }
        refreshTeams();
      }
      setCreateForTeam(null);
      setCreateForFolder(null);
      setCreatePanel(null);
      refreshAgents();
    } catch (err) {
      setCreateError((err as Error).message);
    } finally {
      setCreating(false);
    }
  }, [newAgentName, newAgentDesc, refreshAgents, createForTeam, teams, refreshTeams, createForFolder, applyAiOrg]);

  const createTeam = useCallback(async () => {
    if (!newTeamForm.name.trim() || newTeamForm.agents.length === 0) {
      setCreateError("团队名与至少一名成员必填");
      return;
    }
    // D 柱：群职能描述引擎必填——前端先拦（文案对齐引擎语义）
    if (!newTeamForm.description.trim()) {
      setCreateError("团队简介必填：一句话说明本团队职能（其功能/能力）");
      return;
    }
    setCreating(true);
    setCreateError("");
    try {
      const res = await createPybTeam({
        name: newTeamForm.name.trim(),
        description: newTeamForm.description.trim(),
        members: newTeamForm.agents,
        ...(newTeamForm.leader ? { leader: newTeamForm.leader } : {}),
      });
      // org-ui 裁定：锚定组织时创建即挂靠（宽创建闭环——组织右键建团队）
      if (createForFolder) {
        await engineMoveTeamToFolder(res.team_id, createForFolder);
        setCreateForFolder(null);
        applyAiOrg();
      }
      setCreatePanel(null);
      refreshTeams();
    } catch (err) {
      setCreateError((err as Error).message);
    } finally {
      setCreating(false);
    }
  }, [newTeamForm, refreshTeams, createForFolder, applyAiOrg]);

  const doCreateFolder = useCallback(() => {
    if (!newFolderName.trim()) {
      setCreateError("组织名必填");
      return;
    }
    // 层级封顶：已是第 3 层的子画布不允许再建子组织（与侧栏 + 号同律）
    if (breadcrumb.length >= 3) {
      setCreateError("已达最大层级（3 层），不能再创建子组织");
      return;
    }
    // 锚定优先——组织右键「新建」进来的组织创建
    // 落为本组织子组织（createForFolder），否则沿用子画布层级语义
    engineCreateFolder(newFolderName, createForFolder ?? rootFolderId)
      .then((res) => {
        // 引擎建组织时自动创建管理者 agent——
        // ①refreshAgents 重拉档案（mgrCfg 需 agents[aid] 与 orgManagers 同时
        //   成立，缺一则回落旧文字文件夹样式）；②返回体直写 orgManagers
        //   免事件竞态（applyAiOrg 的事件链最终会覆盖为引擎真相，双保险）
        refreshAgents();
        if (res.org_id && res.manager_agent_id) {
          setOrgManagers((prev) =>
            prev[res.org_id!] === res.manager_agent_id
              ? prev
              : { ...prev, [res.org_id!]: res.manager_agent_id! },
          );
        }
        applyAiOrg();
        setCreateForFolder(null);
        setCreatePanel(null);
      })
      .catch((err) => setCreateError(String(err)));
  }, [newFolderName, rootFolderId, createForFolder, applyAiOrg, refreshAgents, breadcrumb.length]);

  // picker/画布过滤——组织管理者不出现在可选
  // 列表与 agent 节点（「对用户 UI 呈现为组织节点」）。UI 一面过滤：
  // 引擎 /api/pyb-agents 行为不变（SendMessage 直接寻址不受影响）。
  const managerIds = useMemo(
    () => new Set(Object.values(orgManagers)),
    [orgManagers],
  );
  const visibleAgents = useMemo(() => {
    if (!agents || managerIds.size === 0) return agents;
    const out: Record<string, AgentConfig> = {};
    for (const [id, cfg] of Object.entries(agents)) {
      if (!managerIds.has(id)) out[id] = cfg;
    }
    return out;
  }, [agents, managerIds]);

  const { nodes, edges } = useMemo(() => {
    if (!agents) return { nodes: [], edges: [] };
    // 管理者档案从未过滤 agents 取（visibleAgents 已滤管理者）
    // 携头像字段——身份卡编辑的 shape×color 直达节点
    const mgrCfg: Record<
      string,
      { agentId: string; name: string; avatarShape?: string | null; avatarColor?: string | null }
    > = {};
    for (const [fid, aid] of Object.entries(orgManagers)) {
      const a = agents[aid];
      if (a && typeof a.name === "string")
        mgrCfg[fid] = {
          agentId: aid,
          name: a.name,
          avatarShape: a.avatar_shape ?? null,
          avatarColor: a.avatar_color ?? null,
        };
    }
    return buildAiOrgChart(
      visibleAgents ?? agents,
      teams ?? {},
      aiOrg,
      rootFolderId,
      mgrCfg,
      focusTeamId,
    );
  }, [visibleAgents, agents, teams, aiOrg, rootFolderId, orgManagers, focusTeamId]);

  // 明暗分层后处理——镜头聚焦态下按复合 id 判定归属：聚焦簇全亮，
  // 其余节点/连接边 opacity-40（淡化但可点——点另一群/组织直接切镜头）。
  // 归属判定与 focusTeamCamera/focusFolderCamera 的收集规约同源：
  //   team 聚焦 → team-{id} + agent-{teamId}-{aid}
  //   org 聚焦 → folder-{fid} 及其全部递归子孙容器内的群与成员
  const { nodes: styledNodes, edges: styledEdges } = useMemo(() => {
    if (!focusedTeamId && !focusedFolderId) return { nodes, edges };
    const inFocus = (nodeId: string) => {
      if (focusedTeamId) {
        if (nodeId === `team-${focusedTeamId}`) return true;
        return nodeId.startsWith(`agent-${focusedTeamId}-`);
      }
      // org 聚焦：递归收集聚焦组织的全部子孙 folder id
      const fidSet = new Set<string>([focusedFolderId!]);
      let grew = true;
      while (grew) {
        grew = false;
        for (const n of nodes) {
          const m = n.id.match(/^folder-(.+)$/);
          if (!m || fidSet.has(m[1])) continue;
          // 子组织容器：其 id 在 nodes 的 parentId 链上挂聚焦容器——经
          // aiOrg.folders 的 parentId 判定（真源）
          const folder = aiOrg.folders.find((f) => f.id === m[1]);
          if (folder && fidSet.has(folder.parentId ?? "")) {
            fidSet.add(m[1]);
            grew = true;
          }
        }
      }
      if (nodeId.startsWith("folder-")) return fidSet.has(nodeId.slice(7));
      // 群与成员：归属 folder 经 aiOrg.teamFolder
      if (nodeId.startsWith("team-")) {
        return fidSet.has(aiOrg.teamFolder[nodeId.slice(5)] ?? "");
      }
      const am = nodeId.match(/^agent-([^-]+)-/);
      if (am) {
        return fidSet.has(aiOrg.teamFolder[am[1]] ?? "");
      }
      return false;
    };
    const ns = nodes.map((n) =>
      inFocus(n.id)
        ? n
        : { ...n, className: `${n.className ?? ""} opacity-40 transition-opacity duration-500` },
    );
    const es = edges.map((e) => {
      const srcIn = inFocus(e.source);
      const tgtIn = inFocus(e.target);
      return srcIn && tgtIn
        ? e
        : {
            ...e,
            className: `${e.className ?? ""} opacity-40 transition-opacity duration-500`,
          };
    });
    return { nodes: ns, edges: es };
  }, [nodes, edges, focusedTeamId, focusedFolderId, aiOrg]);


  // 搜索聚焦（画布世界）：agent 节点 id 有三形态（团队列 agent-{tid}-{aid} /
  // 自由池 loose-{aid} / 直挂 orgdirect-{aid}）——按 data.agentId 扫节点最稳；
  // 管理者无独立节点（folder 容器 data.managerAgentId 承载）→ 聚焦其 folder。
  const focusAgentCanvas = useCallback(
    (agentId: string) => {
      const n = styledNodes.find(
        (x) => x.type === "agent" && x.data?.agentId === agentId,
      );
      if (n) {
        flyToFocus([n.id]);
        return;
      }
      const mgrOrg = Object.entries(orgManagers).find(
        ([, m]) => m === agentId,
      );
      if (mgrOrg) flyToFocus([`folder-${mgrOrg[0]}`]);
    },
    [styledNodes, flyToFocus, orgManagers],
  );

  // 画布化改造：侧栏第二页行点击 → 右侧聊天抽屉（与画布点节点同效果）；
  // 非画布路由跳入时经 sessionStorage 携带打开意图（挂载时消费即清）。
  useEffect(() => {
    const openDrawer = (kind: string, id: string, edit?: boolean) => {
      if (kind === "agent") {
        // agent 分支唯一执行体在 AgentDrawer 组件监听器——本函数经 onEvt
        // 消费同事件，此处再调 ref.open 会双触发（open→toggle 双关）。
        // 抽屉归组件开；镜头聚焦此处补（搜索聚焦语义，节点不在当前
        // 画布时静默让位——抽屉照开）。
        focusAgentCanvas(id);
        return;
      } else if (kind === "team") {
        // 抽屉渲染条件=selectedTeam && teamForm——与画布 onNodeClick 同走
        // openTeam（同时设 selectedTeamId+teamForm），否则 teamForm 缺失渲染空白抽屉
        agentDrawerRef.current?.close();
        if (!edit && selectedTeamId === id) {
          setSelectedTeamId(null);
          setTeamForm(null);
          setEditPanelOpen(false);
        } else {
          openTeam(id, teams?.[id]);
          setEditPanelOpen(edit === true);
          if (edit) setRightPane("edit");
        }
        // 镜头飞越（搜索聚焦语义；团队节点不在当前画布路径时静默让位）
        if (styledNodes.some((n) => n.id === `team-${id}`))
          focusTeamCamera(id);
      } else if (kind === "orgRoom") {
        // 侧栏组织行主点击=开指挥室——转 orgBodyClickBridge
        // 复用静默幂等创建+toggle 单一入口（含互斥清 agent/team 态）
        void orgBodyClickBridge?.(id);
        // 镜头聚焦（组织容器在当前画布时）
        if (styledNodes.some((n) => n.id === `folder-${id}`))
          focusFolderCamera(id);
      }
    };
    const onEvt = (e: Event) => {
      const d = (e as CustomEvent<{ kind?: string; id?: string; edit?: boolean }>).detail;
      if (d?.kind && d.id) openDrawer(d.kind, d.id, d.edit === true);
    };
    window.addEventListener(ROSTER_DRAWER_OPEN_EVENT, onEvt);
    try {
      const raw = window.sessionStorage.getItem("pyb-desktop_open_drawer");
      if (raw) {
        window.sessionStorage.removeItem("pyb-desktop_open_drawer");
        const d = JSON.parse(raw) as { kind?: string; id?: string; edit?: boolean };
        if (d?.kind && d.id) {
          // agent 意图直调 ref（一次性路径，不经事件——避免与组件监听器
          // 双发；AgentDrawer 子组件 effect 先于本页运行，ref 必已挂）。
          // team/orgRoom 仍走 openDrawer。
          if (d.kind === "agent") {
            agentDrawerRef.current?.open(d.id, { orgId: null, teamId: null }, { edit: d.edit === true });
          } else {
            openDrawer(d.kind, d.id, d.edit === true);
          }
        }
      }
    } catch { /* 静默 */ }
    return () => window.removeEventListener(ROSTER_DRAWER_OPEN_EVENT, onEvt);
    // team 分支读 selectedTeamId/teams/openTeam——依赖须随动，否则闭包过期
  }, [selectedTeamId, teams, openTeam, focusAgentCanvas, focusTeamCamera, focusFolderCamera]);


  const onNodesChange = useCallback(() => {}, []);

  // 视口抢夺修复——fitView 只在「视图意图」变化时
  // 触发（进入子画布/下钻返回/首帧数据到达），不再跟 nodes/edges 对象身份
  // 走。此前 deps=[nodes,edges] 而 nodes 的 useMemo deps 含 agents/teams/
  // aiOrg 等轮询对象（usePolling 每次 refresh 换新身份），任何结构变更操作
  // （建群/退群/组织编辑触发 AI_ORG_CHANGED）都会重跑 fitView 把用户正在
  // 拖看的位置强行拽回全景。意图键 rootFolderId|focusTeamId 去重：同键的
  // 数据刷新（含首帧后的后续轮询）零触发；换键（切画布/下钻）恰一次。
  const lastAutoFitKey = useRef<string | null>(null);
  useEffect(() => {
    if (nodes.length === 0) return;
    const fitKey = `${rootFolderId ?? ""}|${focusTeamId ?? ""}`;
    if (lastAutoFitKey.current === fitKey) return;
    lastAutoFitKey.current = fitKey;
    const frame = requestAnimationFrame(() => {
      fitView({ padding: 0.3, duration: 300 });
    });
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes.length, rootFolderId, focusTeamId, fitView]);

  // orgs 链「从未成功」错误出口——agents 已就绪但
  // 组织连续失败≥10 轮时画布顶部给出横幅（
  // 不阻断画布其余内容渲染）。
  const orgsNeverLoaded = !aiOrgData && orgsFailures >= 10;
  if (!agents) {
    // daemon 冷启动/热恢复 503 窗口自愈——usePolling 后台已
    // 自动退避重试；连续失败≥10 轮（约 40s）从未成功时不再显示无限加载，
    // 给出错误卡片+手动重试（后台重试仍在跑，按钮只是即时触发一次）。
    if (agentsFailures >= 10) {
      // 相位校准——非 ready 态文案让位横幅（顶部已
      // 有全局诊断+重试），ready 态保留本链独立出口+重试按钮。
      if (phaseNotReady) {
        return (
          <div className="flex h-full items-center justify-center text-muted-foreground text-sm">
            {connectionPhase === "unreachable"
              ? "等待连接恢复…（顶部横幅可手动重试）"
              : "引擎恢复中，数据将在就绪后自动加载…"}
          </div>
        );
      }
      return (
        <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
          <p className="text-sm">无法连接 pyb daemon（127.0.0.1:3779）——正在自动重试</p>
          <button
            className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent"
            onClick={() => refreshAgents()}
          >
            立即重试
          </button>
        </div>
      );
    }
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground text-sm">
        加载中...
      </div>
    );
  }

  if (Object.keys(agents).length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
        <Bot className="h-8 w-8" />
        <p className="text-sm">暂未配置 Agent。</p>
      </div>
    );
  }

  const selectedTeam = selectedTeamId && teams ? teams[selectedTeamId] : null;
  // 群/指挥室旧骨架容器的滑入判定——不含 agentDrawerAgentId（成员抽屉
  // AgentDrawer 组件自管 transform；旧值含它会在点成员时滑入一个内容
  // 为 null 的空壳叠在 AgentDrawer 上方——真机坐实"画布点成员弹空白"）
  const drawerOpen = !!selectedTeam || !!cmdRoomOrgId;

  return (
    <div className="relative h-full w-full">
      {orgsNeverLoaded ? (
        phaseNotReady ? (
          <div className="absolute inset-x-0 top-0 z-50 flex items-center justify-center border-b bg-muted/60 py-1 text-xs text-muted-foreground">
            组织数据将在连接恢复后自动加载…
          </div>
        ) : (
          <div className="absolute inset-x-0 top-0 z-50 flex items-center justify-center gap-3 border-b bg-destructive/10 py-1.5 text-xs text-destructive">
            <span>组织数据加载失败（daemon 冷启动中会自动重试）</span>
            <button
              className="rounded-md border px-2 py-0.5 hover:bg-accent"
              onClick={() => refreshAiOrg()}
            >
              立即重试
            </button>
          </div>
        )
      ) : null}
      {/* 画布化改造：返回胶囊（替代左上角面包屑）——搜索框正下方居中，
          透明底细描边；根大画布时整体隐藏。两段式：
          主段 ‹大画布 恒回 /company；× 段仅群聚焦态出现=取消聚焦
          （strip ?focusTeam，回当前组织画布）。 */}
      {(() => {
        const focusName =
          focusTeamId && teams?.[focusTeamId]?.name
            ? teams[focusTeamId].name
            : null;
        const hereName =
          focusName ??
          (breadcrumb.length > 0
            ? breadcrumb[breadcrumb.length - 1].name
            : "AI 组织");
        const active = rootFolderId !== null || focusTeamId != null;
        if (!active) return null;
        return (
          <div className="fixed left-1/2 top-14 z-40 flex -translate-x-1/2 items-center gap-0.5 rounded-md border border-border/60 bg-transparent px-1.5 py-1 text-xs backdrop-blur-[2px]">
            <span
              className="mr-1 max-w-40 truncate text-muted-foreground"
              title={hereName}
            >
              {hereName}
            </span>
            <Link
              href="/company"
              className="flex items-center gap-0.5 rounded px-1.5 py-0.5 text-muted-foreground transition-colors hover:bg-muted/60 hover:text-primary"
              title="回到 AI 组织根大画布"
            >
              <ChevronLeft className="h-3 w-3" />
              大画布
            </Link>
            {focusTeamId && (
              <button
                onClick={() => router.replace(window.location.pathname)}
                className="flex items-center rounded px-1.5 py-0.5 text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
                title="取消聚焦：回到当前组织画布"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        );
      })()}

      <ReactFlow
        nodes={styledNodes}
        edges={styledEdges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onNodeClick={onNodeClick}
        onPaneContextMenu={onPaneContextMenu}
        onNodeContextMenu={onNodeContextMenu}
        nodesDraggable={false}
        onMoveStart={() => {
          setCtxMenu(null);
          closeCtxMenu();
        }}
        onPaneClick={() => {
          setCtxMenu(null);
          closeCtxMenu();
          // 画布化改造：点画布空白 → 通知侧栏浮层收起 + 收拢右侧聊天抽屉
          window.dispatchEvent(new Event(SIDEBAR_FLOAT_CLOSE_EVENT));
          agentDrawerRef.current?.close();
          setSelectedTeamId(null);
          setTeamForm(null);
          // 指挥室抽屉同律收拢（与其他聊天窗一致）
          setCmdRoom(null);
          setEditPanelOpen(false);
          // 聚焦态点空白=退出聚焦+动画回全景（收抽屉之上叠加，
          // 与 deselect 同心智，一次点击完成退出）
          exitCameraFocus();
        }}
        minZoom={0.15}
        maxZoom={1.5}
        proOptions={{ hideAttribution: true }}
        className="bg-background"
      >
        {/* 背景点阵已移除（纯黑/纯白主题下观感差），色调由 bg-background 承载 */}
        <Controls
          showInteractive={false}
          className="!bg-card !border-border !shadow-md [&>button]:!bg-card [&>button]:!border-border [&>button]:!text-foreground [&>button:hover]:!bg-muted"
        />
        {/* 聚焦态「回到全景」浮钮 */}
        {(focusedTeamId || focusedFolderId) && (
          <button
            type="button"
            onClick={exitCameraFocus}
            className="absolute bottom-4 left-1/2 z-20 -translate-x-1/2 rounded-full bg-primary/90 px-4 py-2 text-xs font-semibold text-primary-foreground shadow-lg backdrop-blur hover:bg-primary"
          >
            ← 回到全景
          </button>
        )}
      </ReactFlow>

      {/* 成员抽屉（抽出组件——窗上下文/右栏三态/宽度全内聚；
          agent 分支事件监听也在组件内，city 页同源消费） */}
      <AgentDrawer
        ref={agentDrawerRef}
        agents={agents}
        onSaved={refreshAgents}
        onOpen={handleAgentDrawerOpen}
        onClose={handleAgentDrawerClose}
      />

      {/* 群/指挥室 overlay 抽屉·两段式：默认仅聊天框；齿轮滑出编辑/身份栏（栏顶自带 X） */}
      <div
        className={cn(
          "absolute inset-y-0 right-0 z-10 bg-card shadow-2xl overflow-hidden flex",
          // 悬浮卡化：大屏四边留白+圆角+单侧投影（详情卡同族形态）；
          // 小屏保持全屏贴边。去 border-l（圆角后左竖线视觉断裂）。
          "sm:inset-y-3 sm:right-3 sm:rounded-3xl",
          "sm:shadow-[-24px_0_60px_-20px_rgba(15,23,42,0.35)]",
          // 拖拽调宽期间禁用过渡——否则 300ms width 过渡追鼠标产生粘滞感
          // （滑入/滑出动画保留）。
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
        {cmdRoomOrgId ? (
          <>
            {/* key=orgId 强制重建——同实例只换 props 时内部 usePolling/消息
                state 残留旧组织数据（探针坐实：桥已切换而界面停第一个组织） */}
            <CmdRoomDrawer
              key={cmdRoomOrgId}
              orgId={cmdRoomOrgId}
              orgName={
                aiOrg.folders.find((f) => f.id === cmdRoomOrgId)?.name ?? cmdRoomOrgId
              }
              editPanelOpen={editPanelOpen}
              rightPane={rightPane}
              onOpenPane={openRightPane}
              onClose={() => {
                setCmdRoom(null);
                setEditPanelOpen(false);
              }}
            />
            {/* 组织编辑栏（团队编辑栏同位同律——改名/换管理者）；
                右栏按段切——schedule 段渲染指挥室级定时任务全景面 */}
            <div
              className={cn(
                "relative h-full shrink-0 border-l bg-card flex-col",
                "transition-transform duration-300 ease-in-out overflow-hidden",
              )}
              style={{ display: editPanelOpen ? "flex" : "none", width: editW }}
            >
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
                    recipient={{
                      kind: "group",
                      id: `cmdroom_${cmdRoomOrgId}`,
                    }}
                    recipientLabel={
                      aiOrg.folders.find((f) => f.id === cmdRoomOrgId)?.name ??
                      cmdRoomOrgId
                    }
                  />
                </div>
              ) : (
                <>
              <Button
                variant="ghost"
                size="sm"
                className="absolute right-1.5 top-1.5 z-10 h-7 text-xs"
                title="收起组织编辑"
                onClick={() => setEditPanelOpen(false)}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
              <OrgEditPanel
                orgId={cmdRoomOrgId}
                orgName={
                  aiOrg.folders.find((f) => f.id === cmdRoomOrgId)?.name ?? ""
                }
                managerAgentId={orgManagers[cmdRoomOrgId] ?? null}
                onSaved={() => {
                  window.dispatchEvent(new Event(AI_ORG_CHANGED_EVENT));
                }}
              />
                </>
              )}
            </div>
          </>
        ) : selectedTeam && teamForm ? (
          <>
            <div className="flex min-w-0 flex-1 flex-col h-full">
              {/* 头部主题色渐变：团队=leader avatarColor（160deg 12% alpha 渐至透明） */}
              <div
                className="flex items-center justify-between px-4 py-3 border-b"
                style={
                  agents?.[selectedTeam.leader_agent]?.avatar_color
                    ? {
                        background: `linear-gradient(160deg, ${agents[selectedTeam.leader_agent].avatar_color}1F 0%, transparent 100%)`,
                      }
                    : undefined
                }
              >
                <div className="flex items-center gap-2 min-w-0">
                  <GroupAvatar
                    memberIds={selectedTeam.agents}
                    agents={agents}
                    size={28}
                  />
                  <span className="truncate text-sm font-medium">
                    {selectedTeam.name}
                  </span>
                  <span className="text-[10px] text-muted-foreground shrink-0">
                    {teamForm.agents.length} 人
                  </span>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {/* 群抽屉同律凹陷分段双钮（群编辑/定时任务——群级
                      用户特权通道）。视觉语言：10px 圆角凹槽式分段触发器 */}
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
                    onClick={() => {
                      setSelectedTeamId(null);
                      setTeamForm(null);
                    }}
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
              <div className="min-h-0 flex-1">
                <ChatRoomView
                  teamId={selectedTeamId ?? ""}
                  teamName={selectedTeam.name}
                />
              </div>
            </div>
            <div
              className={cn(
                "relative h-full shrink-0 border-l bg-card flex-col",
                "transition-transform duration-300 ease-in-out overflow-hidden",
              )}
              style={{ display: editPanelOpen ? "flex" : "none", width: editW }}
            >
              {/* 编辑栏左缘拖拽柄：左右拉伸群编辑栏（聊天框宽度不联动） */}
              <div
                onMouseDown={startEditResize}
                className={cn(
                  "absolute left-0 inset-y-0 z-20 w-1.5 cursor-col-resize",
                  "hover:bg-primary/40 transition-colors",
                  editResizing && "bg-primary/60",
                )}
                title="拖拽调整栏宽"
              />
              {/* org-ui 裁定：edit 段去掉「群编辑」标题行——X 浮右上角与表单
                  首行同水平；schedule 段渲染群级定时任务全景面 */}
              {rightPane === "schedule" ? (
                <div className="min-h-0 flex-1">
                  <SchedulePane
                    recipient={{ kind: "group", id: selectedTeamId ?? "" }}
                    recipientLabel={selectedTeam.name}
                  />
                </div>
              ) : (
                <>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="absolute right-1.5 top-1.5 z-10 h-7 text-xs"
                    title="收起团队编辑"
                    onClick={() => setEditPanelOpen(false)}
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                  <div className="min-h-0 flex-1">
                    <TeamEditor
                      form={teamForm}
                      setForm={setTeamForm}
                      isNew={false}
                      saving={teamSaving}
                      error={teamError}
                      onSave={saveTeamForm}
                      availableAgents={visibleAgents ?? agents}
                      compact
                    />
                  </div>
                </>
              )}
            </div>
          </>
        ) : null}
      </div>

      {/* 成员右键：退出/删除/加群（不变） */}
      {nodeCtx && nodeCtx.kind === "agent" && nodeCtx.agentId && (
        <>
          <div
            className="fixed inset-0 z-20"
            onClick={() => closeCtxMenu()}
            onContextMenu={(e) => {
              e.preventDefault();
              closeCtxMenu();
            }}
          />
          <div
            className="fixed z-30 w-52 rounded-md border bg-card shadow-lg py-1"
            style={{
              left: Math.min(nodeCtx.x, window.innerWidth - 220),
              top: Math.min(nodeCtx.y, window.innerHeight - 140),
            }}
            onMouseLeave={() => setOpenSubmenu(null)}
          >
            {nodeCtx.sourceTeamId && (
              <button
                className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-foreground hover:bg-muted"
                onClick={() => {
                  void leaveTeam(nodeCtx.agentId!, nodeCtx.sourceTeamId!);
                  closeCtxMenu();
                }}
              >
                <LogOut className="h-3.5 w-3.5" /> 退出本群
              </button>
            )}
            {nodeCtx.sourceTeamId &&
              teams?.[nodeCtx.sourceTeamId]?.agents.includes(
                nodeCtx.agentId!,
              ) && (
                <button
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-foreground hover:bg-muted"
                  onClick={() => {
                    const isCur =
                      teams?.[nodeCtx.sourceTeamId!]?.leader_agent ===
                      nodeCtx.agentId!;
                    void setLeader(
                      nodeCtx.agentId!,
                      nodeCtx.sourceTeamId!,
                      !isCur,
                    );
                    closeCtxMenu();
                  }}
                >
                  {teams?.[nodeCtx.sourceTeamId]?.leader_agent ===
                  nodeCtx.agentId! ? (
                    <>
                      <CircleMinus className="h-3.5 w-3.5" /> 取消队长
                    </>
                  ) : (
                    <>
                      <Crown className="h-3.5 w-3.5" /> 设为队长
                    </>
                  )}
                </button>
              )}
            <button
              className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-destructive hover:bg-muted"
              onClick={() => {
                void deleteAgentOp(nodeCtx.agentId!, nodeCtx.agentName ?? "");
                closeCtxMenu();
              }}
            >
              <Trash2 className="h-3.5 w-3.5" /> 删除队友
            </button>
            {(() => {
              const joinedTeams = new Set(
                Object.values(teams ?? {})
                  .filter((t) => t.agents.includes(nodeCtx.agentId!))
                  .map((t) => t.pyb_team_id ?? ""),
              );
              const candidates = Object.entries(teams ?? {}).filter(
                ([id]) => !joinedTeams.has(id),
              );
              if (candidates.length === 0) return null;
              return (
                <div className="relative">
                  <button
                    className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-sm text-foreground hover:bg-muted"
                    onClick={() => setOpenSubmenu(openSubmenu === "join" ? null : "join")}
                    onMouseEnter={() => setOpenSubmenu("join")}
                  >
                    <span className="flex items-center gap-2">
                      <UserPlus className="h-3.5 w-3.5" /> 加入其他群
                    </span>
                    <ChevronRight
                      className={cn(
                        "h-3 w-3 transition-transform",
                        openSubmenu === "join" && "rotate-90",
                      )}
                    />
                  </button>
                  {openSubmenu === "join" && (
                    <div className="absolute left-full top-0 ml-1 w-48 max-h-64 overflow-y-auto rounded-md border bg-card shadow-lg py-1">
                      {candidates.map(([id, t]) => (
                        <button
                          key={id}
                          className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-foreground hover:bg-muted truncate"
                          onClick={() => {
                            void joinTeam(nodeCtx.agentId!, id);
                            closeCtxMenu();
                          }}
                        >
                          <Hash className="h-3 w-3 shrink-0 text-muted-foreground" />
                          <span className="truncate">{t.name}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })()}
            {(() => {
              // 加入其他组织子菜单。准入：当前挂靠组织置灰（其余放行——
              // 原「该组织团队 leader 不得挂靠」置灰随四视角模型解除，
              // 独立成员相对性身份可与主管叠加）。orgId 真相源=aiOrg.agentOrg。
              if (aiOrg.folders.length === 0) return null;
              const agentOrg =
                (aiOrg as AiOrgState & { agentOrg?: Record<string, string> })
                  .agentOrg ?? {};
              const cur = agentOrg[nodeCtx.agentId!] ?? null;
              const indentOf = (fid: string): number => {
                let d = 0;
                let p =
                  aiOrg.folders.find((f) => f.id === fid)?.parentId ?? null;
                const seen = new Set<string>([fid]);
                while (p && !seen.has(p)) {
                  seen.add(p);
                  d++;
                  p = aiOrg.folders.find((f) => f.id === p)?.parentId ?? null;
                }
                return d;
              };
              return (
                <>
                  <div className="relative">
                    <button
                      className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-sm text-foreground hover:bg-muted"
                      onClick={() => setOpenSubmenu(openSubmenu === "joinOrg" ? null : "joinOrg")}
                      onMouseEnter={() => setOpenSubmenu("joinOrg")}
                    >
                      <span className="flex items-center gap-2">
                        <Building2 className="h-3.5 w-3.5" /> 加入其他组织
                      </span>
                      <ChevronRight
                        className={cn(
                          "h-3 w-3 transition-transform",
                          openSubmenu === "joinOrg" && "rotate-90",
                        )}
                      />
                    </button>
                    {openSubmenu === "joinOrg" && (
                      <div className="absolute left-full top-0 ml-1 w-60 max-h-72 overflow-y-auto rounded-md border bg-card shadow-lg py-1">
                        {aiOrg.folders.map((f) => {
                          const disabled = f.id === cur;
                          const reason = disabled ? "（当前）" : "";
                          return (
                            <button
                              key={f.id}
                              disabled={disabled}
                              title={disabled ? `不可加入：${reason}` : f.name}
                              className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-foreground hover:bg-muted disabled:opacity-40 disabled:hover:bg-transparent truncate"
                              style={{
                                paddingLeft: `${12 + Math.min(indentOf(f.id), 3) * 12}px`,
                              }}
                              onClick={() => {
                                void joinOrg(nodeCtx.agentId!, f.id);
                                closeCtxMenu();
                              }}
                            >
                              <FolderTree className="h-3 w-3 shrink-0 text-muted-foreground" />
                              <span className="truncate">
                                {f.name}
                                {reason}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                  {cur && (
                    <button
                      className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-foreground hover:bg-muted"
                      onClick={() => {
                        void joinOrg(nodeCtx.agentId!, null);
                        closeCtxMenu();
                      }}
                    >
                      <LogOut className="h-3.5 w-3.5" /> 移出组织
                    </button>
                  )}
                </>
              );
            })()}
          </div>
        </>
      )}

      {/* team 右键——移动到文件夹 */}
      {nodeCtx && nodeCtx.kind === "team" && nodeCtx.teamId && (
        <>
          <div
            className="fixed inset-0 z-20"
            onClick={() => closeCtxMenu()}
            onContextMenu={(e) => {
              e.preventDefault();
              closeCtxMenu();
            }}
          />
          <div
            className="fixed z-30 w-56 rounded-md border bg-card shadow-lg py-1"
            onMouseLeave={() => setOpenSubmenu(null)}
            style={{
              left: Math.min(nodeCtx.x, window.innerWidth - 230),
              top: Math.min(nodeCtx.y, window.innerHeight - 160),
            }}
          >
            <button
              className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-foreground hover:bg-muted"
              onClick={() => {
                // 本群新建成员——创建即入群实时渲染
                setCreateForFolder(null); // 入群语义，清组织锚定防残留
                setCreateForTeam(nodeCtx.teamId!);
                openCreate("agent");
              }}
            >
              <UserPlus className="h-3.5 w-3.5" /> 本群新建成员
            </button>
            <button
              className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-foreground hover:bg-muted"
              onClick={() => {
                // 聚焦此群——进入单群聚焦画布（群居顶+成员平铺）。
                // URL 挂群所在组织路径（无归属挂当前路径），面包屑可返回
                const tFid = aiOrg.teamFolder[nodeCtx.teamId!];
                const base = tFid
                  ? folderHref(tFid)
                  : window.location.pathname;
                router.push(
                  `${base}?focusTeam=${encodeURIComponent(nodeCtx.teamId!)}`,
                );
                closeCtxMenu();
              }}
            >
              <Focus className="h-3.5 w-3.5" /> 聚焦此群
            </button>
            <button
              className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-destructive hover:bg-muted"
              onClick={() => {
                void dissolveTeam(nodeCtx.teamId!, nodeCtx.teamName ?? "");
                closeCtxMenu();
              }}
            >
              <Trash2 className="h-3.5 w-3.5" /> 解散群
            </button>
            <div className="relative">
              <button
                className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-sm text-foreground hover:bg-muted"
                onClick={() => setOpenSubmenu(openSubmenu === "move" ? null : "move")}
                onMouseEnter={() => setOpenSubmenu("move")}
              >
                <span className="flex items-center gap-2">
                  <FolderInput className="h-3.5 w-3.5" /> 移动到组织
                </span>
                <ChevronRight
                  className={cn(
                    "h-3 w-3 transition-transform",
                    openSubmenu === "move" && "rotate-90",
                  )}
                />
              </button>
              {openSubmenu === "move" && (
                <div className="absolute left-full top-0 ml-1 w-56 max-h-72 overflow-y-auto rounded-md border bg-card shadow-lg py-1">
                  <button
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-foreground hover:bg-muted"
                    onClick={() => {
                      moveTeam(nodeCtx.teamId!, null);
                      closeCtxMenu();
                    }}
                  >
                    <Building2 className="h-3 w-3 shrink-0 text-muted-foreground" />
                    AI 组织（根）
                  </button>
                  {(() => {
                    const cur = aiOrg.teamFolder[nodeCtx.teamId!];
                    const indentOf = (fid: string): number => {
                      let d = 0;
                      let p =
                        aiOrg.folders.find((f) => f.id === fid)?.parentId ??
                        null;
                      const seen = new Set<string>([fid]);
                      while (p && !seen.has(p)) {
                        seen.add(p);
                        d++;
                        p =
                          aiOrg.folders.find((f) => f.id === p)?.parentId ??
                          null;
                      }
                      return d;
                    };
                    return aiOrg.folders.map((f) => (
                      <button
                        key={f.id}
                        disabled={f.id === cur}
                        className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-foreground hover:bg-muted disabled:opacity-40 truncate"
                        style={{
                          paddingLeft: `${12 + Math.min(indentOf(f.id), 3) * 12}px`,
                        }}
                        onClick={() => {
                          moveTeam(nodeCtx.teamId!, f.id);
                          closeCtxMenu();
                        }}
                      >
                        <FolderTree className="h-3 w-3 shrink-0 text-muted-foreground" />
                        <span className="truncate">
                          {f.name}
                          {f.id === cur ? "（当前）" : ""}
                        </span>
                      </button>
                    ));
                  })()}
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* folder 右键——改名/删除 */}
      {nodeCtx &&
        nodeCtx.kind === "folder" &&
        nodeCtx.folderId &&
        !renameTarget && (
          <>
            <div
              className="fixed inset-0 z-20"
              onClick={() => closeCtxMenu()}
              onContextMenu={(e) => {
                e.preventDefault();
                closeCtxMenu();
              }}
            />
            <div
              className="fixed z-30 w-44 rounded-md border bg-card shadow-lg py-1"
              style={{
                left: Math.min(nodeCtx.x, window.innerWidth - 190),
                top: Math.min(nodeCtx.y, window.innerHeight - 100),
              }}
            >
              {/* 单一「新建」悬停展开二级子菜单
                  （往右飞出，对齐侧栏「我的队友/我的团队」形态）——队友/团队/
                  组织三项，点选即以该页签打开右侧创建抽屉（锚定本组织） */}
              <div className="group/new relative">
                <button
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-foreground hover:bg-muted"
                  onClick={() => {
                    setCreateForFolder(nodeCtx.folderId!);
                    openCreate("agent");
                  }}
                >
                  <Plus className="h-3.5 w-3.5" /> 新建
                  <ChevronRight className="ml-auto h-3 w-3 text-muted-foreground" />
                </button>
                <div className="invisible absolute left-full top-0 z-40 w-36 rounded-md border bg-card shadow-lg py-1 opacity-0 transition-opacity group-hover/new:visible group-hover/new:opacity-100">
                  {([
                    ["agent", "队友", UserPlus],
                    ["team", "团队", UsersRound],
                    ["folder", "组织", FolderTree],
                  ] as const).map(([k, label, Icon]) => (
                    <button
                      key={k}
                      className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-foreground hover:bg-muted"
                      onClick={() => {
                        setCreateForFolder(nodeCtx.folderId!);
                        openCreate(k);
                      }}
                    >
                      <Icon className="h-3.5 w-3.5" /> {label}
                    </button>
                  ))}
                </div>
              </div>
              <button
                className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-foreground hover:bg-muted"
                onClick={() => {
                  // 镜头聚焦此组织——fitView 飞到该组织全部子孙区域，
                  // 世界不重建（与「进入此组织」下钻语义并存）
                  focusFolderCamera(nodeCtx.folderId!);
                  closeCtxMenu();
                }}
              >
                <Focus className="h-3.5 w-3.5" /> 聚焦此组织
              </button>
              <button
                className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-foreground hover:bg-muted"
                onClick={() => {
                  // 进入此组织——下钻该组织子画布（与双击同语义）。
                  // 原名「聚焦此组织」让位给镜头聚焦（瞬态飞越），
                  // 下钻语义更名「进入」消歧
                  router.push(folderHref(nodeCtx.folderId!));
                  closeCtxMenu();
                }}
              >
                <ChevronRight className="h-3.5 w-3.5" /> 进入此组织
              </button>
              <button
                className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-foreground hover:bg-muted"
                onClick={() => {
                  setRenameTarget({
                    id: nodeCtx.folderId!,
                    name: nodeCtx.folderName ?? "",
                  });
                  setRenameInput(nodeCtx.folderName ?? "");
                  closeCtxMenu();
                }}
              >
                <Pencil className="h-3.5 w-3.5" /> 重命名
              </button>
              <button
                className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-destructive hover:bg-muted"
                onClick={() => {
                  void doDeleteFolder(
                    nodeCtx.folderId!,
                    nodeCtx.folderName ?? "",
                  );
                  closeCtxMenu();
                }}
              >
                <Trash2 className="h-3.5 w-3.5" /> 删除组织
              </button>
            </div>
          </>
        )}

      {/* folder 改名浮层 */}
      {renameTarget && (
        <div
          className="absolute inset-0 z-40 flex items-center justify-center bg-black/40"
          onClick={() => setRenameTarget(null)}
        >
          <div
            className="w-[360px] max-w-[90%] rounded-lg border bg-card shadow-2xl p-4 space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-sm font-semibold">重命名文件夹</p>
            <Input
              autoFocus
              value={renameInput}
              onChange={(e) => setRenameInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && renameInput.trim()) {
                  engineRenameFolder(renameTarget.id, renameInput)
                    .then(() => {
                      applyAiOrg();
                      setRenameTarget(null);
                    })
                    .catch(() => {});
                } else if (e.key === "Escape") {
                  setRenameTarget(null);
                }
              }}
            />
            <div className="flex gap-2 justify-end">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setRenameTarget(null)}
              >
                取消
              </Button>
              <Button
                size="sm"
                disabled={!renameInput.trim()}
                onClick={() => {
                  engineRenameFolder(renameTarget.id, renameInput)
                    .then(() => {
                      applyAiOrg();
                      setRenameTarget(null);
                    })
                    .catch(() => {});
                }}
              >
                保存
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* 画布空白右键：新建成员 / Team / 文件夹 */}
      {ctxMenu && (
        <>
          <div
            className="fixed inset-0 z-20"
            onClick={() => setCtxMenu(null)}
            onContextMenu={(e) => {
              e.preventDefault();
              setCtxMenu(null);
            }}
          />
          <div
            className="fixed z-30 w-44 rounded-md border bg-card shadow-lg py-1"
            style={{
              left: Math.min(ctxMenu.x, window.innerWidth - 190),
              top: Math.min(ctxMenu.y, window.innerHeight - 110),
            }}
          >
            {focusTeamId ? (
              /* 聚焦视角锁定——只能为本群建成员（自动入群），
                 不能建平级群/子组织；成员移出（移到其他组织）不受限 */
              <button
                className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-foreground hover:bg-muted"
                onClick={() => {
                  setCreateForFolder(null); // 入群语义，清组织锚定防残留
                  setCreateForTeam(focusTeamId);
                  openCreate("agent");
                }}
              >
                <UserPlus className="h-3.5 w-3.5" /> 新建成员（本群）
              </button>
            ) : (
              <>
                <button
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-foreground hover:bg-muted"
                  onClick={() => {
                    setCreateForTeam(null); // 防锚定残留误入群
                    // org-ui 修复：聚焦组织视角空白右键=为本组织创建（创建即挂靠）
                    setCreateForFolder(rootFolderId);
                    openCreate("agent");
                  }}
                >
                  <UserPlus className="h-3.5 w-3.5" /> 新建成员
                </button>
                <button
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-foreground hover:bg-muted"
                  onClick={() => {
                    // org-ui 修复：聚焦组织视角空白右键建团队=创建即挂靠本组织
                    setCreateForFolder(rootFolderId);
                    openCreate("team");
                  }}
                >
                  <UsersRound className="h-3.5 w-3.5" /> 新建团队
                </button>
                {breadcrumb.length < 3 && (
                  <button
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-foreground hover:bg-muted"
                    onClick={() => openCreate("folder")}
                  >
                    <FolderTree className="h-3.5 w-3.5" /> 新建组织
                  </button>
                )}
              </>
            )}
          </div>
        </>
      )}

      {/* 画布内创建浮层：agent/team（原有）+ folder（新） */}
      {createPanel && (
        <div
          className="absolute inset-0 z-40 flex items-center justify-center bg-black/40"
          onClick={() => !creating && setCreatePanel(null)}
        >
          <div
            className="w-[520px] max-w-[90%] max-h-[85%] rounded-lg border bg-card shadow-2xl flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b">
              <p className="text-sm font-semibold flex items-center gap-2">
                {createPanel === "agent" ? (
                  <>
                    <UserPlus className="h-4 w-4 text-primary" /> 新建成员
                  </>
                ) : createPanel === "team" ? (
                  <>
                    <UsersRound className="h-4 w-4 text-primary" /> 新建团队
                  </>
                ) : (
                  <>
                    <FolderTree className="h-4 w-4 text-primary" /> 新建组织
                    {createForFolder
                      ? `（挂靠「${aiOrg.folders.find((f) => f.id === createForFolder)?.name ?? ""}」）`
                      : rootFolderId
                        ? `（当前层级下）`
                        : "（AI 组织根）"}
                  </>
                )}
              </p>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                onClick={() => setCreatePanel(null)}
                disabled={creating}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {createPanel === "agent" ? (
                <div className="space-y-4 p-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">
                      显示名称
                    </label>
                    <Input
                      value={newAgentName}
                      onChange={(e) => setNewAgentName(e.target.value)}
                      placeholder="如 Coder"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">
                      描述（必填——将成为队友的人设）
                    </label>
                    <textarea
                      value={newAgentDesc}
                      onChange={(e) => setNewAgentDesc(e.target.value)}
                      placeholder="描述这个队友的职责——将成为它的 persona"
                      rows={3}
                      className="w-full rounded-md border bg-background px-3 py-2 text-sm resize-none"
                    />
                  </div>
                  {createError && (
                    <p className="text-sm text-destructive">{createError}</p>
                  )}
                  <div className="flex items-center gap-2 pt-1">
                    <Button onClick={createAgent} disabled={creating}>
                      <Plus className="h-4 w-4" />
                      创建 Teammate
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => setCreatePanel(null)}
                      disabled={creating}
                    >
                      取消
                    </Button>
                  </div>
                </div>
              ) : createPanel === "team" ? (
                <TeamEditor
                  form={newTeamForm}
                  setForm={setNewTeamForm}
                  isNew
                  saving={creating}
                  error={createError}
                  onSave={createTeam}
                  availableAgents={visibleAgents ?? agents}
                />
              ) : (
                <div className="space-y-4 p-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">
                      组织名称
                    </label>
                    <Input
                      autoFocus
                      value={newFolderName}
                      onChange={(e) => setNewFolderName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") doCreateFolder();
                      }}
                      placeholder={rootFolderId ? "如 财务" : "如 company"}
                    />
                  </div>
                  {createError && (
                    <p className="text-sm text-destructive">{createError}</p>
                  )}
                  <div className="flex items-center gap-2 pt-1">
                    <Button onClick={doCreateFolder} disabled={creating}>
                      <Plus className="h-4 w-4" />
                      创建组织
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => setCreatePanel(null)}
                      disabled={creating}
                    >
                      取消
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function OrgChartPage() {
  return (
    <div className="h-full w-full">
      <ReactFlowProvider>
        {/* useSearchParams 须 Suspense 边界（Next 静态渲染要求） */}
        <Suspense fallback={null}>
          <OrgChartInner />
        </Suspense>
      </ReactFlowProvider>
    </div>
  );
}


