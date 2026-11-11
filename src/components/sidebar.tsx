"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { cn } from "@/lib/utils";
import { usePolling } from "@/lib/hooks";
import {
  getAgents, getTeams, deletePybAgent, deletePybTeam, savePybTeam,
  getPybReadState, markPybRead,
  type AgentConfig, type TeamConfig,
} from "@/lib/api";
import { ROSTER_CHANGED_EVENT, BADGE_REFRESH_EVENT } from "@/lib/roster-events";
import { useDaemonLiveEvents, SSE_RECONNECTED_EVENT } from "@/lib/live-events";
import {
  folderPathOf,
  type AiOrgState,
} from "@/lib/ai-org-folders";
import {
  loadAiOrgFromEngine,
  engineMoveTeamToFolder,
  engineDeleteFolder,
} from "@/lib/ai-org-engine";
import { AgentAvatar } from "@/components/agent/agent-avatar";
import { GroupAvatar } from "@/components/team/group-avatar";
import { SettingsModal } from "@/components/settings/settings-modal";
import Image from "next/image";
import { Virtuoso } from "react-virtuoso";
import {
  Inbox,
  Plus, FolderTree, Network,
  Settings, Search,
  Sun, Moon, Pin, PinOff, Pencil, Trash2, Crown,
  Users, UsersRound, ChevronRight, ChevronLeft, UserPlus, FolderInput, Hash, ShieldCheck, Target, Bot,
} from "lucide-react";

/** AI 组织树刷新事件（画布侧 folder CRUD 写后派发，侧栏监听重拉）。 */
export const AI_ORG_CHANGED_EVENT = "pyb-desktop:ai-org-changed";

/** 画布化改造：画布空白点击 → 通知侧栏浮层收起（page.tsx onPaneClick 派发）。 */
export const SIDEBAR_FLOAT_CLOSE_EVENT = "pyb-desktop:sidebar-float-close";

/** 画布化改造：第二页行点击 → 画布右侧聊天抽屉打开（detail={kind:"agent"|"team", id}）。 */
export const ROSTER_DRAWER_OPEN_EVENT = "pyb-desktop:roster-drawer-open";
const DRAWER_INTENT_KEY = "pyb-desktop_open_drawer";

const FOLDER_INDENT_CAP = 3;
/** 组织树最大层级（AI 组织根不计；第 3 层行不再显示 + 号——层级封顶） */
const FOLDER_MAX_DEPTH = 3;

export const AGENT_COLORS = [
  "bg-blue-500", "bg-emerald-500", "bg-purple-500", "bg-orange-500",
  "bg-pink-500", "bg-cyan-500", "bg-yellow-500", "bg-red-500",
];

export function agentColor(agentId: string): string {
  let hash = 0;
  for (let i = 0; i < agentId.length; i++) {
    hash = ((hash << 5) - hash + agentId.charCodeAt(i)) | 0;
  }
  return AGENT_COLORS[Math.abs(hash) % AGENT_COLORS.length];
}

/** 相对时间（now/m/h/d）——尾部最后活跃展示 */
function relativeTime(updatedAt: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - updatedAt) / 1000));
  if (seconds < 60) return "now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `${hours}h` : `${Math.round(hours / 24)}d`;
}

/**
 * 活跃度合成键 max(updated_at, last_msg)——「updatedAt=任何 roster
 * 活动」语义的 L1 前端投影。改名/换头像（updated_at bump）与新消息（last_msg）
 * 都上浮；ts=0（新建未活动）沉底。L3 引擎一等语义落地后此处换读单字段即可。
 */
function activityAt(updatedAt: number | undefined, lastMsgTs: number | undefined): number {
  return Math.max(updatedAt ?? 0, lastMsgTs ?? 0);
}

function TimeTail({ ts, hideOnHover }: { ts?: number; hideOnHover?: boolean }) {
  if (!ts) return null;
  return (
    <span
      className={
        "text-[10px] text-muted-foreground tabular-nums shrink-0" +
        (hideOnHover ? " group-hover:hidden" : "")
      }
    >
      {relativeTime(ts, Date.now())}
    </span>
  );
}

const PINNED_KEY = "pyb-desktop_pinned_agents";
const TEAM_PINNED_KEY = "pyb-desktop_pinned_teams";
const ORG_PINNED_KEY = "pyb-desktop_pinned_orgs";

/** 置顶集读写（localStorage 持久化；含已删 agent 的清理）。 */
function readPinned(): string[] {
  return readPinList(PINNED_KEY);
}

/** 群置顶集（独立键，与 agent 置顶互不干扰）。 */
function readTeamPinned(): string[] {
  return readPinList(TEAM_PINNED_KEY);
}

/** 组织置顶集（独立键；按 orgId 持久化）。 */
function readOrgPinned(): string[] {
  return readPinList(ORG_PINNED_KEY);
}

function readPinList(key: string): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(key);
    const arr = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(arr) ? arr.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

function writePinned(ids: string[]): void {
  writePinList(PINNED_KEY, ids);
}

function writeTeamPinned(ids: string[]): void {
  writePinList(TEAM_PINNED_KEY, ids);
}

function writeOrgPinned(ids: string[]): void {
  writePinList(ORG_PINNED_KEY, ids);
}

function writePinList(key: string, ids: string[]): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(ids));
  } catch {
    /* 持久化失败静默——内存态仍生效 */
  }
}

/** 画布化改造：非画布路由 → 返回胶囊里显示的页名。 */
function pageLabelOf(pathname: string): string {
  if (pathname.startsWith("/settings")) return "设置";
  if (pathname.startsWith("/inbox")) return "杂事箱";
  if (pathname.startsWith("/agents/")) return "队友会话";
  if (pathname.startsWith("/agents")) return "队友";
  if (pathname.startsWith("/team/")) return "团队会话";
  if (pathname.startsWith("/teams")) return "团队";
  return "页面";
}

export function Sidebar() {
  const pathname = usePathname() ?? "";
  const router = useRouter();
  const { resolvedTheme, setTheme } = useTheme();
  // AI 组织 folder 树（localStorage 读，AI_ORG_CHANGED_EVENT 写后刷新）
  // orgs 链接入 usePolling 退避网（声明移至 200 区 effect 前）
  // 画布化改造：浮层开合——左侧圆角方形按钮点开，再点/点外部/点画布空白收起
  const [floatOpen, setFloatOpen] = useState(false);
  // 设置模态（画布之上，不走路由——路由会卸载画布致重排）
  const [settingsOpen, setSettingsOpen] = useState(false);
  // 右折叠第二页：agents=我的队友 / teams=我的团队 / orgs=我的组织（null=收起）
  // hover 交互：进入按钮/面板即展开，全部离开后延时收起（200ms 容忍按钮→面板的移动间隙）
  const [subPage, setSubPage] = useState<null | "agents" | "teams" | "orgs">(null);
  const subCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleSubClose = () => {
    if (subCloseTimer.current) clearTimeout(subCloseTimer.current);
    subCloseTimer.current = setTimeout(() => setSubPage(null), 200);
  };
  const cancelSubClose = () => {
    if (subCloseTimer.current) { clearTimeout(subCloseTimer.current); subCloseTimer.current = null; }
  };
  const subPanelRef = useRef<HTMLDivElement | null>(null);
  const floatPanelRef = useRef<HTMLDivElement | null>(null);
  const floatBtnRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    const onPaneClick = () => { setFloatOpen(false); setSubPage(null); };
    window.addEventListener(SIDEBAR_FLOAT_CLOSE_EVENT, onPaneClick);
    return () => window.removeEventListener(SIDEBAR_FLOAT_CLOSE_EVENT, onPaneClick);
  }, []);
  useEffect(() => {
    if (!floatOpen) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (floatPanelRef.current?.contains(t) || floatBtnRef.current?.contains(t) || subPanelRef.current?.contains(t)) return;
      setFloatOpen(false);
      setSubPage(null);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [floatOpen]);
  // orgs 链接入 usePolling 退避网（替换原一次性 fetch+静默 catch）
  // + AI_ORG_CHANGED/SSE 重连事件驱动刷新（断线期组织变更重连后自动补齐）。
  const { data: aiOrgData, refresh: refreshAiOrg } = usePolling<AiOrgState>(loadAiOrgFromEngine, 0);
  const aiOrg: AiOrgState = aiOrgData ?? { version: 1, folders: [], teamFolder: {} };
  useEffect(() => {
    const onChanged = () => void refreshAiOrg();
    window.addEventListener(AI_ORG_CHANGED_EVENT, onChanged);
    window.addEventListener(SSE_RECONNECTED_EVENT, onChanged);
    return () => {
      window.removeEventListener(AI_ORG_CHANGED_EVENT, onChanged);
      window.removeEventListener(SSE_RECONNECTED_EVENT, onChanged);
    };
  }, [refreshAiOrg]);
  // folderHref 产出 org_id URL（slug 退役，重命名不断链）
  const folderHref = (id: string) =>
    `/company/${folderPathOf(aiOrg.folders, id).map(f => encodeURIComponent(f.id)).join("/")}`;

  // 30s 轮询：intervalMs=0 只在挂载时拉一次，而侧边栏是常驻布局组件
  // （页面切换不重挂载）——新建 agent/team 后侧边栏永不更新（手测坐实：
  // 创建耦合体后 /agents 页可见但侧边栏缺失）。
  const { data: agents, refresh: refreshAgents } = usePolling<Record<string, AgentConfig>>(getAgents, 30_000);
  const { data: teams, refresh: refreshTeams } = usePolling<Record<string, TeamConfig>>(getTeams, 30_000);
  // ── 行右键菜单（与画布同语义）：队友=加入其他群/删除；团队=解散群/移动到组织 ──
  const [rowCtx, setRowCtx] = useState<{
    x: number; y: number;
    kind: "agent" | "team";
    agentId?: string; agentName?: string;
    teamId?: string; teamName?: string;
  } | null>(null);
  const [rowJoinSub, setRowJoinSub] = useState(false);
  const [rowMoveSub, setRowMoveSub] = useState(false);

  const rowJoinTeam = useCallback(async (agentId: string, teamId: string) => {
    const team = teams?.[teamId];
    if (!team || team.agents.includes(agentId)) return;
    try {
      await savePybTeam(teamId, { members: [...team.agents, agentId] });
      refreshTeams();
    } catch { /* 引擎侧报错静默（与画布 showErr 同位但侧栏从简） */ }
  }, [teams, refreshTeams]);

  const rowDeleteAgent = useCallback(async (agentId: string, agentName: string) => {
    if (!window.confirm(`确定删除 ${agentName}？它将从所有群中移除，此操作不可撤销。`)) return;
    try {
      await deletePybAgent(agentId);
      refreshAgents();
    } catch { /* 静默 */ }
  }, [refreshAgents]);

  const rowDissolveTeam = useCallback(async (teamId: string, teamName: string) => {
    if (!window.confirm(`确定解散群「${teamName}」？此操作不可撤销。`)) return;
    try {
      await deletePybTeam(teamId);
      refreshTeams();
    } catch { /* 静默 */ }
  }, [refreshTeams]);

  const rowMoveTeam = useCallback(async (teamId: string, folderId: string | null) => {
    try {
      await engineMoveTeamToFolder(teamId, folderId);
      window.dispatchEvent(new Event(AI_ORG_CHANGED_EVENT));
    } catch { /* 静默（引擎错误由画布面呈现） */ }
  }, []);


  // daemon SSE 直连——引擎侧 roster 变更（teammate
  // 代建/CLI/RPC）与 agent 新消息即时到达，翻译回下方既有 window 事件。
  // 断连降级：EventSource 自动重连；彻底不可用时 30s 轮询兜底（不拆除）。
  useDaemonLiveEvents();

  // 未读徽标——/api/pyb-read/state 聚合比对
  // （last_read_ts < last_msg_ts 且非当前打开会话 = 未读）。
  const [unread, setUnread] = useState<Set<string>>(new Set());
  // last_msg 时间戳（相对时间尾部数据源，与未读徽标同源同节奏刷新）
  const [lastMsg, setLastMsg] = useState<Record<string, number>>({});
  const refreshBadges = useCallback(async () => {
    try {
      const state = await getPybReadState();
      const next = new Set<string>();
      for (const [id, lastMsgTs] of Object.entries(state.last_msg)) {
        const lastRead = state.conversations[id] ?? 0;
        if (lastMsgTs > lastRead) next.add(id);
      }
      setUnread(next);
      setLastMsg(state.last_msg);
    } catch {
      /* 引擎未 hosted/端点未就绪——静默（徽标缺失非错误） */
    }
  }, []);
  useEffect(() => {
    void refreshBadges();
    const onBadge = () => void refreshBadges();
    window.addEventListener(BADGE_REFRESH_EVENT, onBadge);
    // roster 变更也可能改变徽标（新会话/删除）
    window.addEventListener(ROSTER_CHANGED_EVENT, onBadge);
    return () => {
      window.removeEventListener(BADGE_REFRESH_EVENT, onBadge);
      window.removeEventListener(ROSTER_CHANGED_EVENT, onBadge);
    };
  }, [refreshBadges]);
  // 当前打开的会话豁免徽标（正看着）——pathname 变化即重算（豁免项过滤）
  const activeAgentId = pathname.startsWith("/agents/") ? pathname.slice("/agents/".length) : "";
  const activeTeamId = pathname.startsWith("/team/") ? pathname.slice("/team/".length) : "";

  // 进会话即上报读游标（服务端记 last_read_ts，
  // 徽标比对根除）+ 本地即时消点（不等网络回程）。
  useEffect(() => {
    const id = activeAgentId || activeTeamId;
    if (!id) return;
    setUnread(prev => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    void markPybRead(id).catch(() => {});
  }, [activeAgentId, activeTeamId]);

  // roster 即时刷新——创建/删除/改名成功点派发 window 事件，
  // 侧栏监听立即拉取（30s 轮询降级为兜底）。
  useEffect(() => {
    const onRosterChanged = (e: Event) => {
      const kind = (e as CustomEvent<{ kind?: string }>).detail?.kind;
      if (kind === "teams" || kind === "all" || !kind) refreshTeams();
      if (kind === "agents" || kind === "all" || !kind) refreshAgents();
      // 组织变更经 roster 事件桥到 AI_ORG_CHANGED_EVENT——sidebar/画布页
      // 既有监听统一重拉 loadAiOrgFromEngine（收敛点不变）。all/缺省兜底
      // 同转译：跨 scope 变更（如建 org 连带管理者 agent）不漏刷新。
      if (kind === "orgs" || kind === "all" || !kind) {
        window.dispatchEvent(new Event(AI_ORG_CHANGED_EVENT));
      }
    };
    window.addEventListener(ROSTER_CHANGED_EVENT, onRosterChanged);
    return () => window.removeEventListener(ROSTER_CHANGED_EVENT, onRosterChanged);
  }, [refreshAgents, refreshTeams]);

  // 画布化改造：第二页行点击不走路由（保画布不重排），派发事件由画布
  // 开右侧聊天抽屉；不在画布路由时先跳 /company，经 sessionStorage 携带意图。
  // edit=true：同时展开编辑面（agent=身份卡翻背编辑 / team=群编辑栏）。
  // 决策 17：kind 扩 orgRoom——组织行主点击开指挥室（画布 openDrawer orgRoom
  // 分支→orgBodyClickBridge 静默幂等创建+开抽屉）
  const openRosterDrawer = useCallback((kind: "agent" | "team" | "orgRoom", id: string, edit?: boolean) => {
    if (!pathname.startsWith("/company")) {
      try { window.sessionStorage.setItem(DRAWER_INTENT_KEY, JSON.stringify({ kind, id, edit: edit === true })); } catch { /* 静默 */ }
      router.push("/company");
      return;
    }
    window.dispatchEvent(new CustomEvent(ROSTER_DRAWER_OPEN_EVENT, { detail: { kind, id, edit: edit === true } }));
  }, [pathname, router]);

  // pinned rail 状态（置顶集+拖序，localStorage 持久化）
  const [pinned, setPinned] = useState<string[]>([]);
  useEffect(() => {
    setPinned(readPinned());
  }, []);
  // 群置顶（独立键独立状态；不引入拖序，保持轻量）
  const [teamPinned, setTeamPinned] = useState<string[]>([]);
  useEffect(() => {
    setTeamPinned(readTeamPinned());
  }, []);
  // 组织置顶（独立键；与群置顶同规格，不引入拖序）
  const [orgPinned, setOrgPinned] = useState<string[]>([]);
  useEffect(() => {
    setOrgPinned(readOrgPinned());
  }, []);
  const toggleOrgPin = (id: string) => {
    setOrgPinned(prev => {
      const next = prev.includes(id) ? prev.filter(p => p !== id) : [...prev, id];
      writeOrgPinned(next);
      return next;
    });
  };
  // 解散组织：引擎删除 folder（级联摘 teams/独立成员挂靠）+ 派组织刷新事件
  const dissolveOrg = useCallback(async (orgId: string, orgName: string) => {
    if (!window.confirm(`确定解散组织「${orgName}」？其下团队与成员将回到未分配状态，此操作不可撤销。`)) return;
    try {
      await engineDeleteFolder(orgId);
      window.dispatchEvent(new Event(AI_ORG_CHANGED_EVENT));
    } catch { /* 静默（引擎错误由画布面呈现） */ }
  }, []);
  const toggleTeamPin = (id: string) => {
    setTeamPinned(prev => {
      const next = prev.includes(id) ? prev.filter(p => p !== id) : [...prev, id];
      writeTeamPinned(next);
      return next;
    });
  };
  const togglePin = (id: string) => {
    setPinned(prev => {
      const next = prev.includes(id) ? prev.filter(p => p !== id) : [...prev, id];
      writePinned(next);
      return next;
    });
  };
  // 置顶区拖序（原生 draggable，无拖放库依赖）
  const [dragId, setDragId] = useState<string | null>(null);
  const reorderPinned = (from: string, to: string) => {
    setPinned(prev => {
      const fi = prev.indexOf(from);
      const ti = prev.indexOf(to);
      if (fi < 0 || ti < 0 || fi === ti) return prev;
      const next = [...prev];
      next.splice(fi, 1);
      next.splice(ti, 0, from);
      writePinned(next);
      return next;
    });
  };

  // apiBase 切 daemon 面后 /api/agents 形状为 {activeAgents,allAgents}（数组
  // 形状），非 Record<string,AgentConfig>——Object.entries 会产出值非 agent 的条目，
  // agent.name 为 undefined 致 .slice 崩（0.1.9 真机坐实）。渲染前过滤非法条目。
  // 组织管理者从队友区隐藏（唯一入口=组织树/画布特殊节点）。
  // loadAiOrgFromEngine 返回体携带 managers:Record<orgId,managerAgentId>，
  // AiOrgState 类型未声明该字段，此处交叉收窄读取。
  const managerAgentIds = new Set(Object.values((aiOrg as AiOrgState & { managers?: Record<string, string> }).managers ?? {}));
  const agentEntries = agents
    ? Object.entries(agents).filter(([id, a]) => a && typeof a.name === "string" && !managerAgentIds.has(id))
    : [];
  const teamEntries = teams
    ? Object.entries(teams).filter(([, t]) => t && typeof t.name === "string")
    : [];

  // 两段式分区——置顶区（按 pinned 顺序）+ 非置顶区（原序）
  const liveIds = new Set(agentEntries.map(([id]) => id));
  const pinnedLive = pinned.filter(id => liveIds.has(id));
  const pinnedSet = new Set(pinnedLive);
  // 非置顶区按活跃度合成键降序（updatedAt 语义的 L1 投影）——
  // 无活动（ts=0）沉底且彼此保持引擎返回序（sort 稳定）
  const unpinnedEntries = agentEntries
    .filter(([id]) => !pinnedSet.has(id))
    .sort((a, b) => activityAt(b[1].updated_at, lastMsg[b[0]]) - activityAt(a[1].updated_at, lastMsg[a[0]]));
  // 群列表同键排序——引擎 1.5.336 起群有 updated_at（GroupConfig
  // 消息同刻 bump），与 last_msg 合成 max 键，与 agent 行同语义。
  // 置顶分区：teamPinned 顺序优先，其余按活跃度。
  const teamLiveIds = new Set(teamEntries.map(([id]) => id));
  const teamPinnedLive = teamPinned.filter(id => teamLiveIds.has(id));
  const teamPinnedSet = new Set(teamPinnedLive);
  const teamEntriesSorted = teamEntries
    .filter(([id]) => !teamPinnedSet.has(id))
    .sort((a, b) => activityAt(b[1].updated_at, lastMsg[b[0]]) - activityAt(a[1].updated_at, lastMsg[a[0]]));

  // 我的组织：组织名按钮（DM 入口本质是组织管理者，呈现用组织名）。
  // managers: Record<orgId, managerAgentId>（loadAiOrgFromEngine 携带，类型未声明交叉收窄）；
  // 无管理者的组织没有对话入口，过滤掉。
  const orgManagers = (aiOrg as AiOrgState & { managers?: Record<string, string> }).managers ?? {};
  const orgEntries = aiOrg.folders
    .map(f => {
      const managerId = orgManagers[f.id];
      const manager = managerId ? agents?.[managerId] : undefined;
      return manager && typeof manager.name === "string" ? { orgId: f.id, orgName: f.name, managerId, manager } : null;
    })
    .filter((v): v is { orgId: string; orgName: string; managerId: string; manager: AgentConfig } => v !== null)
    // 组织无自身时间戳——以管理者活跃度合成键降序，与队友/团队同语义
    .sort((a, b) => activityAt(b.manager.updated_at, lastMsg[b.managerId]) - activityAt(a.manager.updated_at, lastMsg[a.managerId]));

  // ── 列表规模化：整区折叠 + 虚拟滚动（视口 8 行，可滚全部）+ 区头局部搜索 ──
  const SECTION_ROW_H = 40;   // 列表行高（px，与行渲染一致）
  const SECTION_VIEW_ROWS = 8; // 虚拟视口默认可见行数
  const [agentQuery, setAgentQuery] = useState("");
  const [teamQuery, setTeamQuery] = useState("");
  const [orgQuery, setOrgQuery] = useState("");

  // 过滤命中集（空查询 = null 表示不过滤）；非过滤态封顶前 10（置顶区不受限）
  const agentQueryLower = agentQuery.trim().toLowerCase();
  const teamQueryLower = teamQuery.trim().toLowerCase();
  const agentFiltered = agentQueryLower
    ? unpinnedEntries.filter(([, a]) => a.name.toLowerCase().includes(agentQueryLower))
    : null;
  const teamFiltered = teamQueryLower
    ? teamEntriesSorted.filter(([, t]) => t.name.toLowerCase().includes(teamQueryLower))
    : null;
  const unpinnedVisible = agentFiltered ?? unpinnedEntries;
  const teamsVisible = teamFiltered ?? teamEntriesSorted;
  const orgQueryLower = orgQuery.trim().toLowerCase();
  const orgFiltered = orgQueryLower
    ? orgEntries.filter(o => o.orgName.toLowerCase().includes(orgQueryLower) || o.manager.name.toLowerCase().includes(orgQueryLower))
    : null;
  const orgVisible = orgFiltered ?? orgEntries;
  // 置顶分区：orgPinned 顺序优先，其余按活跃度（orgEntries 已排）
  const orgLiveIds = new Set(orgEntries.map(o => o.orgId));
  const orgPinnedLive = orgPinned.filter(id => orgLiveIds.has(id));
  const orgPinnedSet = new Set(orgPinnedLive);
  const orgUnpinned = orgEntries.filter(o => !orgPinnedSet.has(o.orgId));
  const orgUnpinnedVisible = orgFiltered ? orgFiltered.filter(o => !orgPinnedSet.has(o.orgId)) : orgUnpinned;

  // 画布化改造：不再有 rail 视图/拖宽柄——侧栏整体转为悬浮件

  return (
    <>
      {/* 顶部居中悬浮搜索框：固定视口，不随画布 pan/zoom 移动；透明+细描边 */}
      <div className="fixed left-1/2 top-3 z-40 -translate-x-1/2">
        <GlobalSearchBar
          agents={agents}
          teams={teams}
          aiOrg={aiOrg}
          folderHref={folderHref}
          floating
        />
      </div>

      {/* 画布化改造：非画布路由的返回胶囊——与画布内返回胶囊同语言，
          堵住「进入设置/杂事箱等页面后无入口回画布」的回归洞 */}
      {!pathname.startsWith("/company") && (
        <div className="fixed left-1/2 top-14 z-40 flex -translate-x-1/2 items-center gap-0.5 rounded-md border border-border/60 bg-transparent px-1.5 py-1 text-xs backdrop-blur-[2px]">
          <span className="mr-1 max-w-40 truncate text-muted-foreground">
            {pageLabelOf(pathname)}
          </span>
          <Link
            href="/company"
            className="flex items-center gap-0.5 rounded px-1.5 py-0.5 text-muted-foreground transition-colors hover:bg-muted/60 hover:text-primary"
            title="回到 AI 组织根大画布"
          >
            <ChevronLeft className="h-3 w-3" />
            大画布
          </Link>
        </div>
      )}

      {/* 左侧悬浮按钮组（island 式：同容器纵向堆叠，杜绝独立
          定位重叠——原 top-16/top-[4.25rem] 两钮垂直重叠 32px）。
          图标 20px（容器 36px） */}
      <div className="fixed left-4 top-16 z-40 flex flex-col overflow-hidden rounded-lg border border-border/60 bg-background/85 backdrop-blur-sm">
        <button
          ref={floatBtnRef}
          onClick={() => { setFloatOpen(v => !v); if (!floatOpen) setSubPage(null); }}
          className={cn(
            "flex h-9 w-9 items-center justify-center transition-colors",
            floatOpen
              ? "bg-primary/10 text-foreground"
              : "text-muted-foreground hover:text-foreground hover:bg-muted/60",
          )}
          title="组织 / 杂事箱 / 项目 / 队友 / 团队"
        >
          <Bot className="h-5 w-5" />
        </button>
        <div className="h-px bg-border/60" />
        {/* Bot City 3D 城市视图切换钮——在 3D 页再点
            即回画布（toggle 语义，city 页原「← 画布」返回钮已删） */}
        <button
          type="button"
          onClick={() => router.push(pathname.startsWith("/company/city") ? "/company" : "/company/city")}
          className={cn(
            "flex h-9 w-9 items-center justify-center transition-colors",
            pathname.startsWith("/company/city")
              ? "bg-primary/10 text-foreground"
              : "text-muted-foreground hover:text-foreground hover:bg-muted/60",
          )}
          title={pathname.startsWith("/company/city") ? "返回画布" : "Bot City 3D 城市"}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
            <path d="M3 21h18" />
            <path d="M5 21V7l7-4 7 4v14" />
            <path d="M9 21v-6h6v6" />
          </svg>
        </button>
      </div>

      {/* 左侧浮层：跟随主题半透明底+毛玻璃，与悬浮按钮同语言 */}
      {floatOpen && (
        <aside
          ref={floatPanelRef}
          className="fixed left-3 top-28 z-40 flex max-h-[calc(100vh-9rem)] w-52 flex-col rounded-lg border border-border/60 bg-background/85 backdrop-blur-sm"
        >
      <div>
      {/* Navigation */}
      <div className="px-3 pt-0.5 pb-1 space-y-0.5">
        {/* 目标：占位入口（页面未建，点击提示即将推出） */}
        <button
          onClick={() => window.alert("目标管理即将推出，敬请期待")}
          className="flex w-full items-center gap-2.5 px-3 py-1.5 text-sm text-muted-foreground/60 cursor-not-allowed transition-colors hover:text-muted-foreground"
          title="即将推出"
        >
          <Target className="h-3.5 w-3.5" />
          目标
          <span className="ml-auto text-[9px] text-muted-foreground/60">即将推出</span>
        </button>
        {[
          { href: "/inbox", label: "收纳箱", icon: Inbox },
        ].map(({ href, label, icon: Icon }: { href: string; label: string; icon: typeof Inbox }) => {
          const active = pathname === href || pathname.startsWith(href + "/");
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-2.5 px-3 py-1.5 text-sm transition-colors",
                active
                  ? "text-foreground bg-accent"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted"
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </Link>
          );
        })}
      </div>

      {/* 画布化改造：队友/团队不再向下展开——改为右侧滑出第二页（见 subPanel） */}
      <div className="flex-1 overflow-y-auto px-3 pt-2 pb-2">
        <button
          onClick={() => setSubPage(subPage === "agents" ? null : "agents")}
          onMouseEnter={() => { cancelSubClose(); setSubPage("agents"); }}
          onMouseLeave={scheduleSubClose}
          className={cn(
            "flex w-full items-center justify-between rounded-md px-3 py-1.5 text-sm transition-colors",
            subPage === "agents"
              ? "bg-accent text-accent-foreground"
              : "text-muted-foreground hover:text-foreground hover:bg-muted",
          )}
        >
          <span className="flex items-center gap-2.5"><Users className="h-3.5 w-3.5" />我的队友</span>
          <span className="flex items-center gap-1 text-[10px]">
            {agentEntries.length}
            <ChevronRight className="h-3 w-3" />
          </span>
        </button>
        <button
          onClick={() => setSubPage(subPage === "teams" ? null : "teams")}
          onMouseEnter={() => { cancelSubClose(); setSubPage("teams"); }}
          onMouseLeave={scheduleSubClose}
          className={cn(
            "mt-0.5 flex w-full items-center justify-between rounded-md px-3 py-1.5 text-sm transition-colors",
            subPage === "teams"
              ? "bg-accent text-accent-foreground"
              : "text-muted-foreground hover:text-foreground hover:bg-muted",
          )}
        >
          <span className="flex items-center gap-2.5"><UsersRound className="h-3.5 w-3.5" />我的团队</span>
          <span className="flex items-center gap-1 text-[10px]">
            {teamEntries.length}
            <ChevronRight className="h-3 w-3" />
          </span>
        </button>
        <button
          onClick={() => setSubPage(subPage === "orgs" ? null : "orgs")}
          onMouseEnter={() => { cancelSubClose(); setSubPage("orgs"); }}
          onMouseLeave={scheduleSubClose}
          className={cn(
            "mt-0.5 flex w-full items-center justify-between rounded-md px-3 py-1.5 text-sm transition-colors",
            subPage === "orgs"
              ? "bg-accent text-accent-foreground"
              : "text-muted-foreground hover:text-foreground hover:bg-muted",
          )}
        >
          <span className="flex items-center gap-2.5"><FolderTree className="h-3.5 w-3.5" />我的组织</span>
          <span className="flex items-center gap-1 text-[10px]">
            {orgEntries.length}
            <ChevronRight className="h-3 w-3" />
          </span>
        </button>
        {/* 主题切换：凹陷分段式，图标占行高 80%。
            视觉语言：10px 圆角凹槽+选中段实心主色沉槽（非凸起药丸），hover 染主色 */}
        <div className="mt-1.5 flex w-full items-center justify-center">
          <div className="flex items-center rounded-[10px] border bg-muted p-0.5">
            <button
              onClick={() => setTheme("light")}
              className={cn(
                "flex h-8 w-10 items-center justify-center rounded-[8px] transition-all",
                resolvedTheme === "light"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground/50 hover:text-primary",
              )}
              title="浅色模式"
            >
              <Sun className="h-6 w-6" />
            </button>
            <button
              onClick={() => setTheme("dark")}
              className={cn(
                "flex h-8 w-10 items-center justify-center rounded-[8px] transition-all",
                resolvedTheme === "dark"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground/50 hover:text-primary",
              )}
              title="深色模式"
            >
              <Moon className="h-6 w-6" />
            </button>
          </div>
        </div>
      </div>
      {/* Bottom: Settings + Theme */}
      <div className="border-t px-3 py-2 space-y-0.5">
        <div className="flex items-center gap-1">
          {/* 画布化改造：设置不走路由（路由卸载画布致重排），改为画布上
              模态层——关闭即回原视角；打开时同步收拢本浮层配合暗色虚化 */}
          <button
            onClick={() => { setFloatOpen(false); setSettingsOpen(true); }}
            className="flex items-center gap-2.5 flex-1 px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <Settings className="h-3.5 w-3.5" />
            设置
          </button>
        </div>
      </div>

      {/* 行右键菜单：队友=加入其他群/删除；团队=解散群/移动到组织（与画布同语义） */}
      {rowCtx && rowCtx.kind === "agent" && rowCtx.agentId && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setRowCtx(null)} onContextMenu={(e) => { e.preventDefault(); setRowCtx(null); }} />
          <div
            className="fixed z-50 w-52 rounded-md border bg-card shadow-lg py-1"
            style={{ left: Math.min(rowCtx.x, window.innerWidth - 220), top: Math.min(rowCtx.y, window.innerHeight - 140) }}
          >
            <button
              className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-destructive hover:bg-muted"
              onClick={() => { void rowDeleteAgent(rowCtx.agentId!, rowCtx.agentName ?? ""); setRowCtx(null); }}
            >
              <Trash2 className="h-3.5 w-3.5" /> 删除队友
            </button>
            {(() => {
              const joinedTeams = new Set(
                Object.values(teams ?? {}).filter(t => t.agents.includes(rowCtx.agentId!)).map(t => t.pyb_team_id ?? "")
              );
              const candidates = Object.entries(teams ?? {}).filter(([id]) => !joinedTeams.has(id));
              if (candidates.length === 0) return null;
              return (
                <div className="relative">
                  <button
                    className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-sm text-foreground hover:bg-muted"
                    onClick={() => setRowJoinSub(v => !v)}
                    onMouseEnter={() => setRowJoinSub(true)}
                  >
                    <span className="flex items-center gap-2"><UserPlus className="h-3.5 w-3.5" /> 加入其他群</span>
                    <ChevronRight className={cn("h-3 w-3 transition-transform", rowJoinSub && "rotate-90")} />
                  </button>
                  {rowJoinSub && (
                    <div className="absolute left-full top-0 ml-1 w-48 max-h-64 overflow-y-auto rounded-md border bg-card shadow-lg py-1">
                      {candidates.map(([id, t]) => (
                        <button
                          key={id}
                          className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-foreground hover:bg-muted truncate"
                          onClick={() => { void rowJoinTeam(rowCtx.agentId!, id); setRowCtx(null); }}
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
          </div>
        </>
      )}
      {rowCtx && rowCtx.kind === "team" && rowCtx.teamId && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setRowCtx(null)} onContextMenu={(e) => { e.preventDefault(); setRowCtx(null); }} />
          <div
            className="fixed z-50 w-56 rounded-md border bg-card shadow-lg py-1"
            style={{ left: Math.min(rowCtx.x, window.innerWidth - 230), top: Math.min(rowCtx.y, window.innerHeight - 160) }}
          >
            <button
              className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-destructive hover:bg-muted"
              onClick={() => { void rowDissolveTeam(rowCtx.teamId!, rowCtx.teamName ?? ""); setRowCtx(null); }}
            >
              <Trash2 className="h-3.5 w-3.5" /> 解散群
            </button>
            <div className="relative">
              <button
                className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-sm text-foreground hover:bg-muted"
                onClick={() => setRowMoveSub(v => !v)}
                onMouseEnter={() => setRowMoveSub(true)}
              >
                <span className="flex items-center gap-2"><FolderInput className="h-3.5 w-3.5" /> 移动到组织</span>
                <ChevronRight className={cn("h-3 w-3 transition-transform", rowMoveSub && "rotate-90")} />
              </button>
              {rowMoveSub && (
                <div className="absolute left-full top-0 ml-1 w-56 max-h-72 overflow-y-auto rounded-md border bg-card shadow-lg py-1">
                  <button
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-foreground hover:bg-muted"
                    onClick={() => { rowMoveTeam(rowCtx.teamId!, null); setRowCtx(null); }}
                  >
                    <Network className="h-3 w-3 shrink-0 text-muted-foreground" />
                    AI 组织（根）
                  </button>
                  {(() => {
                    const cur = aiOrg.teamFolder[rowCtx.teamId!];
                    const indentOf = (fid: string): number => {
                      let d = 0;
                      let p = aiOrg.folders.find(f => f.id === fid)?.parentId ?? null;
                      const seen = new Set<string>([fid]);
                      while (p && !seen.has(p)) { seen.add(p); d++; p = aiOrg.folders.find(f => f.id === p)?.parentId ?? null; }
                      return d;
                    };
                    return aiOrg.folders.map((f) => (
                      <button
                        key={f.id}
                        disabled={f.id === cur}
                        className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-foreground hover:bg-muted disabled:opacity-40 truncate"
                        style={{ paddingLeft: `${12 + Math.min(indentOf(f.id), 3) * 12}px` }}
                        onClick={() => { rowMoveTeam(rowCtx.teamId!, f.id); setRowCtx(null); }}
                      >
                        <FolderTree className="h-3 w-3 shrink-0 text-muted-foreground" />
                        <span className="truncate">{f.name}{f.id === cur ? "（当前）" : ""}</span>
                      </button>
                    ));
                  })()}
                </div>
              )}
            </div>
          </div>
        </>
      )}
      </div>
      </aside>
      )}

      {/* 右折叠第二页：白底、顶部单类搜索、无新建钮；列表（置顶/排序/右键）
          机制从浮层原样平移 */}
      {floatOpen && subPage === "agents" && (
        <div
          ref={subPanelRef}
          onMouseEnter={cancelSubClose}
          onMouseLeave={scheduleSubClose}
          className="fixed left-[calc(0.75rem+13rem)] top-28 z-40 flex max-h-[min(calc(100vh-9rem),38rem)] w-72 flex-col rounded-xl border border-border/60 bg-white text-foreground shadow-lg dark:bg-background"
        >
          <div className="border-b border-border/60 px-3 py-2">
            <div className="flex items-center gap-1.5">
              <Search className="h-3 w-3 text-muted-foreground shrink-0" />
              <input
                autoFocus
                value={agentQuery}
                onChange={(e) => setAgentQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Escape") setAgentQuery(""); }}
                placeholder="搜索队友…"
                className="w-full bg-transparent text-xs outline-none text-foreground placeholder:text-muted-foreground"
              />
              <span className="text-[9px] text-muted-foreground shrink-0">
                {agentFiltered ? `${agentFiltered.length}/${unpinnedEntries.length}` : `${unpinnedEntries.length}`}
              </span>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
            <div className="space-y-0.5">
              {agentEntries.length > 0 ? (
                <>
                {/* 置顶区（按 pinned 顺序持久化；空则不渲染分区） */}
                {pinnedLive.length > 0 && (
                  <div className="mb-1 space-y-0.5">
                    {pinnedLive.map(pid => {
                      const entry = agentEntries.find(([id]) => id === pid);
                      if (!entry) return null;
                      const [id, agent] = entry;
                      const href = `/agents/${id}`;
                      const active = pathname === href;
                      return (
                        <div
                          key={id}
                          draggable
                          onDragStart={() => setDragId(id)}
                          onDragOver={e => e.preventDefault()}
                          onDrop={() => {
                            if (dragId && dragId !== id) reorderPinned(dragId, id);
                            setDragId(null);
                          }}
                          onDragEnd={() => setDragId(null)}
                          onContextMenu={(e) => {
                            e.preventDefault();
                            setRowJoinSub(false);
                            setRowCtx({ x: e.clientX, y: e.clientY, kind: "agent", agentId: id, agentName: agent.name });
                          }}
                          className={cn(
                            "flex items-center gap-2.5 px-2 text-sm transition-colors group cursor-grab",
                            active
                              ? "bg-accent text-accent-foreground"
                              : "text-foreground bg-muted/50",
                            dragId === id && "opacity-50"
                          )}
                        >
                          <div onClick={() => openRosterDrawer("agent", id)} className="flex cursor-pointer items-center gap-2.5 min-w-0 flex-1">
                            <AgentAvatar
                              agentId={agent.agent_id ?? id}
                              name={agent.name}
                              shape={agent.avatar_shape}
                              colorHex={agent.avatar_color}
                              size={30}
                            />
                            <p className="truncate text-sm leading-tight flex items-center gap-1">
                              {agent.name}
                              {unread.has(id) && id !== activeAgentId && (
                                <span className="h-2 w-2 rounded-full bg-red-500 shrink-0" title="有未读消息" />
                              )}
                            </p>
                          </div>
                          <TimeTail ts={activityAt(agent.updated_at, lastMsg[id])} hideOnHover />
                          <button
                            onClick={() => togglePin(id)}
                            className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground shrink-0"
                            title="取消置顶"
                          >
                            <PinOff className="h-3 w-3" />
                          </button>
                        </div>
                      );
                    })}
                    <div className="border-b my-1" />
                  </div>
                )}
                {/* 非置顶区：Virtuoso 虚拟滚动（活跃度序全区可滚，视口约 8 行） */}
                <div style={{ height: Math.min(unpinnedVisible.length, SECTION_VIEW_ROWS) * SECTION_ROW_H + 8 }}>
                <Virtuoso
                  style={{ height: "100%" }}
                  totalCount={unpinnedVisible.length}
                  itemContent={(index) => {
                  const [id, agent] = unpinnedVisible[index];
                const href = `/agents/${id}`;
                const active = pathname === href;
                return (
                  <div
                    key={id}
                    style={{ height: SECTION_ROW_H }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setRowJoinSub(false);
                      setRowCtx({ x: e.clientX, y: e.clientY, kind: "agent", agentId: id, agentName: agent.name });
                    }}
                    className={cn(
                      "flex items-center gap-2.5 px-2 text-sm transition-colors group",
                      active
                        ? "bg-accent text-accent-foreground"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    )}
                  >
                      <div onClick={() => openRosterDrawer("agent", id)} className="flex cursor-pointer items-center gap-2.5 min-w-0 flex-1">
                          <AgentAvatar
                            agentId={agent.agent_id ?? id}
                            name={agent.name}
                            shape={agent.avatar_shape}
                            colorHex={agent.avatar_color}
                            size={30}
                          />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm leading-tight flex items-center gap-1">
                              {agent.name}
                              {unread.has(id) && id !== activeAgentId && (
                                <span className="h-2 w-2 rounded-full bg-red-500 shrink-0" title="有未读消息" />
                              )}
                            </p>
                            {agent.title ? (
                              <p className="truncate text-[10px] text-muted-foreground leading-tight">
                                {agent.title}
                              </p>
                            ) : null}
                          </div>
                        </div>
                        <TimeTail ts={activityAt(agent.updated_at, lastMsg[id])} hideOnHover />
                        {/* 行操作（hover 浮现）；编辑=进详情页并开身份卡编辑面 */}
                        <div className="hidden group-hover:flex items-center gap-0.5 shrink-0">
                          <button
                            onClick={() => togglePin(id)}
                            className="text-muted-foreground hover:text-foreground p-0.5"
                            title="置顶"
                          >
                            <Pin className="h-3 w-3" />
                          </button>
                          <button
                            onClick={() => openRosterDrawer("agent", id, true)}
                            className="text-muted-foreground hover:text-foreground p-0.5"
                            title="编辑"
                          >
                            <Pencil className="h-3 w-3" />
                          </button>
                          <button
                            onClick={async () => {
                              if (!window.confirm(`确定删除 ${agent.name}？此操作不可撤销。`)) return;
                              try {
                                await deletePybAgent(id);
                                refreshAgents();
                              } catch { /* 静默 */ }
                            }}
                            className="text-muted-foreground hover:text-destructive p-0.5"
                            title="删除"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                  </div>
                );
                  }}
                />
                </div>
                </>
              ) : (
                <p className="px-2 py-3 text-xs text-muted-foreground text-center">暂无队友</p>
              )}
            </div>
          </div>
        </div>
      )}
      {floatOpen && subPage === "teams" && (
        <div
          ref={subPanelRef}
          onMouseEnter={cancelSubClose}
          onMouseLeave={scheduleSubClose}
          className="fixed left-[calc(0.75rem+13rem)] top-28 z-40 flex max-h-[min(calc(100vh-9rem),38rem)] w-72 flex-col rounded-xl border border-border/60 bg-white text-foreground shadow-lg dark:bg-background"
        >
          <div className="border-b border-border/60 px-3 py-2">
            <div className="flex items-center gap-1.5">
              <Search className="h-3 w-3 text-muted-foreground shrink-0" />
              <input
                autoFocus
                value={teamQuery}
                onChange={(e) => setTeamQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Escape") setTeamQuery(""); }}
                placeholder="搜索团队…"
                className="w-full bg-transparent text-xs outline-none text-foreground placeholder:text-muted-foreground"
              />
              <span className="text-[9px] text-muted-foreground shrink-0">
                {teamFiltered ? `${teamFiltered.length}/${teamEntriesSorted.length}` : `${teamEntriesSorted.length}`}
              </span>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
            <div className="space-y-0.5">
              {teamEntriesSorted.length > 0 || teamPinnedLive.length > 0 ? (
                <>
                {/* 群置顶区（teamPinned 顺序；空则不渲染分区） */}
                {teamPinnedLive.length > 0 && (
                  <div className="mb-1 space-y-0.5">
                    {teamPinnedLive.map(pid => {
                      const entry = teamEntries.find(([id]) => id === pid);
                      if (!entry) return null;
                      const [id, team] = entry;
                      const href = `/team/${id}`;
                      const active = pathname === href;
                      return (
                        <div
                          key={id}
                          onContextMenu={(e) => {
                            e.preventDefault();
                            setRowMoveSub(false);
                            setRowCtx({ x: e.clientX, y: e.clientY, kind: "team", teamId: id, teamName: team.name });
                          }}
                          className={cn(
                            "flex items-center gap-2 px-2 text-sm transition-colors group",
                            active
                              ? "bg-accent text-accent-foreground"
                              : "text-foreground bg-muted/50"
                          )}
                        >
                          <div onClick={() => openRosterDrawer("team", id)} className="flex cursor-pointer items-center gap-2 min-w-0 flex-1 py-1.5">
                            <GroupAvatar memberIds={team.agents} agents={agents} size={26} />
                            <p className="truncate text-sm leading-tight flex items-center gap-1">
                              {team.name.toLowerCase().replace(/\s+/g, "-")}
                              {unread.has(id) && id !== activeTeamId && (
                                <span className="h-2 w-2 rounded-full bg-red-500 shrink-0" title="有未读消息" />
                              )}
                            </p>
                          </div>
                          <TimeTail ts={activityAt(team.updated_at, lastMsg[id])} hideOnHover />
                          <button
                            onClick={() => toggleTeamPin(id)}
                            className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground shrink-0"
                            title="取消置顶"
                          >
                            <PinOff className="h-3 w-3" />
                          </button>
                        </div>
                      );
                    })}
                    <div className="border-b my-1" />
                  </div>
                )}
                {/* 群非置顶区：Virtuoso 虚拟滚动（活跃度序全区可滚，视口约 8 行） */}
                <div style={{ height: Math.min(teamsVisible.length, SECTION_VIEW_ROWS) * SECTION_ROW_H + 8 }}>
                <Virtuoso
                  style={{ height: "100%" }}
                  totalCount={teamsVisible.length}
                  itemContent={(index) => {
                  const [id, team] = teamsVisible[index];
                const href = `/team/${id}`;
                const active = pathname === href;
                return (
                  <div
                    key={id}
                    style={{ height: SECTION_ROW_H }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setRowMoveSub(false);
                      setRowCtx({ x: e.clientX, y: e.clientY, kind: "team", teamId: id, teamName: team.name });
                    }}
                    className={cn(
                      "flex items-center gap-2 px-2 text-sm transition-colors group",
                      active
                        ? "bg-accent text-accent-foreground"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    )}
                  >
                    <div onClick={() => openRosterDrawer("team", id)} className="flex cursor-pointer items-center gap-2 min-w-0 flex-1 py-1.5">
                      <GroupAvatar memberIds={team.agents} agents={agents} size={26} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm leading-tight flex items-center gap-1">
                          {team.name.toLowerCase().replace(/\s+/g, "-")}
                          {unread.has(id) && id !== activeTeamId && (
                            <span className="h-2 w-2 rounded-full bg-red-500 shrink-0" title="有未读消息" />
                          )}
                        </p>
                      </div>
                    </div>
                    <TimeTail ts={activityAt(team.updated_at, lastMsg[id])} hideOnHover />
                    <div className="hidden group-hover:flex items-center gap-0.5 shrink-0">
                      <button
                        onClick={() => toggleTeamPin(id)}
                        className="text-muted-foreground hover:text-foreground p-0.5"
                        title="置顶"
                      >
                        <Pin className="h-3 w-3" />
                      </button>
                      <button
                        onClick={() => openRosterDrawer("team", id, true)}
                        className="text-muted-foreground hover:text-foreground p-0.5"
                        title="编辑"
                      >
                        <Pencil className="h-3 w-3" />
                      </button>
                      <button
                        onClick={async () => {
                          if (!window.confirm(`确定删除群 ${team.name}？此操作不可撤销。`)) return;
                          try {
                            await deletePybTeam(id);
                            refreshTeams();
                          } catch { /* 静默 */ }
                        }}
                        className="text-muted-foreground hover:text-destructive p-0.5"
                        title="删除"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                );
                  }}
                />
                </div>
                </>
              ) : (
                <p className="px-2 py-3 text-xs text-muted-foreground text-center">暂无团队</p>
              )}
            </div>
          </div>
        </div>
      )}

      {floatOpen && subPage === "orgs" && (
        <div
          ref={subPanelRef}
          onMouseEnter={cancelSubClose}
          onMouseLeave={scheduleSubClose}
          className="fixed left-[calc(0.75rem+13rem)] top-28 z-40 flex max-h-[min(calc(100vh-9rem),38rem)] w-72 flex-col rounded-xl border border-border/60 bg-white text-foreground shadow-lg dark:bg-background"
        >
          <div className="border-b border-border/60 px-3 py-2">
            <div className="flex items-center gap-1.5">
              <Search className="h-3 w-3 text-muted-foreground shrink-0" />
              <input
                autoFocus
                value={orgQuery}
                onChange={(e) => setOrgQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Escape") setOrgQuery(""); }}
                placeholder="搜索组织…"
                className="w-full bg-transparent text-xs outline-none text-foreground placeholder:text-muted-foreground"
              />
              <span className="text-[9px] text-muted-foreground shrink-0">
                {orgFiltered ? `${orgFiltered.length}/${orgEntries.length}` : `${orgEntries.length}`}
              </span>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
            <div className="space-y-0.5">
              {orgEntries.length > 0 || orgPinnedLive.length > 0 ? (
                <>
                {/* 组织置顶区（orgPinned 顺序；空则不渲染分区） */}
                {orgPinnedLive.length > 0 && (
                  <div className="mb-1 space-y-0.5">
                    {orgPinnedLive.map(pid => {
                      const entry = orgEntries.find(o => o.orgId === pid);
                      if (!entry) return null;
                      const { orgId, orgName, managerId, manager } = entry;
                      return (
                        <div
                          key={orgId}
                          className={cn(
                            "flex items-center gap-2.5 px-2 py-1.5 text-sm transition-colors group",
                            "text-foreground bg-muted/50",
                          )}
                        >
                          <div
                            onClick={() => openRosterDrawer("orgRoom", orgId)}
                            className="flex cursor-pointer items-center gap-2.5 min-w-0 flex-1"
                            title={`打开「${orgName}」组织指挥室`}
                          >
                            <AgentAvatar
                              agentId={manager.agent_id ?? managerId}
                              name={manager.name}
                              shape={manager.avatar_shape}
                              colorHex={manager.avatar_color}
                              size={26}
                            />
                            <p className="truncate text-sm leading-tight flex items-center gap-1">
                              {orgName}
                              {unread.has(`cmdroom_${orgId}`) && (
                                <span className="h-2 w-2 rounded-full bg-red-500 shrink-0" title="指挥室有未读消息" />
                              )}
                            </p>
                          </div>
                          <TimeTail ts={activityAt(manager.updated_at, lastMsg[managerId])} hideOnHover />
                          <button
                            onClick={() => openRosterDrawer("agent", managerId)}
                            className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground shrink-0"
                            title={`与组织管理者单聊（${manager.name}）`}
                          >
                            <Crown className="h-3 w-3" />
                          </button>
                          <button
                            onClick={() => toggleOrgPin(orgId)}
                            className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground shrink-0"
                            title="取消置顶"
                          >
                            <PinOff className="h-3 w-3" />
                          </button>
                        </div>
                      );
                    })}
                    <div className="border-b my-1" />
                  </div>
                )}
                {/* 组织非置顶区：置顶/编辑/解散（与队友/团队行操作同规格） */}
                {orgUnpinnedVisible.map(({ orgId, orgName, managerId, manager }) => (
                  <div
                    key={orgId}
                    className={cn(
                      "flex items-center gap-2.5 px-2 py-1.5 text-sm transition-colors group",
                      "text-muted-foreground hover:bg-muted hover:text-foreground",
                    )}
                  >
                    <div
                      onClick={() => openRosterDrawer("orgRoom", orgId)}
                      className="flex cursor-pointer items-center gap-2.5 min-w-0 flex-1"
                      title={`打开「${orgName}」组织指挥室`}
                    >
                      <AgentAvatar
                        agentId={manager.agent_id ?? managerId}
                        name={manager.name}
                        shape={manager.avatar_shape}
                        colorHex={manager.avatar_color}
                        size={26}
                      />
                      <p className="truncate text-sm leading-tight flex items-center gap-1">
                        {orgName}
                        {unread.has(`cmdroom_${orgId}`) && (
                          <span className="h-2 w-2 rounded-full bg-red-500 shrink-0" title="指挥室有未读消息" />
                        )}
                      </p>
                    </div>
                    <TimeTail ts={activityAt(manager.updated_at, lastMsg[managerId])} hideOnHover />
                    <div className="hidden group-hover:flex items-center gap-0.5 shrink-0">
                      <button
                        onClick={() => openRosterDrawer("agent", managerId)}
                        className="text-muted-foreground hover:text-foreground p-0.5"
                        title={`与组织管理者单聊（${manager.name}）`}
                      >
                        <Crown className="h-3 w-3" />
                      </button>
                      <button
                        onClick={() => toggleOrgPin(orgId)}
                        className="text-muted-foreground hover:text-foreground p-0.5"
                        title="置顶"
                      >
                        <Pin className="h-3 w-3" />
                      </button>
                      <button
                        onClick={() => openRosterDrawer("agent", managerId, true)}
                        className="text-muted-foreground hover:text-foreground p-0.5"
                        title="编辑"
                      >
                        <Pencil className="h-3 w-3" />
                      </button>
                      <button
                        onClick={() => { void dissolveOrg(orgId, orgName); }}
                        className="text-muted-foreground hover:text-destructive p-0.5"
                        title="解散组织"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                ))}
                </>
              ) : (
                <p className="px-2 py-3 text-xs text-muted-foreground text-center">暂无组织</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 设置模态：画布之上暗色虚化 + 居中不透明卡片；点卡片外/Esc 关闭
          即回原画布视角（无路由跳转、无重排） */}
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </>
  );
}

/** 名称展示截断：超 7 字显示前 7 字+…（title 悬浮全名）。 */
function displayName(name: string): string {
  return name.length > 7 ? `${name.slice(0, 7)}…` : name;
}

/** 树枝拐角（└）：创建输入行从父行垂下接住的视觉。 */
function CornerBranch() {
  return (
    <span className="relative block h-4 w-3 shrink-0" aria-hidden>
      <span className="absolute left-1/2 top-0 h-1/2 w-px bg-primary/50" />
      <span className="absolute left-1/2 top-1/2 h-px w-1/2 bg-primary/50" />
    </span>
  );
}

/** 全局搜索/命令入口：搜组织/团队/队友直达（Ctrl K 唤起，↑↓ 选择，Enter 直达，Esc 关闭）。
 *  画布化改造：floating=true 时为视口顶部居中悬浮态——完全透明底+细描边。 */
function GlobalSearchBar({
  agents, teams, aiOrg, folderHref, floating,
}: {
  agents: Record<string, AgentConfig> | null;
  teams: Record<string, TeamConfig> | null;
  aiOrg: AiOrgState;
  folderHref: (id: string) => string;
  floating?: boolean;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);

  // Ctrl+K / Cmd+K 全局唤起
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // 点击外部关闭
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const query = q.trim().toLowerCase();

  type Item = {
    kind: "folder" | "team" | "agent";
    id: string;
    name: string;
    sub: string;
    href: string;
  };
  const items: Item[] = useMemo(() => {
    if (!query) return [];
    const out: Item[] = [];
    for (const f of aiOrg.folders) {
      if (f.name.toLowerCase().includes(query)) {
        out.push({
          kind: "folder", id: f.id, name: f.name,
          sub: "组织", href: folderHref(f.id),
        });
      }
    }
    for (const [id, t] of Object.entries(teams ?? {})) {
      if (t && typeof t.name === "string" && t.name.toLowerCase().includes(query)) {
        out.push({ kind: "team", id, name: t.name, sub: "团队", href: `/team/${id}` });
      }
    }
    for (const [id, a] of Object.entries(agents ?? {})) {
      if (a && typeof a.name === "string" && a.name.toLowerCase().includes(query)) {
        out.push({ kind: "agent", id, name: a.name, sub: "队友", href: `/agents/${id}` });
      }
    }
    return out.slice(0, 12);
  }, [query, aiOrg.folders, teams, agents, folderHref]);

  useEffect(() => { setCursor(0); }, [q]);

  const go = useCallback((item: Item) => {
    router.push(item.href);
    setOpen(false);
    setQ("");
    inputRef.current?.blur();
  }, [router]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setCursor(c => Math.min(c + 1, items.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setCursor(c => Math.max(c - 1, 0)); }
    else if (e.key === "Enter" && items[cursor]) { e.preventDefault(); go(items[cursor]); }
    else if (e.key === "Escape") { setOpen(false); inputRef.current?.blur(); }
  };

  const highlight = (text: string) => {
    if (!query) return text;
    const idx = text.toLowerCase().indexOf(query);
    if (idx < 0) return text;
    return (
      <>
        {text.slice(0, idx)}
        <mark className="bg-primary/25 text-foreground rounded-sm px-0.5">{text.slice(idx, idx + query.length)}</mark>
        {text.slice(idx + query.length)}
      </>
    );
  };

  return (
    <div ref={boxRef} className={floating ? "relative w-72" : "relative px-3 pt-2.5 pb-1"}>
      <div className={cn(
        "flex items-center gap-2 rounded-md border px-2.5 py-2 focus-within:border-primary/60 transition-colors",
        floating
          ? "border-border/60 bg-transparent backdrop-blur-[2px]"
          : "bg-background",
      )}>
        <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="搜索组织 / 团队 / 队友…"
          className="w-full bg-transparent text-xs outline-none placeholder:text-muted-foreground text-foreground"
        />
        <kbd className="hidden sm:inline-flex items-center rounded border px-1 py-0.5 text-[9px] font-mono text-muted-foreground shrink-0">
          Ctrl K
        </kbd>
      </div>

      {open && query && (
        <div className="absolute left-3 right-3 top-full z-50 mt-1 max-h-80 overflow-y-auto rounded-md border bg-popover shadow-lg py-1">
          {items.length === 0 ? (
            <p className="px-3 py-3 text-xs text-muted-foreground text-center">无匹配结果</p>
          ) : (
            items.map((item, i) => (
              <button
                key={`${item.kind}-${item.id}`}
                onClick={() => go(item)}
                onMouseEnter={() => setCursor(i)}
                className={cn(
                  "flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors",
                  i === cursor ? "bg-accent" : "hover:bg-muted/60"
                )}
              >
                {item.kind === "folder" ? (
                  <FolderTree className="h-3.5 w-3.5 text-primary shrink-0" />
                ) : item.kind === "team" ? (
                  <UsersRound className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                ) : (
                  <AgentAvatar
                    agentId={item.id}
                    name={item.name}
                    size={16}
                  />
                )}
                <span className="truncate text-xs text-foreground flex-1">{highlight(item.name)}</span>
                <span className="text-[9px] text-muted-foreground shrink-0">{item.sub}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

