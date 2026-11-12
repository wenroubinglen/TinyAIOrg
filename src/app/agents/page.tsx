"use client";

import {useState, useCallback, useEffect, Suspense} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { usePolling } from "@/lib/hooks";
import { getAgents, createPybAgent, savePybAgent, deletePybAgent, checkDaemonHealth, type AgentConfig } from "@/lib/api";
import { notifyRosterChanged, ROSTER_CHANGED_EVENT } from "@/lib/roster-events";
import { SSE_RECONNECTED_EVENT } from "@/lib/live-events";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Bot, Plus, Pencil, Trash2,
  X, Check, Loader2, Zap,
} from "lucide-react";
import { AgentAvatar } from "@/components/agent/agent-avatar";
import { cn } from "@/lib/utils";

// 双轨移除——所有 agent 均为一等 teammate（pyb 宿主托管），
// kind/provider/model/system_prompt 字段面废弃。
// id 由引擎自生成（agent_<uuid>），表单不再收集 ID。
type FormData = {
  id: string;
  name: string;
  description: string;
};

const emptyForm: FormData = { id: "", name: "", description: "" };

function AgentsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: agents, loading, refresh } = usePolling<Record<string, AgentConfig>>(getAgents, 0);

  // 成员抽屉意图（/agents/[id] 路由已删——跳画布开抽屉，
  // 与 sidebar openRosterDrawer 的 sessionStorage 意图机制同源同键）
  const openDrawerIntent = (agentId: string) => {
    try {
      window.sessionStorage.setItem("pyb-desktop_open_drawer", JSON.stringify({ kind: "agent", id: agentId }));
    } catch { /* 静默 */ }
    router.push("/company");
  };

  const [editing, setEditing] = useState<FormData | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [saving, setSaving] = useState(false);
  const [quickCreating, setQuickCreating] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [error, setError] = useState("");

  // 错误分级——daemon 三态 + 结构化错误映射为引导文案
  const describeCreateError = (msg: string): string => {
    if (msg.includes("name_conflict")) return "名称已被占用——请换一个名称重试";
    if (msg.includes("Failed to fetch") || msg.includes("fetch")) {
      return "无法连接 pyb daemon（127.0.0.1:3779）——请先启动：终端运行 pyb daemon start";
    }
    return msg;
  };

  const openNew = () => {
    setEditing({ ...emptyForm });
    setIsNew(true);
    setError("");
  };

  // 侧栏「添加 Teammate」入口：?new=1 直开新建表单
  useEffect(() => {
    if (searchParams.get("new") === "1") openNew();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  // roster 直听——teammate 经工具建/删 agent 时（SSE roster_changed）本页
  // 立即刷新；单次加载（usePolling 0）无轮询兜底，不接事件则永不更新。
  // SSE 重连同挂：snapshot 语义，断线期变更重连后全量补齐。
  useEffect(() => {
    const onRosterChanged = (e: Event) => {
      const kind = (e as CustomEvent<{ kind?: string }>).detail?.kind;
      if (kind === "agents" || kind === "all" || !kind) refresh();
    };
    const onReconnected = () => refresh();
    window.addEventListener(ROSTER_CHANGED_EVENT, onRosterChanged);
    window.addEventListener(SSE_RECONNECTED_EVENT, onReconnected);
    return () => {
      window.removeEventListener(ROSTER_CHANGED_EVENT, onRosterChanged);
      window.removeEventListener(SSE_RECONNECTED_EVENT, onReconnected);
    };
  }, [refresh]);

  const openEdit = (id: string, agent: AgentConfig) => {
    setEditing({ id, name: agent.name, description: "" });
    setIsNew(false);
    setError("");
  };

  const cancel = () => { setEditing(null); setError(""); };

  const handleSave = useCallback(async () => {
    if (!editing) return;
    const { id, name, description } = editing;
    if (!name.trim()) {
      setError("名称为必填项");
      return;
    }
    if (isNew && !description.trim()) {
      setError("描述必填——将成为队友的人设（persona）");
      return;
    }
    setSaving(true);
    setError("");
    try {
      // 创建前健康预检——dead 时直接给启动引导，不打无谓的 POST
      const health = await checkDaemonHealth();
      if (health === "dead") {
        setError("无法连接 pyb daemon（127.0.0.1:3779）——请先启动：终端运行 pyb daemon start");
        return;
      }
      if (isNew) {
        const created = await createPybAgent({ name: name.trim(), description: description.trim() });
        setEditing(null);
        notifyRosterChanged("agents");
        // 建完即聊（零断流）——跳画布开成员抽屉（路由页已删）
        openDrawerIntent(created.agent_id);
        return;
      } else {
        await savePybAgent(id, { name });
        notifyRosterChanged("agents");
      }
      setEditing(null);
      refresh();
    } catch (err) {
      setError(describeCreateError((err as Error).message));
    } finally {
      setSaving(false);
    }
  }, [editing, refresh, router]);

  // 零字段快建——一键创建（默认人设），建完直接进聊天
  const quickCreate = useCallback(async () => {
    if (quickCreating) return;
    setQuickCreating(true);
    setError("");
    try {
      const health = await checkDaemonHealth();
      if (health === "dead") {
        setError("无法连接 pyb daemon（127.0.0.1:3779）——请先启动：终端运行 pyb daemon start");
        return;
      }
      const n = agents ? Object.keys(agents).length + 1 : 1;
      const created = await createPybAgent({
        name: `新队友 ${n}`,
        description: "新创建的队友，人设待完善——可在画布抽屉身份卡编辑职责描述。",
      });
      refresh();
      notifyRosterChanged("agents");
      openDrawerIntent(created.agent_id);
    } catch (err) {
      setError(describeCreateError((err as Error).message));
    } finally {
      setQuickCreating(false);
    }
  }, [agents, quickCreating, refresh, router]);

  const handleDelete = useCallback(async (id: string) => {
    setDeleting(id);
    try {
      await deletePybAgent(id);
      refresh();
      notifyRosterChanged("agents");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setDeleting(null);
    }
  }, [refresh]);

  return (
    <div className="p-8 space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Bot className="h-5 w-5 text-primary" />
            Teammates
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            管理你的一等 AI 队友（pyb 引擎托管）
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={quickCreate} disabled={quickCreating || !!editing}>
            {quickCreating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
            快建 Teammate
          </Button>
          <Button onClick={openNew} disabled={!!editing}>
            <Plus className="h-4 w-4" />
            添加 Teammate
          </Button>
        </div>
      </div>

      {/* Editor Modal */}
      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <Card className="w-full max-w-lg border-border">
            <CardContent className="p-4 space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold flex items-center gap-2">
                  {isNew ? <Plus className="h-4 w-4 text-primary" /> : <Pencil className="h-4 w-4 text-primary" />}
                  {isNew ? "新建 Teammate" : `编辑 @${editing.id}`}
                </p>
                <Button variant="ghost" size="icon" onClick={cancel}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">显示名称</label>
                <Input
                  value={editing.name}
                  onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                  placeholder="如 Coder"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">
                  描述 {isNew ? "（必填——将成为队友的人设）" : "（抽屉身份卡编辑）"}
                </label>
                {isNew ? (
                  <Textarea
                    value={editing.description}
                    onChange={(e) => setEditing({ ...editing, description: e.target.value })}
                    placeholder="描述这个队友的职责——将成为它的 persona"
                    rows={3}
                    className="text-sm"
                  />
                ) : (
                  <p className="text-xs text-muted-foreground border rounded-md px-3 py-2 bg-muted/40">
                    人设（description）在画布抽屉的身份卡编辑——这里只改显示名称。
                  </p>
                )}
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <div className="flex items-center gap-2 pt-2">
                <Button onClick={handleSave} disabled={saving}>
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                  {isNew ? "创建 Teammate" : "保存修改"}
                </Button>
                <Button variant="ghost" onClick={cancel} disabled={saving}>
                  取消
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Teammate Grid */}
      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <div className="h-3 w-3 animate-spin border-2 border-primary border-t-transparent" />
          加载 Teammate 中...
        </div>
      ) : agents && Object.keys(agents).length > 0 ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Object.entries(agents).map(([id, agent]) => (
            <TeammateCard
              key={id}
              id={id}
              agent={agent}
              onEdit={() => openEdit(id, agent)}
              onDelete={() => handleDelete(id)}
              deleting={deleting === id}
            />
          ))}
        </div>
      ) : !editing ? (
        <Card>
          <CardContent className="p-12 text-center">
            <Bot className="h-10 w-10 text-muted-foreground mx-auto mb-4" />
            <p className="text-lg font-medium">暂无 Teammate</p>
            <p className="text-sm text-muted-foreground mt-1">
              创建第一个队友，快建一键开始或自定义人设
            </p>
            <div className="flex items-center justify-center gap-2 mt-4">
              <Button variant="outline" onClick={quickCreate} disabled={quickCreating}>
                {quickCreating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
                快建 Teammate
              </Button>
              <Button onClick={openNew}>
                <Plus className="h-4 w-4" />
                自定义创建
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function TeammateCard({
  id, agent, onEdit, onDelete, deleting,
}: {
  id: string;
  agent: AgentConfig;
  onEdit: () => void;
  onDelete: () => void;
  deleting: boolean;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const router = useRouter();

  const openDrawer = () => {
    try {
      window.sessionStorage.setItem("pyb-desktop_open_drawer", JSON.stringify({ kind: "agent", id }));
    } catch { /* 静默 */ }
    router.push("/company");
  };

  return (
    <div className="block cursor-pointer" onClick={openDrawer}>
      <Card className="transition-colors hover:border-primary/50 cursor-pointer">
      <CardHeader>
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <AgentAvatar
                agentId={agent.agent_id ?? id}
                name={agent.name}
                shape={agent.avatar_shape}
                colorHex={agent.avatar_color}
                size={40}
              />
              <div>
                <CardTitle className="text-base flex items-center gap-2">
                  {agent.name}
                </CardTitle>
                <CardDescription>@{id}</CardDescription>
              </div>
            </div>
            <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
              <Button variant="ghost" size="icon" onClick={(e) => { e.stopPropagation(); e.preventDefault(); onEdit(); }} className="h-8 w-8">
                <Pencil className="h-3.5 w-3.5" />
              </Button>
              {confirmDelete ? (
                <div className="flex items-center gap-1">
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={(e) => { e.stopPropagation(); e.preventDefault(); onDelete(); setConfirmDelete(false); }}
                    disabled={deleting}
                    className="h-8 text-xs"
                  >
                    {deleting ? <Loader2 className="h-3 w-3 animate-spin" /> : "Delete"}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); e.preventDefault(); setConfirmDelete(false); }} className="h-8 text-xs">
                    No
                  </Button>
                </div>
              ) : (
                <Button variant="ghost" size="icon" onClick={(e) => { e.stopPropagation(); e.preventDefault(); setConfirmDelete(true); }} className="h-8 w-8 text-muted-foreground hover:text-destructive">
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-2">
            <Badge variant="outline">一等 Teammate</Badge>
            <Badge variant="outline" className="text-muted-foreground font-mono text-[10px]">
              {agent.agent_id ? agent.agent_id.slice(0, 14) : "—"}
            </Badge>
          </div>
          <div className="pt-2 border-t">
            <p className="text-xs text-muted-foreground">
              点击在画布打开聊天抽屉（聊天 / 身份卡 / 任务）
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// 0.1.28 ceb5947 修法（robocopy 镜像回归重修）：useSearchParams 页面必须
// 包 Suspense 边界（Next 16 静态预渲染 CSR bailout）——默认导出拆内层+外层包装。
export default function AgentsPageWithSuspense() {
  return (
    <Suspense fallback={<div className="p-8 text-sm text-muted-foreground">加载中...</div>}>
      <AgentsPage />
    </Suspense>
  );
}
