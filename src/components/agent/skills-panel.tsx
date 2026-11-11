"use client";

/**
 * 身份卡技能面板。
 * 卡面（查看态）：技能徽条——三 bucket 计数 + 私有技能名列表（体现成员
 * 独特能力属性）；卡背（编辑态）：完整管理器——三 bucket 分组列表、
 * shared 开关（overlay B 路）、private 删除（A 路，rm 目录即下次唤醒
 * 生效）、bundled 恒开只读（共享基座）。
 * 数据面：引擎三视图 API（GET/PUT/DELETE /api/pyb/agent-skills*）。
 */

import { useCallback, useEffect, useState } from "react";
import {
  listAgentSkills,
  toggleAgentSkill,
  removeAgentSkill,
  updateAgentSkill,
  publishAgentSkillAction,
  createAgentSkill,
  importAgentSkill,
  listScheduledTasks,
  deleteScheduledTask,
  isSkillTriggerFor,
  type AgentSkillEntry,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  CloudUpload,
  Download,
  Lock,
  Pencil,
  Plus,
  RefreshCw,
  RotateCw,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";

const BUCKET_LABEL: Record<AgentSkillEntry["bucket"], string> = {
  bundled: "内置",
  shared: "共享",
  private: "专属",
};

/** 来源标签：副标题合成来源前缀 */
const BUCKET_SOURCE_LABEL: Record<AgentSkillEntry["bucket"], string> = {
  bundled: "内置基座",
  shared: "团队共享",
  private: "本地专属",
};

// 技能区彻底移除 cron 触发器入口——cron 唯一入口
// 收敛到定时任务面板（新建表单的「技能」维度多选 + @注入指令）。技能删除
// 级联清理孤儿 cron 的逻辑保留在 useAgentSkills.removeWithTriggers。

export function useAgentSkills(agentId: string) {
  const [skills, setSkills] = useState<AgentSkillEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(
    async (agentIdOverride?: string) => {
      setError(null);
      try {
        const res = await listAgentSkills(agentIdOverride ?? agentId);
        setSkills(res.skills ?? []);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [agentId],
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await listAgentSkills(agentId);
        if (!cancelled) setSkills(res.skills ?? []);
      } catch {
        /* 首拉失败保持 null——管理器显示加载态，refresh 按钮重试 */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [agentId]);

  const toggle = useCallback(
    async (skillName: string, enabled: boolean) => {
      setBusy(skillName);
      setError(null);
      try {
        await toggleAgentSkill(agentId, skillName, enabled);
        await refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(null);
      }
    },
    [agentId, refresh],
  );

  const update = useCallback(
    async (
      skillName: string,
      spec: { name: string; description: string; content: string },
    ) => {
      setBusy(skillName);
      setError(null);
      try {
        await updateAgentSkill(agentId, skillName, spec);
        await refresh();
        return true;
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        return false;
      } finally {
        setBusy(null);
      }
    },
    [agentId, refresh],
  );

  const removeWithTriggers = useCallback(
    async (skillName: string) => {
      setBusy(skillName);
      setError(null);
      try {
        // 级联清理触发器（防孤儿 cron 持续以死者名义唤醒）
        // best-effort：清理失败不阻断删除（任务面残留可手工清）
        try {
          const tasks = await listScheduledTasks();
          for (const t of tasks) {
            if (
              typeof t.prompt === "string" &&
              isSkillTriggerFor(t.prompt, skillName)
            ) {
              await deleteScheduledTask(t.taskId);
            }
          }
        } catch {
          /* 触发器清理失败不阻断技能删除 */
        }
        await removeAgentSkill(agentId, skillName);
        await refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(null);
      }
    },
    [agentId, refresh],
  );

  const publishAction = useCallback(
    async (
      skillName: string,
      action: "publish" | "resync" | "unpublish",
    ): Promise<boolean> => {
      setBusy(skillName);
      setError(null);
      try {
        await publishAgentSkillAction(agentId, skillName, action);
        await refresh();
        return true;
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        return false;
      } finally {
        setBusy(null);
      }
    },
    [agentId, refresh],
  );

  // 三入口创建链（表单新建 / 粘贴 markdown / URL 活引用）
  const create = useCallback(
    async (spec: { name: string; description: string; content: string }) => {
      setBusy("__create__");
      setError(null);
      try {
        await createAgentSkill(agentId, spec);
        await refresh();
        return true;
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        return false;
      } finally {
        setBusy(null);
      }
    },
    [agentId, refresh],
  );

  const importSkill = useCallback(
    async (
      input:
        { kind: "markdown"; markdown: string } | { kind: "url"; url: string },
    ) => {
      setBusy("__import__");
      setError(null);
      try {
        await importAgentSkill(agentId, input);
        await refresh();
        return true;
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        return false;
      } finally {
        setBusy(null);
      }
    },
    [agentId, refresh],
  );

  return {
    skills,
    error,
    busy,
    refresh,
    toggle,
    remove: removeWithTriggers,
    update,
    publishAction,
    create,
    importSkill,
  };
}

/** 卡面技能徽条：计数 + 专属技能名（紧凑展示，体现差异化身份） */
export function SkillsBadgeStrip({
  skills,
}: {
  skills: AgentSkillEntry[] | null;
}) {
  if (skills === null) {
    return <div className="text-[10px] text-muted-foreground">技能加载中…</div>;
  }
  const byBucket = (b: AgentSkillEntry["bucket"]) =>
    skills.filter((s) => s.bucket === b);
  const privateSkills = byBucket("private");
  // bundled 官方出厂件不展示不统计——计数只含 private/shared
  const visible = skills.filter((s) => s.bucket !== "bundled");
  const enabledCount = visible.filter((s) => s.enabled).length;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-1">
        <Sparkles className="h-3 w-3 text-muted-foreground" />
        <span className="text-[10px] text-muted-foreground">
          技能 {enabledCount}/{visible.length}
        </span>
        {(["private", "shared"] as AgentSkillEntry["bucket"][]).map((b) => {
          const n = byBucket(b).length;
          if (n === 0) return null;
          return (
            <span
              key={b}
              className="rounded-sm bg-muted px-1 py-0.5 text-[10px] text-muted-foreground"
            >
              {BUCKET_LABEL[b]} {n}
            </span>
          );
        })}
      </div>
      {privateSkills.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {privateSkills.map((s) => (
            <span
              key={s.name}
              className="rounded-sm border border-primary/40 bg-primary/10 px-1 py-0.5 text-[10px] text-primary truncate max-w-full"
            >
              {s.displayName ?? s.name}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/** 卡背编辑抽屉：显示名/描述/内容三字段，头部只读 /id 调用串 */
function SkillEditDrawer({
  skill,
  busy,
  onSave,
  onClose,
}: {
  skill: AgentSkillEntry;
  busy: boolean;
  onSave: (spec: {
    name: string;
    description: string;
    content: string;
  }) => Promise<boolean>;
  onClose: () => void;
}) {
  const [name, setName] = useState(skill.displayName ?? skill.name);
  const [description, setDescription] = useState(skill.description);
  const [content, setContent] = useState("");

  return (
    <div className="flex flex-col gap-1.5 rounded-md border border-primary/30 bg-muted/20 p-2">
      <div className="flex items-center justify-between">
        <div className="text-[10px] text-muted-foreground">
          调用串 <code className="text-primary">/{skill.name}</code>（不可变）
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-5 w-5 p-0"
          onClick={onClose}
        >
          <X className="h-3 w-3" />
        </Button>
      </div>
      <input
        className="rounded border bg-background px-1.5 py-1 text-[11px]"
        placeholder="显示名（必填）"
        value={name}
        maxLength={64}
        onChange={(e) => setName(e.target.value)}
      />
      <input
        className="rounded border bg-background px-1.5 py-1 text-[11px]"
        placeholder="描述（必填）"
        value={description}
        maxLength={200}
        onChange={(e) => setDescription(e.target.value)}
      />
      <textarea
        className="min-h-24 rounded border bg-background px-1.5 py-1 font-mono text-[10px]"
        placeholder="留空=不修改内容。粘贴新 SKILL.md 正文（frontmatter 之外部分）覆盖"
        value={content}
        onChange={(e) => setContent(e.target.value)}
      />
      <div className="flex items-center justify-between">
        <span className="text-[9px] text-muted-foreground">
          保存后下次唤醒生效；留空内容不改
        </span>
        <Button
          size="sm"
          className="h-6 px-3 text-[10px]"
          disabled={busy || !name.trim() || !description.trim()}
          onClick={async () => {
            const ok = await onSave({
              name: name.trim(),
              description: description.trim(),
              content,
            });
            if (ok) onClose();
          }}
        >
          保存
        </Button>
      </div>
    </div>
  );
}

/** 新建/导入抽屉：新建=三字段表单；导入=粘贴 markdown / URL 双 tab */
function SkillCreateDrawer({
  mode,
  busy,
  onCreate,
  onImport,
  onClose,
}: {
  mode: "create" | "import";
  busy: boolean;
  onCreate: (spec: {
    name: string;
    description: string;
    content: string;
    slug?: string;
  }) => Promise<boolean>;
  onImport: (
    input:
      | { kind: "markdown"; markdown: string; slug?: string }
      | { kind: "url"; url: string; slug?: string },
  ) => Promise<boolean>;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [content, setContent] = useState("");
  const [importTab, setImportTab] = useState<"markdown" | "url">("markdown");
  const [markdown, setMarkdown] = useState("");
  const [url, setUrl] = useState("");
  const [importSlug, setImportSlug] = useState("");

  return (
    <div className="flex flex-col gap-1.5 rounded-md border border-primary/30 bg-muted/20 p-2">
      <div className="flex items-center justify-between">
        <div className="text-[10px] font-medium text-primary">
          {mode === "create" ? "新建专属技能" : "导入专属技能"}
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-5 w-5 p-0"
          onClick={onClose}
        >
          <X className="h-3 w-3" />
        </Button>
      </div>
      {mode === "create" ? (
        <>
          <input
            className="rounded border bg-background px-1.5 py-1 text-[11px]"
            placeholder="显示名（必填，中文任意，如：周报助手）"
            value={name}
            maxLength={64}
            onChange={(e) => setName(e.target.value)}
          />
          <input
            className="rounded border bg-background px-1.5 py-1 font-mono text-[10px]"
            placeholder="英文调用键（中文名必填，如：weekly-report，生成 /weekly-report）"
            value={slug}
            maxLength={64}
            onChange={(e) => setSlug(e.target.value)}
          />
          <input
            className="rounded border bg-background px-1.5 py-1 text-[11px]"
            placeholder="描述（必填，说明何时用这个技能）"
            value={description}
            maxLength={200}
            onChange={(e) => setDescription(e.target.value)}
          />
          <textarea
            className="min-h-24 rounded border bg-background px-1.5 py-1 font-mono text-[10px]"
            placeholder="SKILL.md 正文（指令/流程，frontmatter 之外部分）"
            value={content}
            onChange={(e) => setContent(e.target.value)}
          />
          <div className="flex items-center justify-between">
            <span className="text-[9px] text-muted-foreground">
              生成 /技能id 调用串；下次唤醒生效
            </span>
            <Button
              size="sm"
              className="h-6 px-3 text-[10px]"
              disabled={busy || !name.trim() || !description.trim()}
              onClick={async () => {
                const ok = await onCreate({
                  name: name.trim(),
                  description: description.trim(),
                  content,
                  ...(slug.trim() ? { slug: slug.trim() } : {}),
                });
                if (ok) onClose();
              }}
            >
              创建
            </Button>
          </div>
        </>
      ) : (
        <>
          <div className="flex items-center gap-1">
            <Button
              variant={importTab === "markdown" ? "default" : "ghost"}
              size="sm"
              className="h-5 px-2 text-[9px]"
              onClick={() => setImportTab("markdown")}
            >
              粘贴 Markdown
            </Button>
            <Button
              variant={importTab === "url" ? "default" : "ghost"}
              size="sm"
              className="h-5 px-2 text-[9px]"
              onClick={() => setImportTab("url")}
            >
              URL 活引用
            </Button>
          </div>
          {importTab === "markdown" ? (
            <textarea
              className="min-h-24 rounded border bg-background px-1.5 py-1 font-mono text-[10px]"
              placeholder="粘贴 SKILL.md 全文（含 frontmatter 更佳；无 frontmatter 自动从首行标题取名）"
              value={markdown}
              onChange={(e) => setMarkdown(e.target.value)}
            />
          ) : (
            <>
              <input
                className="rounded border bg-background px-1.5 py-1 font-mono text-[10px]"
                placeholder="https://…（指向 SKILL.md 或技能源）"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
              <div className="text-[9px] text-muted-foreground">
                活引用登记：不抓取内容，技能正文为指针——成员被唤醒使用时自行读取
                URL 并可将其物化为完整技能
              </div>
            </>
          )}
          <input
            className="rounded border bg-background px-1.5 py-1 font-mono text-[10px]"
            placeholder="英文调用键（可选；源名为中文时必填，如：weekly-report）"
            value={importSlug}
            maxLength={64}
            onChange={(e) => setImportSlug(e.target.value)}
          />
          <div className="flex items-center justify-end">
            <Button
              size="sm"
              className="h-6 px-3 text-[10px]"
              disabled={
                busy ||
                (importTab === "markdown" ? !markdown.trim() : !url.trim())
              }
              onClick={async () => {
                const slugArg = importSlug.trim();
                const ok =
                  importTab === "markdown"
                    ? await onImport({
                        kind: "markdown",
                        markdown,
                        ...(slugArg ? { slug: slugArg } : {}),
                      })
                    : await onImport({
                        kind: "url",
                        url,
                        ...(slugArg ? { slug: slugArg } : {}),
                      });
                if (ok) onClose();
              }}
            >
              导入
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

/** 卡背技能管理器：三 bucket 分组 + 开关/删除/编辑 */
export function SkillsManager({ agentId }: { agentId: string }) {
  const {
    skills,
    error,
    busy,
    refresh,
    toggle,
    remove,
    update,
    publishAction,
    create,
    importSkill,
  } = useAgentSkills(agentId);
  const [editing, setEditing] = useState<string | null>(null);
  const [creating, setCreating] = useState<"create" | "import" | null>(null);

  if (skills === null) {
    return (
      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
        <RefreshCw className="h-3 w-3 animate-spin" /> 加载技能…
      </div>
    );
  }

  // bundled 官方出厂件不展示——分组只含 private/shared
  const groups: AgentSkillEntry["bucket"][] = ["private", "shared"];

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <div className="text-[11px] text-muted-foreground">技能管理</div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-[10px]"
            title="新建专属技能（三字段表单）"
            onClick={() => setCreating(creating === "create" ? null : "create")}
          >
            <Plus className="h-3 w-3" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-[10px]"
            title="导入专属技能（粘贴 Markdown / URL 活引用）"
            onClick={() => setCreating(creating === "import" ? null : "import")}
          >
            <Download className="h-3 w-3" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-[10px]"
            onClick={() => void refresh()}
          >
            <RefreshCw className="h-3 w-3" />
          </Button>
        </div>
      </div>
      {creating && (
        <SkillCreateDrawer
          mode={creating}
          busy={busy === "__create__" || busy === "__import__"}
          onCreate={create}
          onImport={importSkill}
          onClose={() => setCreating(null)}
        />
      )}
      {error && <div className="text-[10px] text-destructive">{error}</div>}
      {groups.map((bucket) => {
        const items = skills.filter((s) => s.bucket === bucket);
        if (items.length === 0) return null;
        return (
          <div key={bucket} className="flex flex-col gap-1">
            <div className="text-[10px] font-medium text-muted-foreground">
              {bucket === "shared" ? "共享（技能市场）" : BUCKET_LABEL[bucket]}
              {bucket === "shared" && "（可开关）"}
              {bucket === "private" && "（专属，可编辑/删除）"}
            </div>
            {items.map((s) => (
              <div key={s.name} className="flex flex-col gap-1">
                <div className="flex items-center gap-2 rounded-md border bg-muted/30 px-2 py-1">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[11px] font-medium">
                      {s.displayName ?? s.name}
                    </div>
                    {s.description && (
                      <div className="truncate text-[10px] text-muted-foreground">
                        <span className="mr-1 rounded-sm bg-muted px-1 py-px text-[9px] text-muted-foreground/80">
                          {BUCKET_SOURCE_LABEL[s.bucket]}
                        </span>
                        {s.description}
                      </div>
                    )}
                  </div>
                  {s.canRemove ? (
                    <>
                      {s.published && (
                        <span
                          className="shrink-0 rounded-sm border border-emerald-500/40 bg-emerald-500/10 px-1 py-0.5 text-[9px] text-emerald-500"
                          title="已发布到共享池，其他成员可见"
                        >
                          已发布
                        </span>
                      )}
                      {s.published ? (
                        <>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 w-6 p-0"
                            title="同步更新共享池副本（编辑后推送）"
                            disabled={busy === s.name}
                            onClick={() => void publishAction(s.name, "resync")}
                          >
                            <RotateCw className="h-3 w-3" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 w-6 p-0"
                            title="取消发布（删共享池副本，专属技能保留）"
                            disabled={busy === s.name}
                            onClick={() =>
                              void publishAction(s.name, "unpublish")
                            }
                          >
                            <CloudUpload className="h-3 w-3 text-emerald-500" />
                          </Button>
                        </>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 w-6 p-0"
                          title="发布到共享池（其他成员可用，专属副本保留）"
                          disabled={busy === s.name}
                          onClick={() => void publishAction(s.name, "publish")}
                        >
                          <CloudUpload className="h-3 w-3" />
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0"
                        title="编辑专属技能（下次唤醒生效）"
                        disabled={busy === s.name}
                        onClick={() =>
                          setEditing(editing === s.name ? null : s.name)
                        }
                      >
                        <Pencil className="h-3 w-3" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0"
                        title="删除专属技能（下次唤醒生效）"
                        disabled={busy === s.name}
                        onClick={() => void remove(s.name)}
                      >
                        <Trash2 className="h-3 w-3 text-destructive" />
                      </Button>
                    </>
                  ) : s.canDisable ? (
                    <button
                      type="button"
                      role="switch"
                      aria-checked={s.enabled}
                      disabled={busy === s.name}
                      onClick={() => void toggle(s.name, !s.enabled)}
                      className={cn(
                        "relative h-4 w-7 shrink-0 rounded-full transition-colors",
                        s.enabled ? "bg-primary" : "bg-muted-foreground/30",
                      )}
                    >
                      <span
                        className={cn(
                          "absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all",
                          s.enabled ? "left-3.5" : "left-0.5",
                        )}
                      />
                    </button>
                  ) : (
                    <Lock className="h-3 w-3 shrink-0 text-muted-foreground/50" />
                  )}
                </div>
                {s.canRemove && editing === s.name && (
                  <SkillEditDrawer
                    skill={s}
                    busy={busy === s.name}
                    onSave={(spec) => update(s.name, spec)}
                    onClose={() => setEditing(null)}
                  />
                )}
              </div>
            ))}
          </div>
        );
      })}
      {skills.filter((s) => s.bucket !== "bundled").length === 0 && (
        <div className="text-[10px] text-muted-foreground">
          暂无专属/共享技能。点击 + 新建，或 ↓ 从 Markdown/URL 导入。
        </div>
      )}
    </div>
  );
}
