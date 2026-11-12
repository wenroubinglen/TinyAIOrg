/**
 * AI 组织数据层——引擎真相源客户端。
 *
 * 组织结构从 localStorage 迁移至引擎实体（entities/<orgId>/config.json +
 * GroupConfig.folderId）。本模块提供：
 * 1. daemon /api/pyb-orgs CRUD 客户端（引擎为唯一真相源）
 * 2. localStorage 一次性迁移（pyb-desktop_ai_org → 引擎；folder id
 *    f_<ts36><rand> 原样沿用为引擎 orgId——createGroupConfig
 *    caller-supplied-id 先例）
 * 3. 与 ai-org-folders.ts 同构的 AiOrgState 视图（消费面零改动）——
 *    teamFolder 从 GroupConfig.folderId 派生
 *
 * 引擎不可达时的降级：返回 localStorage 快照只读视图（组织结构编辑
 * 不可用但画布可渲染），不写回 localStorage——引擎恢复后真相源一致。
 */

import {
  EMPTY_AI_ORG,
  sanitizeFolders,
  type AiOrgState,
} from "./ai-org-folders";
import { getApiBase } from "./api";

const LEGACY_STORAGE_KEY = "pyb-desktop_ai_org";
const MIGRATED_FLAG_KEY = "pyb-desktop_ai_org_migrated";

/** api.ts 的 apiFetch 是私有函数——本地同构实现（getApiBase + JSON）。 */
async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${getApiBase()}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...options?.headers },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || res.statusText);
  }
  return res.json();
}

type EngineOrg = {
  org_id: string;
  name: string;
  parent_id: string | null;
  manager_agent_id?: string | null;
};

// ── 一等 OrgConfig 类型与命名封装 ──
// 审计定界：单端点直取与全套写操作已实现（本文件既有
// engine* 函数族），此处只做类型一等化+命名封装导出，既有函数零改动。

/** 组织一等配置（与引擎 orgConfig.OrgConfig 同构，含 updated_at）。 */
export type OrgConfig = {
  org_id: string;
  name: string;
  parent_id: string | null;
  manager_agent_id: string | null;
  updated_at?: number;
};

/** 单端点直取组织全量（Record 形态，orgId 键）。 */
export async function getOrgs(): Promise<Record<string, OrgConfig>> {
  const res = await apiFetch<{ orgs?: OrgConfig[] }>("/api/pyb-orgs");
  const out: Record<string, OrgConfig> = {};
  for (const o of res.orgs ?? []) {
    if (o?.org_id) out[o.org_id] = o;
  }
  return out;
}

/** 更新组织（透传 name/parent_id——管理者与组织一体，不可更换）。 */
export async function savePybOrg(
  id: string,
  payload: { name?: string; parent_id?: string | null },
): Promise<void> {
  await apiFetch(`/api/pyb-orgs/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

type EngineTeam = {
  team_id?: string;
  folder_id?: string;
};

/** 引擎 org 列表 → AiOrgState（managerId 附加携带，C 柱消费）。 */
function projectOrgs(
  orgs: EngineOrg[],
  teams: EngineTeam[],
): AiOrgState & {
  managers: Record<string, string>;
} {
  const folders = sanitizeFolders(
    orgs.map((o) => ({
      id: o.org_id,
      name: o.name,
      parentId: o.parent_id,
    })),
  );
  const teamFolder: Record<string, string> = {};
  for (const t of teams) {
    if (t.team_id && t.folder_id) teamFolder[t.team_id] = t.folder_id;
  }
  const managers: Record<string, string> = {};
  for (const o of orgs) {
    if (o.manager_agent_id) managers[o.org_id] = o.manager_agent_id;
  }
  return { version: 1, folders, teamFolder, managers };
}

/** 读取引擎真相源（orgs + teams 的 folder_id 投影 + agents 的 org_id 挂靠）。
 * orgs 拉取经 getOrgs() 封装（不再内联 apiFetch）。 */
export async function loadAiOrgFromEngine(): Promise<
  AiOrgState & {
    managers: Record<string, string>;
    /** org-ui 任务2：agent→org 独立挂靠（agentId → orgId）。 */
    agentOrg: Record<string, string>;
  }
> {
  const [orgsMap, teamsRes, agentsRes] = await Promise.all([
    getOrgs(),
    apiFetch<{ teams?: EngineTeam[] }>("/api/pyb-teams"),
    apiFetch<{ agents?: Array<{ agent_id?: string; org_id?: string | null }> }>(
      "/api/pyb-agents",
    ),
  ]);
  const orgs = Object.values(orgsMap);
  const agentOrg: Record<string, string> = {};
  for (const a of agentsRes.agents ?? []) {
    if (a?.agent_id && a.org_id) agentOrg[a.agent_id] = a.org_id;
  }
  return {
    ...projectOrgs(orgs, teamsRes.teams ?? []),
    agentOrg,
  };
}

/** org-ui 任务2：独立成员↔org 挂载/摘除（agent state.orgId 经引擎 RPC）。 */
export async function engineAssignAgentToOrg(
  agentId: string,
  folderId: string | null,
): Promise<void> {
  await apiFetch("/api/pyb-orgs/assign-agent", {
    method: "POST",
    body: JSON.stringify({
      agent_id: agentId,
      folder_id: folderId ?? "",
    }),
  });
}

/**
 * 一次性迁移：localStorage → 引擎。幂等（MIGRATED_FLAG_KEY 标记）。
 * folder id f_* 原样沿用为引擎 orgId（防画布路由断链）。
 * 迁移语义：org.create（auto 建管理者）→ org.assign-team（挂载群）。
 */
export async function migrateLegacyAiOrgIfNeeded(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  if (window.localStorage.getItem(MIGRATED_FLAG_KEY)) return false;
  let legacy: AiOrgState | null = null;
  try {
    const raw = window.localStorage.getItem(LEGACY_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<AiOrgState>;
      if (parsed?.version === 1 && Array.isArray(parsed.folders)) {
        legacy = {
          version: 1,
          folders: parsed.folders,
          teamFolder:
            parsed.teamFolder && typeof parsed.teamFolder === "object"
              ? parsed.teamFolder
              : {},
        };
      }
    }
  } catch {
    legacy = null;
  }
  // 无论有无 legacy 数据都打标（空结构也无需再迁）
  window.localStorage.setItem(MIGRATED_FLAG_KEY, String(Date.now()));
  if (!legacy || legacy.folders.length === 0) return false;

  // 建组织（父先子后——parentId 需已存在）
  const byDepth = [...legacy.folders].sort(
    (a, b) => (a.parentId === null ? 0 : 1) - (b.parentId === null ? 0 : 1),
  );
  for (const f of byDepth) {
    await apiFetch("/api/pyb-orgs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        org_id: f.id,
        name: f.name,
        ...(f.parentId ? { parent_id: f.parentId } : {}),
      }),
    });
  }
  // 挂载群
  for (const [teamId, folderId] of Object.entries(legacy.teamFolder)) {
    try {
      await apiFetch("/api/pyb-orgs/assign-team", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ team_id: teamId, folder_id: folderId }),
      });
    } catch {
      // 单群挂载失败不阻断整体迁移（该群留根未分配）
    }
  }
  return true;
}

// ── CRUD（引擎源；签名与 ai-org-folders 同构，消费面 await 化） ──

export async function engineCreateFolder(
  name: string,
  parentId: string | null,
): Promise<{ org_id: string | null; manager_agent_id: string | null }> {
  // 透传引擎 201 返回体（org_id+manager_agent_id）——
  // 创建方据此免事件竞态直写 orgManagers，即时渲染管理者皇冠形态
  const res = (await apiFetch("/api/pyb-orgs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name,
      ...(parentId ? { parent_id: parentId } : {}),
    }),
  })) as { org_id?: string | null; manager_agent_id?: string | null };
  return {
    org_id: res.org_id ?? null,
    manager_agent_id: res.manager_agent_id ?? null,
  };
}

export async function engineRenameFolder(
  id: string,
  name: string,
): Promise<void> {
  // PUT 经 savePybOrg 封装（不再内联 apiFetch）
  await savePybOrg(id, { name });
}

export async function engineDeleteFolder(id: string): Promise<void> {
  await apiFetch(`/api/pyb-orgs/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

export async function engineMoveTeamToFolder(
  teamId: string,
  folderId: string | null,
): Promise<void> {
  await apiFetch("/api/pyb-orgs/assign-team", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      team_id: teamId,
      folder_id: folderId ?? "",
    }),
  });
}

/** localStorage 只读降级快照（引擎不可达时画布仍可渲染）。 */
export function legacyAiOrgSnapshot(): AiOrgState {
  if (typeof window === "undefined") return EMPTY_AI_ORG;
  try {
    const raw = window.localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!raw) return EMPTY_AI_ORG;
    const parsed = JSON.parse(raw) as Partial<AiOrgState>;
    if (parsed?.version !== 1) return EMPTY_AI_ORG;
    const folders = Array.isArray(parsed.folders) ? parsed.folders : [];
    return {
      version: 1,
      folders: sanitizeFolders(folders),
      teamFolder:
        parsed.teamFolder && typeof parsed.teamFolder === "object"
          ? parsed.teamFolder
          : {},
    };
  } catch {
    return EMPTY_AI_ORG;
  }
}
