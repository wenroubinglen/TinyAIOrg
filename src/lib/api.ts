// 兜底默认为 daemon 面 3779（桌面约定端口）。解析优先级不变：壳 preload 注入（恒正确，
// 含锁文件动态端口）> 构建期 env > localStorage（/control 手动覆盖）> 兜底。
declare global {
  interface Window {
    pybDesktop?: { apiBase?: string };
  }
}

const DEFAULT_API_BASE = "http://127.0.0.1:3779";
const STORAGE_KEY = "pyb-desktop_api_base";

/** Resolve the API base URL. Priority: preload > env > localStorage > default. */
export function getApiBase(): string {
  if (typeof window !== "undefined" && window.pybDesktop?.apiBase) {
    return window.pybDesktop.apiBase;
  }
  if (process.env.NEXT_PUBLIC_API_URL) return process.env.NEXT_PUBLIC_API_URL;
  if (typeof window !== "undefined") {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) return stored;
  }
  return DEFAULT_API_BASE;
}

/** Persist a custom API base URL in localStorage. Pass null to reset to default. */
export function setApiBase(url: string | null): void {
  if (url) {
    localStorage.setItem(STORAGE_KEY, url);
  } else {
    localStorage.removeItem(STORAGE_KEY);
  }
}

export type DaemonHealthState =
  | "dead" // daemon 进程不在（连接失败）
  | "degraded" // daemon 活着但引擎未 hosted（握手失败/重启中）
  | "hosted"; // 全链路健康

/** daemon 三态健康探测——/health 的 engine 字段区分
 * 「daemon 活但引擎 degraded」与「daemon 死」。旧 checkConnection 探
 * /api/settings（恒 200），误导用户把引擎故障当连接故障。 */
export async function checkDaemonHealth(
  baseUrl?: string,
): Promise<DaemonHealthState> {
  const base = baseUrl ?? getApiBase();
  try {
    const res = await fetch(`${base}/health`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return "dead";
    const body = (await res.json().catch(() => null)) as {
      engine?: string;
    } | null;
    if (body?.engine === "hosted") return "hosted";
    return "degraded";
  } catch {
    return "dead";
  }
}

/** Check if the PYB API is reachable at the given (or current) base URL. */
export async function checkConnection(baseUrl?: string): Promise<boolean> {
  const base = baseUrl ?? getApiBase();
  try {
    const res = await fetch(`${base}/api/settings`, {
      signal: AbortSignal.timeout(3000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const API_BASE = getApiBase();
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...options?.headers },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || res.statusText);
  }
  return res.json();
}

// ── Types ─────────────────────────────────────────────────────────────────

export interface AgentConfig {
  name: string;
  provider: string;
  model: string;
  working_directory: string;
  system_prompt?: string;
  prompt_file?: string;
  heartbeat?: {
    enabled?: boolean;
    interval?: number;
  };
  kind?: "pyb-coupled";
  agent_id?: string;
  /** 引擎 agent_profile 扩展字段（v1.5.333 起全链返回） */
  description?: string;
  status?: string;
  title?: string | null;
  avatar_shape?: string | null;
  avatar_color?: string | null;
  permission_mode?: string;
  /** 系统区 updatedAt（profile 变更时 bump）——活跃度合成键的一半 */
  updated_at?: number;
}

export interface TeamConfig {
  name: string;
  agents: string[];
  leader_agent: string;
  /** 引擎 org 侧 leader 派生（leader_agent_id_org）——与
   * leader_agent 双源取或（显式优先），3D 皇冠数据源。 */
  leader_agent_org?: string;
  /** 团队挂靠组织（folder_id）——团队地块归属组织圆的依据；
   * 无此字段=无组织归属团队（独立团队区）。 */
  folder_id?: string;
  /** D 柱：群职能描述（引擎必填；读侧经 pyb/team.list 投影返回）。 */
  description?: string;
  kind?: "pyb-coupled";
  pyb_team_id?: string;
  /** P2（group-leader-model）：成员 role 标签——'leader' 为约定接口成员名
   * （Crown 渲染数据源；无标签=平权群）。 */
  member_roles?: Array<{ agent_id: string; role: string }>;
  /** L3 活跃度（引擎 team.list updated_at，1.5.336 起）——sidebar 群排序键。 */
  updated_at?: number;
}

export interface Settings {
  workspace?: { path?: string; name?: string };
  models?: {
    provider?: string;
    anthropic?: { model?: string; api_key?: string; oauth_token?: string };
    openai?: { model?: string; api_key?: string };
    opencode?: { model?: string };
  };
  agents?: Record<string, AgentConfig>;
  teams?: Record<string, TeamConfig>;
  monitoring?: { heartbeat_interval?: number };
}

export interface QueueStatus {
  incoming: number;
  queued: number;
  processing: number;
  outgoing: number;
  activeConversations: number;
}

export interface ProcessingMessage {
  id: number;
  messageId: string;
  channel: string;
  sender: string;
  message: string;
  agent: string;
  status: "queued" | "processing";
  processAlive: boolean;
  startedAt: number;
  duration: number;
}

export interface ResponseData {
  channel: string;
  sender: string;
  message: string;
  originalMessage: string;
  timestamp: number;
  messageId: string;
  agent?: string;
  files?: string[];
}

export interface EventData {
  type: string;
  timestamp: number;
  [key: string]: unknown;
}

export interface AgentMessage {
  id: number;
  agent_id: string;
  role: "user" | "assistant";
  channel: string;
  sender: string;
  message_id: string;
  content: string;
  created_at: number;
}

// ── API Functions ─────────────────────────────────────────────────────────

export async function getAgents(): Promise<Record<string, AgentConfig>> {
  // apiBase=3779（daemon 面），引擎侧 /api/agents 返回
  // {activeAgents,allAgents} 数组形状——非 settings 投影 Record。改打
  // /api/pyb-agents（与 CRUD 同源，真相源=引擎 agent_profile），投影回
  // Record<string,AgentConfig> 保持全部消费方（sidebar/agents/control/teams）
  // 形状兼容。0.1.9 事故根因：旧实现静默拿错形状数据，渲染期 .slice 崩。
  type PybAgentsResponse = {
    agents: Array<{
      agent_id: string;
      name: string;
      description?: string;
      status?: string;
      title?: string;
      avatar_shape?: string;
      avatar_color?: string;
      permission_mode?: string;
      updated_at?: number;
    }>;
  };
  const res = await apiFetch<PybAgentsResponse>("/api/pyb-agents");
  const out: Record<string, AgentConfig> = {};
  for (const a of res.agents ?? []) {
    if (!a?.agent_id || !a?.name) continue;
    out[a.agent_id] = {
      name: a.name,
      provider: "pyb-host",
      model: "",
      working_directory: "",
      kind: "pyb-coupled",
      agent_id: a.agent_id,
      description: a.description ?? "",
      status: a.status ?? "",
      title: a.title ?? null,
      avatar_shape: a.avatar_shape ?? null,
      avatar_color: a.avatar_color ?? null,
      permission_mode: a.permission_mode ?? "",
      updated_at: a.updated_at ?? 0,
    };
  }
  return out;
}

export async function getTeams(): Promise<Record<string, TeamConfig>> {
  // 同上：daemon 面 /api/pyb-teams 数组形状 → 投影 Record<string,TeamConfig>。
  const res = await apiFetch<{
    teams: Array<{
      team_id: string;
      name: string;
      member_agent_ids?: string[];
      leader_agent_id?: string;
      leader_agent_id_org?: string;
      folder_id?: string;
      member_roles?: Array<{ agent_id: string; role: string }>;
      updated_at?: number;
      description?: string;
    }>;
  }>("/api/pyb-teams");
  const out: Record<string, TeamConfig> = {};
  for (const t of res.teams ?? []) {
    if (!t?.team_id || !t?.name) continue;
    out[t.team_id] = {
      name: t.name,
      agents: t.member_agent_ids ?? [],
      leader_agent: t.leader_agent_id ?? "",
      ...(t.leader_agent_id_org
        ? { leader_agent_org: t.leader_agent_id_org }
        : {}),
      ...(t.folder_id ? { folder_id: t.folder_id } : {}),
      ...(t.description?.trim() ? { description: t.description } : {}),
      kind: "pyb-coupled",
      pyb_team_id: t.team_id,
      updated_at: t.updated_at ?? 0,
      ...(t.member_roles?.length ? { member_roles: t.member_roles } : {}),
    };
  }
  return out;
}

export async function getSettings(): Promise<Settings> {
  return apiFetch("/api/settings");
}

export async function searchRegistrySkills(
  agentId: string,
  query: string,
): Promise<{
  results: { ref: string; installs?: string; url?: string }[];
  raw?: string;
}> {
  const q = encodeURIComponent(query);
  return apiFetch(
    `/api/agents/${encodeURIComponent(agentId)}/skills/registry?query=${q}`,
  );
}

export async function installRegistrySkill(
  agentId: string,
  ref: string,
): Promise<{ ok: boolean; output: string }> {
  return apiFetch(`/api/agents/${encodeURIComponent(agentId)}/skills/install`, {
    method: "POST",
    body: JSON.stringify({ ref }),
  });
}

// ─── per-agent 技能管理（引擎三视图 API）───

export type AgentSkillEntry = {
  name: string;
  /** 显示名：frontmatter.name 回退目录名；name 是不可变调用键 */
  displayName?: string;
  description: string;
  bucket: "bundled" | "shared" | "private";
  enabled: boolean;
  canDisable: boolean;
  canRemove: boolean;
  /** 共享池存在同名副本（仅 private 有意义） */
  published?: boolean;
};

export async function listAgentSkills(
  agentId: string,
): Promise<{ skills: AgentSkillEntry[] }> {
  return apiFetch(
    `/api/pyb/agent-skills?agentId=${encodeURIComponent(agentId)}`,
  );
}

export async function toggleAgentSkill(
  agentId: string,
  skillName: string,
  enabled: boolean,
): Promise<{ ok: boolean }> {
  return apiFetch("/api/pyb/agent-skills/toggle", {
    method: "PUT",
    body: JSON.stringify({ agentId, skillName, enabled }),
  });
}

export async function removeAgentSkill(
  agentId: string,
  skillName: string,
): Promise<{ ok: boolean }> {
  return apiFetch("/api/pyb/agent-skills/remove", {
    method: "DELETE",
    body: JSON.stringify({ agentId, skillName }),
  });
}

export async function updateAgentSkill(
  agentId: string,
  skillName: string,
  spec: { name: string; description: string; content: string },
): Promise<{ ok: boolean; entry?: AgentSkillEntry }> {
  return apiFetch("/api/pyb/agent-skills/update", {
    method: "PUT",
    body: JSON.stringify({ agentId, skillName, spec }),
  });
}

export async function publishAgentSkillAction(
  agentId: string,
  skillName: string,
  action: "publish" | "resync" | "unpublish",
): Promise<{ ok: boolean; published?: boolean }> {
  return apiFetch("/api/pyb/agent-skills/publish", {
    method: "POST",
    body: JSON.stringify({ agentId, skillName, action }),
  });
}

// 创建/导入私有技能两端点的 UI 封装
export async function createAgentSkill(
  agentId: string,
  spec: {
    name: string;
    description: string;
    content: string;
    /** 可选调用键（中文显示名时填英文 id） */
    slug?: string;
  },
): Promise<{ ok: boolean; entry?: AgentSkillEntry }> {
  const { slug, ...rest } = spec;
  return apiFetch("/api/pyb/agent-skills/create", {
    method: "POST",
    body: JSON.stringify({
      agentId,
      spec: slug ? { ...rest, slug } : rest,
    }),
  });
}

export async function importAgentSkill(
  agentId: string,
  input:
    | { kind: "markdown"; markdown: string; slug?: string }
    | { kind: "url"; url: string; slug?: string },
): Promise<{ ok: boolean; entry?: AgentSkillEntry }> {
  return apiFetch("/api/pyb/agent-skills/import", {
    method: "POST",
    body: JSON.stringify({ agentId, ...input }),
  });
}

// ─── 技能 cron 触发器（daemon /v1/scheduled-tasks）───

export type ScheduledTask = {
  taskId: string;
  cron: string;
  prompt: string;
  name?: string;
  status?: string;
  /** 引擎 ListedScheduledTaskToolItem 实有字段（toListedItem 恒返回）——
   * join 类型徽章（one_shot/recurring）依赖 */
  scheduleKind?: "one_shot" | "recurring";
  recipient?: { kind?: string; agentId?: string } | null;
  nextFireAt?: number | null;
  validFrom?: string | null;
  expiresAt?: string | null;
};

export async function listScheduledTasks(): Promise<ScheduledTask[]> {
  const res = (await apiFetch("/v1/scheduled-tasks")) as {
    success: boolean;
    data?: { tasks?: ScheduledTask[] };
  };
  return res.data?.tasks ?? [];
}

/** 定时任务运行记录（引擎 ScheduledTaskRun 投影） */
export type ScheduledTaskRunLite = {
  runId: string;
  taskId: string;
  status: string;
  triggeredAt: number;
  completedAt?: number | null;
};

/** 全局近期运行（按触发时间倒序，引擎默认 50 条） */
export async function listRecentScheduledTaskRuns(
  limit?: number,
): Promise<ScheduledTaskRunLite[]> {
  const q = limit ? `?limit=${limit}` : "";
  const res = (await apiFetch(`/v1/scheduled-tasks/runs${q}`)) as {
    success: boolean;
    data?: { runs?: ScheduledTaskRunLite[] };
  };
  return res.data?.runs ?? [];
}

/** Test run——手动触发一次（triggerKind=manual，不改变调度） */
export async function triggerScheduledTaskRun(
  taskId: string,
): Promise<{ ok: boolean; runId?: string; error?: string }> {
  const res = (await apiFetch(
    `/v1/scheduled-tasks/${encodeURIComponent(taskId)}/run`,
    { method: "POST", body: JSON.stringify({}) },
  )) as {
    success: boolean;
    data?: { run?: { runId?: string } };
    error?: { message?: string };
  };
  return {
    ok: res.success,
    runId: res.data?.run?.runId,
    error: res.error?.message,
  };
}

/** 桌面直建走 daemon 正门（pyb/cron.create RPC——显式 agentId 写锚）。
 * 引擎契约：cron XOR delayMinutes；delay 禁 recurring/validFrom/timezone；
 * expiresAt 须晚于首次触发。
 * recipient 二选一——agentId（单聊，agent 库）或 groupId（群/指挥室，
 * 群库——用户特权通道）。 */
export async function createScheduledTask(opts: {
  prompt: string;
  /** 二选一：单聊面 agentId / 群·指挥室面 groupId */
  agentId?: string;
  groupId?: string;
  cron?: string;
  recurring?: boolean;
  delayMinutes?: number;
  validFrom?: string;
  expiresAt?: string;
  timezone?: string;
}): Promise<{
  ok: boolean;
  taskId?: string;
  nextFireAt?: number | null;
  error?: string;
}> {
  const base =
    opts.groupId != null
      ? `/api/pyb-teams/${encodeURIComponent(opts.groupId)}/cron`
      : `/api/pyb-agents/${encodeURIComponent(opts.agentId ?? "")}/cron`;
  const res = (await apiFetch(base, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt: opts.prompt,
      ...(opts.cron ? { cron: opts.cron } : {}),
      ...(opts.delayMinutes !== undefined
        ? { delayMinutes: opts.delayMinutes }
        : {}),
      ...(opts.recurring !== undefined ? { recurring: opts.recurring } : {}),
      ...(opts.validFrom ? { validFrom: opts.validFrom } : {}),
      ...(opts.expiresAt ? { expiresAt: opts.expiresAt } : {}),
      ...(opts.timezone ? { timezone: opts.timezone } : {}),
    }),
  })) as {
    ok?: boolean;
    task?: { taskId?: string; nextFireAt?: number | null };
    error?: string;
  };
  return {
    ok: res.ok === true,
    taskId: res.task?.taskId,
    nextFireAt: res.task?.nextFireAt ?? null,
    error: res.error,
  };
}

export async function createSkillTrigger(opts: {
  agentId: string;
  skillId: string;
  cron: string;
}): Promise<{ taskId?: string }> {
  // 触发器 prompt 模板锚目录名 id（不随显示名改名漂移）。
  // 改走 pyb/cron.create 正门（旧 /v1/scheduled-tasks 直建
  // 被 PYB_CRON_WRITE_REJECTED 拒——HTTP 面无 teammate 写锚）
  const res = (await apiFetch(
    `/api/pyb-agents/${encodeURIComponent(opts.agentId)}/cron`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: `使用 SkillTool 运行技能 /${opts.skillId}，完成后简要汇报执行结果。`,
        cron: opts.cron,
        recurring: true,
      }),
    },
  )) as { ok?: boolean; task?: { taskId?: string } };
  return { taskId: res.task?.taskId };
}

export async function deleteScheduledTask(taskId: string): Promise<void> {
  await apiFetch(`/v1/scheduled-tasks/${encodeURIComponent(taskId)}`, {
    method: "DELETE",
  });
}

/** 触发器-技能匹配：词边界防前缀误配（/foo 不匹配 /foobar）。
 * 模板恒为「…技能 /<id>，…」——以 /<id>+非词字符 定界。 */
export function isSkillTriggerFor(prompt: string, skillId: string): boolean {
  const re = new RegExp(
    `/${skillId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w-])`,
  );
  return re.test(prompt);
}

export async function updateSettings(
  settings: Partial<Settings>,
): Promise<{ ok: boolean; settings: Settings }> {
  return apiFetch("/api/settings", {
    method: "PUT",
    body: JSON.stringify(settings),
  });
}

export async function runSetup(
  settings: Settings,
): Promise<{ ok: boolean; settings: Settings }> {
  return apiFetch("/api/setup", {
    method: "POST",
    body: JSON.stringify(settings),
  });
}

export async function applyServices(): Promise<{
  ok: boolean;
  started: string[];
  heartbeat: boolean;
  errors?: string[];
}> {
  return apiFetch("/api/services/apply", { method: "POST" });
}

export async function getQueueStatus(): Promise<QueueStatus> {
  return apiFetch("/api/queue/status");
}

export async function getProcessingMessages(): Promise<ProcessingMessage[]> {
  return apiFetch("/api/queue/processing");
}

export async function killAgentSession(
  id: number,
): Promise<{ ok: boolean; agent: string; processKilled: boolean }> {
  return apiFetch(`/api/queue/processing/${id}/kill`, { method: "POST" });
}

export async function getResponses(limit = 20): Promise<ResponseData[]> {
  return apiFetch(`/api/responses?limit=${limit}`);
}

export async function getLogs(limit = 100): Promise<{ lines: string[] }> {
  return apiFetch(`/api/logs?limit=${limit}`);
}

export async function saveAgent(
  id: string,
  agent: Partial<AgentConfig> &
    Pick<AgentConfig, "name" | "provider" | "model">,
): Promise<{ ok: boolean; agent: AgentConfig }> {
  return apiFetch(`/api/agents/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify(agent),
  });
}

// ── pyb-coupled entities ──────────────────────────────────────────────────

export async function createPybAgent(payload: {
  name: string;
  description: string;
  default_permission_mode?: string;
}): Promise<{ ok: boolean; agent_id: string; created: boolean }> {
  return apiFetch("/api/pyb-agents", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function savePybAgent(
  id: string,
  payload: {
    name?: string;
    description?: string;
    title?: string;
    avatarShape?: string;
    avatarColor?: string;
  },
): Promise<{ ok: boolean; agent: AgentConfig }> {
  return apiFetch(`/api/pyb-agents/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

/** 头像字节通道——daemon PUT /:id/avatar（写 entities/<id>/
 * avatar.png，写后 watcher 触发 agent.profile.changed 广播 roster 刷新）。 */
export async function uploadPybAgentAvatar(
  id: string,
  file: File,
): Promise<{ ok: boolean }> {
  const bytes = await file.arrayBuffer();
  const res = await fetch(
    `${getApiBase()}/api/pyb-agents/${encodeURIComponent(id)}/avatar`,
    {
      method: "PUT",
      headers: { "Content-Type": file.type || "image/png" },
      body: bytes,
    },
  );
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || res.statusText);
  }
  return res.json();
}

/** 头像 URL（daemon GET /:id/avatar；缺失 404 时前端兜底 initials）。 */
export function pybAgentAvatarUrl(id: string): string {
  return `${getApiBase()}/api/pyb-agents/${encodeURIComponent(id)}/avatar`;
}

/** 附件引用（服务端 MessageAttachmentRef 的前端
 * 镜像——apps/ 不能直接 import src/，形状以
 * src/app/sessionHost/messageAttachment.ts 为单一真相源手工同步）。 */
export interface AttachmentRef {
  id: string;
  kind: "image" | "pdf" | "video" | "audio" | "text" | "file";
  name: string;
  size: number;
  mediaType?: string;
}

/** 上传附件（raw fetch——apiFetch 是 JSON 专用，
 * avatar 上传同款先例）。owner=聊天对象 agentId 或群 teamId；响应回
 * 元数据（id 服务端铸名，send 时回显——客户端永不传 path）。 */
export async function uploadAttachment(
  ownerId: string,
  file: File,
): Promise<AttachmentRef> {
  const bytes = await file.arrayBuffer();
  const res = await fetch(
    `${getApiBase()}/api/attachments/${encodeURIComponent(ownerId)}?name=${encodeURIComponent(file.name)}`,
    {
      method: "PUT",
      headers: { "Content-Type": file.type || "application/octet-stream" },
      body: bytes,
    },
  );
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || res.statusText);
  }
  return res.json();
}

/** 附件字节 URL（渲染卡片 <img>/下载用）。 */
export function attachmentByteUrl(ownerId: string, attId: string): string {
  return `${getApiBase()}/api/attachments/${encodeURIComponent(ownerId)}/${encodeURIComponent(attId)}`;
}

export async function deletePybAgent(id: string): Promise<{ ok: boolean }> {
  return apiFetch(`/api/pyb-agents/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

export async function createPybTeam(payload: {
  name: string;
  /** D 柱：群职能描述（引擎三面必填执法）。 */
  description: string;
  members: string[];
  /** P2（group-leader-model）：可选 leader 成员 id——role:'leader' 行为标签
   * （群消息默认它先接+prompt 标注），非结构角色、无权限差异。 */
  leader?: string;
}): Promise<{ ok: boolean; created: boolean; team_id: string }> {
  return apiFetch("/api/pyb-teams", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function savePybTeam(
  id: string,
  payload: {
    members: string[];
    name?: string;
    /** D 柱：可选群职能描述补录（PUT 非空才写）。 */
    description?: string;
    leader?: string;
  },
): Promise<{ ok: boolean }> {
  return apiFetch(`/api/pyb-teams/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export async function deletePybTeam(id: string): Promise<{ ok: boolean }> {
  return apiFetch(`/api/pyb-teams/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

/** 单聊史发言者身份（读侧投影经 HTTP 端点透传）——role='user' 行
 * 合成 {kind:'user'}；旧行无字段=main 代发时代，消费方以 speaker 权威
 * 判用户消息，缺席回退 role。 */
export type PybMessageSpeaker =
  { kind: "user" } | { kind: "agent"; agentId: string };

export async function getPybAgentMessages(agentId: string): Promise<{
  messages: Array<{
    id?: string;
    role: string;
    content: string;
    created_at?: number;
    speaker?: PybMessageSpeaker;
    attachments?: AttachmentRef[];
  }>;
  hasSession: boolean;
}> {
  return apiFetch(`/api/pyb-agents/${encodeURIComponent(agentId)}/messages`);
}

/** 群史（真相源 pyb 库，服务端已做 per-member 聚合）——与 ChatMessage 同构。 */
export async function getPybTeamMessages(
  teamId: string,
  limit = 50,
): Promise<
  Array<{
    id?: string;
    team_id: string;
    from_agent: string;
    message: string;
    created_at: number;
    attachments?: AttachmentRef[];
  }>
> {
  return apiFetch(
    `/api/pyb-teams/${encodeURIComponent(teamId)}/messages?limit=${limit}`,
  );
}

/** 耦合群发送（daemon 面 pyb/group.send）。apiBase 切 daemon 后，
 * 旧 postChatMessage 打的 /api/chatroom/:teamId 在 daemon 面无路由（404）——
 * 发送口随读侧一起切到 /api/pyb-teams/:id/send；channel 由服务端定 'user'，
 * 勿传已废弃的 speaker 参数（引擎 A11 已删写入口）。
 * 可选附件元数据（上传响应回显，path 服务端重拼）。 */
export async function sendPybTeamMessage(
  teamId: string,
  message: string,
  attachments?: AttachmentRef[],
): Promise<{
  ok: boolean;
  delivered?: boolean;
  reason?: string;
  messageId?: string;
  recorded?: boolean;
}> {
  return apiFetch(`/api/pyb-teams/${encodeURIComponent(teamId)}/send`, {
    method: "POST",
    body: JSON.stringify({
      message,
      ...(attachments?.length ? { attachments } : {}),
    }),
  });
}

// ===== 组织指挥室 API =====

/** 指挥室只读视图（引擎派生成员册+存在性；exists=false 不建锚零落盘）。 */
export async function getOrgRoomView(orgId: string): Promise<{
  ok: boolean;
  room: {
    groupId: string;
    orgId: string;
    name: string;
    exists: boolean;
    chairAgentId: string | null;
    memberIds: string[];
  };
}> {
  return apiFetch(`/api/pyb-orgs/${encodeURIComponent(orgId)}/room`);
}

/** 静默幂等创建指挥室（已存在返 already_existed=true）。 */
export async function createOrgRoom(orgId: string): Promise<{
  ok: boolean;
  created: boolean;
  already_existed?: boolean;
  room?: { groupId: string; orgId: string; name: string };
}> {
  return apiFetch(`/api/pyb-orgs/${encodeURIComponent(orgId)}/room`, {
    method: "POST",
  });
}

/** 指挥室用户发言（引擎前缀路由专用端点；响应形状与 team send 乐观对账兼容）。 */
export async function sendOrgRoomMessage(
  orgId: string,
  message: string,
  attachments?: AttachmentRef[],
): Promise<{
  ok: boolean;
  delivered?: boolean;
  reason?: string;
  messageId?: string;
  recorded?: boolean;
}> {
  return apiFetch(`/api/pyb-orgs/${encodeURIComponent(orgId)}/room/send`, {
    method: "POST",
    body: JSON.stringify({
      message,
      ...(attachments?.length ? { attachments } : {}),
    }),
  });
}

export async function deleteAgent(id: string): Promise<{ ok: boolean }> {
  return apiFetch(`/api/agents/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

export async function saveTeam(
  id: string,
  team: TeamConfig,
): Promise<{ ok: boolean; team: TeamConfig }> {
  return apiFetch(`/api/teams/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify(team),
  });
}

export async function deleteTeam(id: string): Promise<{ ok: boolean }> {
  return apiFetch(`/api/teams/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function sendMessage(payload: {
  message: string;
  agent?: string;
  sender?: string;
  channel?: string;
}): Promise<{ ok: boolean; messageId: string }> {
  // agent 目标在场时走 daemon 面 send 端点并携带一等用户
  // 身份（speaker {kind:'user'}）——引擎侧以用户身份落库，不再冒名 main。
  // /api/message 队面通道仅剩无 agent 目标的兜底（CLI web 面兼容路径）。
  if (payload.agent) {
    const res = await apiFetch<{
      ok: boolean;
      delivered: boolean;
      messageId: string | null;
    }>(`/api/pyb-agents/${encodeURIComponent(payload.agent)}/send`, {
      method: "POST",
      body: JSON.stringify({
        message: payload.message,
        speaker: { kind: "user" },
      }),
    });
    return { ok: res.ok, messageId: res.messageId ?? "" };
  }
  return apiFetch("/api/message", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function getAgentMessages(
  agentId: string,
  limit = 100,
  sinceId = 0,
): Promise<AgentMessage[]> {
  const params = new URLSearchParams({
    limit: String(limit),
    since_id: String(sinceId),
  });
  // 形状守卫：daemon 面无此端点（404 throw）——回退空数组。
  try {
    const res = await apiFetch<unknown>(
      `/api/agents/${encodeURIComponent(agentId)}/messages?${params.toString()}`,
    );
    return Array.isArray(res) ? (res as AgentMessage[]) : [];
  } catch {
    return [];
  }
}

// ── Agent Workspace Data ──────────────────────────────────────────────────

export interface WorkspaceSkill {
  id: string;
  name: string;
  description: string;
}

export async function getAgentSkills(
  agentId: string,
): Promise<WorkspaceSkill[]> {
  return apiFetch(`/api/agents/${encodeURIComponent(agentId)}/skills`);
}

export async function getAgentSystemPrompt(
  agentId: string,
): Promise<{ content: string; path: string }> {
  return apiFetch(`/api/agents/${encodeURIComponent(agentId)}/system-prompt`);
}

export async function saveAgentSystemPrompt(
  agentId: string,
  content: string,
): Promise<{ ok: boolean }> {
  return apiFetch(`/api/agents/${encodeURIComponent(agentId)}/system-prompt`, {
    method: "PUT",
    body: JSON.stringify({ content }),
  });
}

export async function getAgentMemory(agentId: string): Promise<{
  index: string;
  files: { name: string; path: string }[];
  memoryDir: string;
}> {
  return apiFetch(`/api/agents/${encodeURIComponent(agentId)}/memory`);
}

export async function getAgentHeartbeat(agentId: string): Promise<{
  content: string;
  path: string;
  enabled: boolean;
  interval?: number;
}> {
  return apiFetch(`/api/agents/${encodeURIComponent(agentId)}/heartbeat`);
}

export async function saveAgentHeartbeat(
  agentId: string,
  data: { content?: string; enabled?: boolean; interval?: number },
): Promise<{ ok: boolean }> {
  return apiFetch(`/api/agents/${encodeURIComponent(agentId)}/heartbeat`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

// ── Tasks ─────────────────────────────────────────────────────────────────

export type TaskStatus = "backlog" | "todo" | "in_progress" | "review" | "done";

export interface Task {
  id: string;
  number: number;
  identifier: string;
  title: string;
  description: string;
  status: TaskStatus;
  assignee: string;
  assigneeType: "agent" | "team" | "";
  projectId?: string;
  createdAt: number;
  updatedAt: number;
}

export async function getTasks(): Promise<Task[]> {
  // apiBase=3779：daemon 面 /api/tasks 返回 {tasks:[...]}（对象包数组），
  // queue 面返回裸数组。形状守卫：两种形状都接，其他形状回退空数组防渲染崩。
  const res = await apiFetch<unknown>("/api/tasks");
  if (Array.isArray(res)) return res as Task[];
  if (
    res &&
    typeof res === "object" &&
    Array.isArray((res as { tasks?: unknown }).tasks)
  ) {
    return (res as { tasks: Task[] }).tasks;
  }
  return [];
}

export async function createTask(
  task: Partial<Task>,
): Promise<{ ok: boolean; task: Task }> {
  return apiFetch("/api/tasks", { method: "POST", body: JSON.stringify(task) });
}

export async function updateTask(
  id: string,
  task: Partial<Task>,
): Promise<{ ok: boolean; task: Task }> {
  return apiFetch(`/api/tasks/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify(task),
  });
}

export async function deleteTask(id: string): Promise<{ ok: boolean }> {
  return apiFetch(`/api/tasks/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function getTask(
  id: string,
): Promise<Task & { commentCount: number }> {
  return apiFetch(`/api/tasks/${encodeURIComponent(id)}`);
}

export async function reorderTasks(
  columns: Record<string, string[]>,
): Promise<{ ok: boolean }> {
  return apiFetch("/api/tasks/reorder", {
    method: "PUT",
    body: JSON.stringify({ columns }),
  });
}

// ── Comments ──────────────────────────────────────────────────────────────

export interface Comment {
  id: string;
  taskId: string;
  author: string;
  authorType: "user" | "agent";
  content: string;
  createdAt: number;
}

export async function getComments(taskId: string): Promise<Comment[]> {
  return apiFetch(`/api/tasks/${encodeURIComponent(taskId)}/comments`);
}

export async function createComment(
  taskId: string,
  data: { author: string; authorType: "user" | "agent"; content: string },
): Promise<{ ok: boolean; comment: Comment }> {
  return apiFetch(`/api/tasks/${encodeURIComponent(taskId)}/comments`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function deleteComment(id: string): Promise<{ ok: boolean }> {
  return apiFetch(`/api/comments/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

// ── Chat Room ────────────────────────────────────────────────────────────

export interface ChatMessage {
  /** 引擎行 id（fo: / ent: / am_ 前缀字符串——乐观条目
   *  对账键）；旧非耦合路径回退 index number。 */
  id: string | number;
  team_id: string;
  from_agent: string;
  /** 引擎群史 speaker 身份（user|agent 二分；旧行缺省）。 */
  speaker?: { kind?: string };
  /** 附件引用（渲染卡片用）。 */
  attachments?: AttachmentRef[];
  message: string;
  created_at: number;
}

export async function getChatMessages(
  teamId: string,
  limit = 100,
  sinceId = 0,
): Promise<ChatMessage[]> {
  return apiFetch(
    `/api/chatroom/${encodeURIComponent(teamId)}?limit=${limit}&since=${sinceId}`,
  );
}

export async function postChatMessage(
  teamId: string,
  message: string,
): Promise<{ ok: boolean }> {
  return apiFetch(`/api/chatroom/${encodeURIComponent(teamId)}`, {
    method: "POST",
    body: JSON.stringify({ message }),
  });
}

// ── Projects ───────────────────────────────────────────────────────────

export interface Project {
  id: string;
  name: string;
  description: string;
  prefix: string;
  color: string;
  status: "active" | "archived";
  createdAt: number;
  updatedAt: number;
}

export async function getProjects(): Promise<Project[]> {
  // 形状守卫（同 getTasks）：daemon 面无 /api/projects（404 会 throw），
  // catch 回退空数组——office 面在 daemon-only 环境显示空列表而非崩。
  try {
    const res = await apiFetch<unknown>("/api/projects");
    if (Array.isArray(res)) return res as Project[];
    return [];
  } catch {
    return [];
  }
}

export async function createProject(
  data: Pick<Project, "name" | "description">,
): Promise<{ ok: boolean; project: Project }> {
  return apiFetch("/api/projects", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function updateProject(
  id: string,
  data: Partial<Omit<Project, "id" | "createdAt">>,
): Promise<{ ok: boolean; project: Project }> {
  return apiFetch(`/api/projects/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

export async function deleteProject(id: string): Promise<{ ok: boolean }> {
  return apiFetch(`/api/projects/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

// ── Schedules ─────────────────────────────────────────────────────────────

export interface Schedule {
  id: string;
  label: string;
  cron: string;
  agentId: string;
  message: string;
  channel: string;
  sender: string;
  enabled: boolean;
  createdAt: number;
  runAt?: string;
}

export async function getSchedules(agentId?: string): Promise<Schedule[]> {
  const params = agentId ? `?agent=${encodeURIComponent(agentId)}` : "";
  // 形状守卫：daemon 面无 /api/schedules（404 throw）——回退空数组。
  try {
    const res = await apiFetch<unknown>(`/api/schedules${params}`);
    return Array.isArray(res) ? (res as Schedule[]) : [];
  } catch {
    return [];
  }
}

export async function createSchedule(data: {
  cron?: string;
  runAt?: string;
  agentId: string;
  message: string;
  label?: string;
  channel?: string;
  sender?: string;
}): Promise<{ ok: boolean; schedule: Schedule }> {
  return apiFetch("/api/schedules", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function updateSchedule(
  id: string,
  data: Partial<Omit<Schedule, "id" | "createdAt">>,
): Promise<{ ok: boolean; schedule: Schedule }> {
  return apiFetch(`/api/schedules/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

export async function deleteSchedule(id: string): Promise<{ ok: boolean }> {
  return apiFetch(`/api/schedules/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

// ── Control Plane ─────────────────────────────────────────────────────────

export async function getSystemStatus(): Promise<{
  status: string;
  version: string;
  uptime: number;
  pid: number;
}> {
  return apiFetch("/api/status");
}

export async function restartService(): Promise<{
  ok: boolean;
  action: string;
}> {
  return apiFetch("/api/services/restart", { method: "POST" });
}

export async function startChannel(
  channelId: string,
): Promise<{ ok: boolean }> {
  return apiFetch(
    `/api/services/channel/${encodeURIComponent(channelId)}/start`,
    { method: "POST" },
  );
}

export async function stopChannel(channelId: string): Promise<{ ok: boolean }> {
  return apiFetch(
    `/api/services/channel/${encodeURIComponent(channelId)}/stop`,
    { method: "POST" },
  );
}

export async function restartChannel(
  channelId: string,
): Promise<{ ok: boolean }> {
  return apiFetch(
    `/api/services/channel/${encodeURIComponent(channelId)}/restart`,
    { method: "POST" },
  );
}

// ── Pairing ───────────────────────────────────────────────────────────────

export interface PairingPending {
  channel: string;
  senderId: string;
  sender: string;
  code: string;
  createdAt: number;
  lastSeenAt: number;
}

export interface PairingApproved {
  channel: string;
  senderId: string;
  sender: string;
  approvedAt: number;
  approvedCode?: string;
}

export interface PairingState {
  pending: PairingPending[];
  approved: PairingApproved[];
}

export async function getPairings(): Promise<PairingState> {
  return apiFetch("/api/pairing");
}

export async function approvePairing(
  code: string,
): Promise<{ ok: boolean; entry?: PairingApproved }> {
  return apiFetch("/api/pairing/approve", {
    method: "POST",
    body: JSON.stringify({ code }),
  });
}

export async function revokePairing(
  channel: string,
  senderId: string,
): Promise<{ ok: boolean }> {
  return apiFetch(
    `/api/pairing/${encodeURIComponent(channel)}/${encodeURIComponent(senderId)}`,
    { method: "DELETE" },
  );
}

export async function dismissPending(code: string): Promise<{ ok: boolean }> {
  return apiFetch(`/api/pairing/pending/${encodeURIComponent(code)}`, {
    method: "DELETE",
  });
}

// ── Custom Providers ──────────────────────────────────────────────────────

export interface CustomProvider {
  name: string;
  harness: "claude" | "codex";
  base_url: string;
  api_key: string;
  model?: string;
}

export async function getCustomProviders(): Promise<
  Record<string, CustomProvider>
> {
  return apiFetch("/api/custom-providers");
}

export async function saveCustomProvider(
  id: string,
  provider: CustomProvider,
): Promise<{ ok: boolean }> {
  return apiFetch(`/api/custom-providers/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify(provider),
  });
}

export async function deleteCustomProvider(
  id: string,
): Promise<{ ok: boolean }> {
  return apiFetch(`/api/custom-providers/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

// ── SSE ───────────────────────────────────────────────────────────────────

export function subscribeToEvents(
  onEvent: (event: EventData) => void,
  onError?: (err: Event) => void,
  eventTypes?: string[],
): () => void {
  const es = new EventSource(`${getApiBase()}/api/events/stream`);

  const handler = (e: MessageEvent) => {
    try {
      onEvent(JSON.parse(e.data));
    } catch {
      /* ignore parse errors */
    }
  };

  // Listen to all known event types (pyb:* = coupled-agent stream)
  const types = eventTypes ?? [
    "message:incoming",
    "agent:invoke",
    "agent:progress",
    "agent:response",
    "agent:mention",
    "message:done",
    "pyb:teammate:message",
    "pyb:host:ready",
    "pyb:host:restarting",
  ];
  for (const type of types) {
    es.addEventListener(type, handler);
  }

  if (onError) es.onerror = onError;

  return () => es.close();
}

// ── 未读游标数据面（daemon HTTP 代理）───────────

export interface PybReadState {
  conversations: Record<string, number>;
  last_msg: Record<string, number>;
}

export async function getPybReadState(): Promise<PybReadState> {
  return apiFetch("/api/pyb-read/state");
}

export async function markPybRead(
  conversationId: string,
  timestampMs?: number,
): Promise<{ ok: boolean }> {
  return apiFetch("/api/pyb-read/mark", {
    method: "POST",
    body: JSON.stringify({
      conversation_id: conversationId,
      ...(typeof timestampMs === "number" ? { timestamp_ms: timestampMs } : {}),
    }),
  });
}

// ── 一等 teammate 数据面（pyb RPC 经 server 代理）────────────────

export interface PybAgentProfile {
  agent_id: string;
  name: string;
  status: string;
  description: string;
  updated_at: number;
  permissions: { note: string };
}

export async function getPybAgentProfile(
  agentId: string,
): Promise<PybAgentProfile> {
  return apiFetch(`/api/pyb-agents/${encodeURIComponent(agentId)}/profile`);
}

/** 聊天窗上下文（挂载点派生——画布 org 节点
 * →{orgId}，团队列成员→{orgId,teamId}，独立聊天页不传=全局窗）。引擎
 * 侧验算盖戳 chatFocus（验证失败静默降级）。 */
export type ChatWindowContext = { orgId?: string; teamId?: string };

export async function sendPybAgentMessage(
  agentId: string,
  message: string,
  attachments?: AttachmentRef[],
  chatContext?: ChatWindowContext,
): Promise<{
  ok: boolean;
  delivered: boolean;
  messageId: string | null;
  reason?: string;
}> {
  // 单聊直发携带一等用户身份——引擎侧 speaker 权威落库，
  // 不再冒名 main（与 sendMessage 的 agent 分支同款，两发送口对齐）。
  // 可选附件元数据（上传响应回显）。
  // 可选窗上下文（画布抽屉传入；缺省=全局窗）。
  return apiFetch(`/api/pyb-agents/${encodeURIComponent(agentId)}/send`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message,
      speaker: { kind: "user" },
      ...(chatContext?.orgId || chatContext?.teamId ? { chatContext } : {}),
      ...(attachments?.length ? { attachments } : {}),
    }),
  });
}

// ── 快照 tab 数据面（zone.list 索引 + zone.read 点入）─────────────

export interface ZoneFileEntry {
  name: string;
  size: number;
  mtimeMs: number;
}

export interface ZoneListResult {
  zone: string;
  files: ZoneFileEntry[];
  exists: boolean;
}

export async function getPybZoneList(
  agentId: string,
  zone: string,
): Promise<ZoneListResult> {
  return apiFetch(
    `/api/pyb-agents/${encodeURIComponent(agentId)}/zone/${zone}`,
  );
}

export async function getPybZoneFile(
  agentId: string,
  zone: string,
  relPath: string,
): Promise<{ content: string; exists: boolean }> {
  return apiFetch(
    `/api/pyb-agents/${encodeURIComponent(agentId)}/zone/${zone}/file?relPath=${encodeURIComponent(relPath)}`,
  );
}

// ── Skills + Schedule 数据面 ──────────────────────────────────────────

export interface SkillEntryRpc {
  name: string;
  description: string;
  source: string;
}

export async function getPybSkills(
  agentId: string,
): Promise<{ skills: SkillEntryRpc[] }> {
  return apiFetch(`/api/pyb-agents/${encodeURIComponent(agentId)}/skills`);
}

export interface CronTaskLite {
  taskId: string;
  name: string;
  cron: string;
  nextFireAt: number | null;
  status: string;
}

export async function getPybCronForAgent(
  agentId: string,
): Promise<{ owned: CronTaskLite[]; assigned: CronTaskLite[] }> {
  return apiFetch(`/api/pyb-agents/${encodeURIComponent(agentId)}/cron`);
}

/** 群/指挥室维度任务列表（用户特权
 * 通道读面——群库全量非终态任务，含 prompt/scheduleKind 供全景面渲染）。 */
export interface GroupCronTaskLite extends CronTaskLite {
  prompt?: string | null;
  scheduleKind?: string | null;
}

export async function getPybCronForGroup(
  groupId: string,
): Promise<{ tasks: GroupCronTaskLite[] }> {
  return apiFetch(`/api/pyb-teams/${encodeURIComponent(groupId)}/cron`);
}

/** 群/指挥室维度删除（用户特权通道删面）。 */
export async function deletePybCronForGroup(
  groupId: string,
  taskId: string,
): Promise<{ ok: boolean }> {
  return apiFetch(
    `/api/pyb-teams/${encodeURIComponent(groupId)}/cron/${encodeURIComponent(taskId)}`,
    {
      method: "DELETE",
    },
  );
}

export async function deletePybCron(
  agentId: string,
  taskId: string,
): Promise<{ ok: boolean }> {
  return apiFetch(
    `/api/pyb-agents/${encodeURIComponent(agentId)}/cron/${encodeURIComponent(taskId)}`,
    {
      method: "DELETE",
    },
  );
}

// ── inbox 数据面 ──────────────────────────────────────────────────────

export interface InboxItemApi {
  item_id: string;
  title: string;
  source: string;
  status: string;
  disposition: string | null;
  target_agent_id: string | null;
  created_at: number;
}

export async function getInbox(): Promise<{ items: InboxItemApi[] }> {
  return apiFetch("/api/inbox");
}

export async function addInboxItem(
  title: string,
): Promise<{ ok: boolean; item_id: string }> {
  return apiFetch("/api/inbox", {
    method: "POST",
    body: JSON.stringify({ title }),
  });
}

export async function removeInboxItem(
  itemId: string,
): Promise<{ ok: boolean }> {
  return apiFetch(`/api/inbox/${encodeURIComponent(itemId)}`, {
    method: "DELETE",
  });
}

export async function clarifyInboxItem(
  itemId: string,
  disposition: string,
  targetAgentId?: string,
): Promise<{ ok: boolean }> {
  return apiFetch(`/api/inbox/${encodeURIComponent(itemId)}/clarify`, {
    method: "POST",
    body: JSON.stringify({
      disposition,
      ...(targetAgentId ? { target_agent_id: targetAgentId } : {}),
    }),
  });
}

// ── 模型配置桥接 API ────────────────────────────────────────────────────

/** 桥接层错误：后端统一 { success, error: { code, message } } 结构 */
export interface BridgeError {
  code: string;
  message: string;
}

async function bridgeFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const API_BASE = getApiBase();
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...options?.headers },
  });
  const body = (await res.json().catch(() => null)) as {
    success?: boolean;
    data?: T;
    error?: BridgeError | string;
  } | null;
  if (!res.ok || !body?.success) {
    const err = body?.error;
    const code = typeof err === "string" ? err : (err?.code ?? "BRIDGE_ERROR");
    const message =
      typeof err === "string" ? err : (err?.message ?? res.statusText);
    // 结构化错误抛出：code 保留 CAS/冲突判别（UI 按 code 分叉提示）
    const e = new Error(message) as Error & { code?: string };
    e.code = code;
    throw e;
  }
  return body.data as T;
}

export type ModelProtocol = "anthropic_compatible" | "openai_compatible";

/** providers 分组条目（overview 投影） */
export interface ProviderGroup {
  providerId: string | null;
  providerLabel: string;
  protocol: string;
  baseUrl: string | null;
  profiles: Array<{
    id: string;
    profileId: string;
    name: string;
    provider: string;
    modelName: string;
    providerId?: string | null;
    providerLabel?: string | null;
    maxTokens?: number;
    contextLength?: number;
    /** D2：测完即记三态（null=未校验） */
    validationStatus?: string | null;
    /** 能力布尔（quirks_json 派生；undefined=未声明——坏 JSON 静默
     * 省略三态语义；false 是显式声明不可滥用） */
    supportsVision?: boolean;
    supportsTools?: boolean;
    supportsVideo?: boolean;
    /** ⑤ badge 双态判据：声明视觉且 override 存在=「视觉已验证」；
     * 声明但无 override=「视觉声明但投递关闭」（手配 fail-closed）。 */
    mediaDeliveryOverride?: string | null;
    /** reasoningEffort 透传（null=未设置） */
    reasoningEffort?: string | null;
    /** 模板来源（'hand'=手配；null=存量行走反查兜底） */
    presetProvenance?: string | null;
    /** 凭据掩码状态（测试按钮可用性判据） */
    apiKeyConfigured?: boolean;
  }>;
}

export interface ModelConfigOverview {
  groups: ProviderGroup[];
  selection: string | null;
  revision: number;
}

export async function getModelConfigOverview(): Promise<ModelConfigOverview> {
  return bridgeFetch("/api/pyb/model-config/overview");
}

/** 内置模板条目（只读投影——唯一编辑对象是引擎源码常量）。
 * D1：branch 区分双分支（model=MODEL_PRESETS / coding=CODING_PRESETS，
 * 与 CLI 两菜单同数据源）；quirks 为 provider 级能力声明——创建链必须
 * 携带落库，否则视觉/override/方言链对桌面模板创建的 profile 失效。 */
export interface ModelPresetEntry {
  id: string;
  branch: "model" | "coding";
  vendorLabel: string;
  protocol: ModelProtocol;
  baseURL: string;
  revision: number;
  models: Array<{
    modelId: string;
    contextLength: number;
    maxOutputTokens?: number;
    supportsTools?: boolean;
    supportsVision?: boolean;
    supportsVideo?: boolean;
    /** 路线 B：单点合并后的完整 quirks（落库形态——桌面创建链透传它，
     * 与 CLI 创建的 profile 能力逐字段等价） */
    mergedQuirks?: Record<string, unknown>;
  }>;
  /** provider 级 quirks（兼容保留——创建链已改消费 mergedQuirks） */
  quirks?: Record<string, unknown>;
  /** 编码分支专属：运行时协议 */
  runtimeProtocol?: string;
}

export async function getModelPresets(): Promise<ModelPresetEntry[]> {
  return bridgeFetch("/api/pyb/model-config/presets");
}

export async function getModelConfigRevision(): Promise<number> {
  const r = await bridgeFetch<{ revision: number }>(
    "/api/pyb/model-config/revision",
  );
  return r.revision;
}

export async function setModelSelection(profileId: string): Promise<void> {
  await bridgeFetch("/api/pyb/model-config/selection", {
    method: "PUT",
    body: JSON.stringify({ profileId }),
  });
}

export interface IdentityUpdateInput {
  name?: string;
  protocol?: ModelProtocol;
  baseUrl?: string | null;
  modelName?: string;
}

export async function updateProfileIdentity(
  profileId: string,
  updates: IdentityUpdateInput,
  expectedRevision: number,
): Promise<void> {
  await bridgeFetch(
    `/api/pyb/profiles/${encodeURIComponent(profileId)}/identity`,
    {
      method: "PUT",
      body: JSON.stringify({ ...updates, expectedRevision }),
    },
  );
}

/** 数值字段更新（maxTokens/contextLength/apiKey + reasoningEffort
 * 编辑（null=显式清空）+ 能力稀疏 overlay（leaves 仅被触碰的能力布尔——
 * 继承基线服务端权威解析，客户端永不传）） */
export async function updateProfileFields(
  profileId: string,
  updates: {
    maxTokens?: number;
    contextLength?: number;
    apiKey?: string;
    reasoningEffort?: string | null;
    quirksOverlay?: { leaves: Record<string, unknown> };
  },
): Promise<void> {
  await bridgeFetch(
    `/api/pyb/profiles/${encodeURIComponent(profileId)}/fields`,
    {
      method: "PUT",
      body: JSON.stringify(updates),
    },
  );
}

export interface DialectProbeResponse {
  probe: {
    openaiDialectConfirmed: boolean;
    anthropicDialectDetected: boolean;
    indeterminate: boolean;
    httpStatus: number;
    detail: string;
  };
  validationStatus: "valid" | "needs_repair" | null;
}

/** 搜索配置投影（GET /api/pyb/websearch 的
 * webSearch 字段——provider{value,source}+apiKey{isSet,source}，key 永不
 * 回传明文；source 三态让 UI 能如实显示生效来源与 project 遮蔽）。 */
export interface WebSearchSettings {
  provider: { value: string; source: "project" | "global" | "default" };
  apiKey: { isSet: boolean; source: "project" | "global" | "env" | "none" };
}

export async function getWebSearchSettings(): Promise<WebSearchSettings> {
  const r = await apiFetch<{ webSearch: WebSearchSettings }>(
    "/api/pyb/websearch",
  );
  return r.webSearch;
}

/** 保存搜索配置（PUT /api/settings/websearch——写 tools.web.search
 * 正确路径，引擎每次调用重读零刷新即保存即生效）。apiKey 语义：缺省=
 * 保持不变、字符串=替换、null=清除。 */
export async function saveWebSearchSettings(input: {
  provider: string;
  apiKey?: string | null;
}): Promise<void> {
  await apiFetch("/api/settings/websearch", {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export async function probeDialect(input: {
  baseURL?: string;
  apiKey?: string;
  model: string;
  protocol: ModelProtocol;
  /** D2：测完即记——携带时探测结果经 updateValidationStatus 回写
   * （F2r 桌面等价物：探测即落库，徽章刷新） */
  profileId?: string;
}): Promise<DialectProbeResponse> {
  return bridgeFetch("/api/pyb/model-config/dialect-probe", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/** profiles CRUD（D3：统一桥接组形态——success 包装 + 结构化错误 code） */
export interface CreateProfileInput {
  name: string;
  protocol: ModelProtocol;
  model_name: string;
  base_url?: string | null;
  credentials?: { api_key?: string };
  max_tokens?: number;
  context_length?: number;
  reasoning_effort?: string | null;
  quirks_json?: string | null;
  /** 模板来源留痕（preset id / 'hand' 手配）——overlay 继承基线主路径 */
  preset_provenance?: string | null;
}

export async function createModelProfile(
  input: CreateProfileInput,
): Promise<{ profile: { profileId: string } }> {
  return bridgeFetch("/api/pyb/profiles", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function deleteModelProfile(profileId: string): Promise<void> {
  await bridgeFetch(`/api/pyb/profiles/${encodeURIComponent(profileId)}`, {
    method: "DELETE",
  });
}
