/**
 * AI 组织 folder 实体数据层。
 *
 * 平铺行结构 localStorage 持久化——与未来引擎 folder 表
 * （一行一 folder + team.folder_id）逐字段对齐，引擎实体化时
 * 可直接导出迁移。schema 见 AiOrgState。
 */

export type AiOrgFolder = {
  id: string;
  name: string;
  /** null = 挂在 AI 组织根 */
  parentId: string | null;
};

export type AiOrgState = {
  version: 1;
  folders: AiOrgFolder[];
  /** teamId → folderId（缺项 = 未分配，留 AI 组织根） */
  teamFolder: Record<string, string>;
};

const STORAGE_KEY = "pyb-desktop_ai_org";
const SCHEMA_VERSION = 1;

export const EMPTY_AI_ORG: AiOrgState = { version: SCHEMA_VERSION, folders: [], teamFolder: {} };

function newId(): string {
  return `f_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/** 脏数据防御：坏 JSON/版本不符→空结构；孤儿 folder（parentId 不存在）上提根；
 *  循环引用链上的 folder 上提根（沿 parentId 走链，遇已访问节点即断）。 */
export function sanitizeFolders(raw: AiOrgFolder[]): AiOrgFolder[] {
  const byId = new Map<string, AiOrgFolder>();
  for (const f of raw) {
    if (f && typeof f.id === "string" && typeof f.name === "string") {
      byId.set(f.id, { id: f.id, name: f.name, parentId: typeof f.parentId === "string" ? f.parentId : null });
    }
  }
  for (const f of byId.values()) {
    const seen = new Set<string>([f.id]);
    let p = f.parentId;
    while (p !== null) {
      if (!byId.has(p) || seen.has(p)) {
        f.parentId = null; // 孤儿或环——上提根
        break;
      }
      seen.add(p);
      p = byId.get(p)!.parentId;
    }
  }
  return [...byId.values()];
}

export function loadAiOrg(): AiOrgState {
  if (typeof window === "undefined") return EMPTY_AI_ORG;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY_AI_ORG;
    const parsed = JSON.parse(raw) as Partial<AiOrgState>;
    if (parsed?.version !== SCHEMA_VERSION) return EMPTY_AI_ORG;
    const folders = Array.isArray(parsed.folders) ? parsed.folders : [];
    const teamFolder: Record<string, string> = {};
    if (parsed.teamFolder && typeof parsed.teamFolder === "object") {
      const folderIds = new Set(folders.map((f) => f.id));
      for (const [teamId, folderId] of Object.entries(parsed.teamFolder)) {
        if (typeof folderId === "string" && folderIds.has(folderId)) {
          teamFolder[teamId] = folderId;
        }
      }
    }
    return { version: SCHEMA_VERSION, folders: sanitizeFolders(folders), teamFolder };
  } catch {
    return EMPTY_AI_ORG;
  }
}

function save(state: AiOrgState): AiOrgState {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* 持久化失败静默——内存态仍生效 */
  }
  return state;
}

export function createFolder(state: AiOrgState, name: string, parentId: string | null): AiOrgState {
  const folder: AiOrgFolder = { id: newId(), name: name.trim(), parentId };
  return save({ ...state, folders: [...state.folders, folder] });
}

export function renameFolder(state: AiOrgState, id: string, name: string): AiOrgState {
  return save({
    ...state,
    folders: state.folders.map((f) => (f.id === id ? { ...f, name: name.trim() } : f)),
  });
}

/** 删除 folder：子 folder 上提到其父；team 归属一律释放回 AI 组织根（未分配区统一管理）。 */
export function deleteFolder(state: AiOrgState, id: string): AiOrgState {
  const target = state.folders.find((f) => f.id === id);
  if (!target) return state;
  const folders = state.folders
    .filter((f) => f.id !== id)
    .map((f) => (f.parentId === id ? { ...f, parentId: target.parentId } : f));
  const teamFolder: Record<string, string> = {};
  for (const [teamId, folderId] of Object.entries(state.teamFolder)) {
    if (folderId !== id) teamFolder[teamId] = folderId; // 被删层的 teams 移除映射 → 回根未分配
  }
  return save({ ...state, folders, teamFolder });
}

export function moveTeamToFolder(state: AiOrgState, teamId: string, folderId: string | null): AiOrgState {
  const teamFolder = { ...state.teamFolder };
  if (folderId === null) delete teamFolder[teamId];
  else teamFolder[teamId] = folderId;
  return save({ ...state, teamFolder });
}

// ── 树构建与路由解析辅助 ────────────────────────────────────────────────

export type FolderTreeNode = AiOrgFolder & { children: FolderTreeNode[] };

export function buildFolderTree(folders: AiOrgFolder[]): FolderTreeNode[] {
  const nodes = new Map<string, FolderTreeNode>();
  for (const f of sanitizeFolders(folders)) nodes.set(f.id, { ...f, children: [] });
  const roots: FolderTreeNode[] = [];
  for (const n of nodes.values()) {
    if (n.parentId && nodes.has(n.parentId)) nodes.get(n.parentId)!.children.push(n);
    else roots.push(n);
  }
  return roots;
}

/** folder 的根→叶路径（面包屑/父容器展开用）。 */
export function folderPathOf(folders: AiOrgFolder[], id: string): AiOrgFolder[] {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const path: AiOrgFolder[] = [];
  let cur = byId.get(id);
  const seen = new Set<string>();
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    path.unshift(cur);
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  return path;
}

/**
 * @deprecated folderHref 已改产出 org_id URL，slug 名字寻址退役——仅供旧 URL 兼容解析（resolveFolderBySlug 回退）使用，不再用于新 URL 生成。
 */
export function folderSlug(folders: AiOrgFolder[], id: string): string {
  const f = folders.find((x) => x.id === id);
  if (!f) return "";
  const dup = folders.some((x) => x.id !== id && x.name === f.name);
  return dup ? `${f.name}~${f.id}` : f.name;
}

/** 路由段解码：优先精确匹配 slug（含 ~id 段），否则按 name 匹配。 */
export function resolveFolderBySlug(
  folders: AiOrgFolder[],
  parentId: string | null,
  slug: string
): AiOrgFolder | null {
  const siblings = folders.filter((f) => f.parentId === parentId);
  const bySlug = new Map(siblings.map((f) => [folderSlug(folders, f.id), f]));
  if (bySlug.has(slug)) return bySlug.get(slug)!;
  return siblings.find((f) => f.name === slug) ?? null;
}

/** folder 子树内全部 folder id（含自身）——子画布过滤用。 */
export function subtreeFolderIds(folders: AiOrgFolder[], rootId: string | null): Set<string> {
  if (rootId === null) return new Set(folders.map((f) => f.id));
  const ids = new Set<string>([rootId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const f of folders) {
      if (f.parentId && ids.has(f.parentId) && !ids.has(f.id)) {
        ids.add(f.id);
        grew = true;
      }
    }
  }
  return ids;
}
