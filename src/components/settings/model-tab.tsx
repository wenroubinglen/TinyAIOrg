"use client";

/**
 * 模型配置面板（含验收反馈修订）。
 *
 * 信息架构（用户裁决）：
 * - 已配置模型平铺统一管理（不按 provider 分组）——切换/编辑/测试/删除
 *   一屏直达；当前使用置顶；providerLabel 小字补上下文。
 * - 新增模型两步式：点「新增模型」→ 弹窗先列 provider 名（模板注册表
 *   投影，双分支合并；Coding Plan 标「订阅」小字；末尾「自定义」）→
 *   点 provider 弹窗内选模型填 key 保存；自定义弹窗含 ⑤ 告知文案。
 * - 编辑弹窗：能力稀疏 overlay（显式开/关+还原继承）+reasoningEffort 档位。
 * - 三病灶修复：apiKey state 独立/测试免手粘 key（profileId 凭据复用）/
 *   删除确认对话框。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getModelConfigOverview,
  getModelPresets,
  setModelSelection,
  updateProfileIdentity,
  updateProfileFields,
  createModelProfile,
  deleteModelProfile,
  getModelConfigRevision,
  probeDialect,
  type ModelConfigOverview,
  type ModelPresetEntry,
  type ModelProtocol,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  EyeIcon,
  EyeOffIcon,
  Loader2,
  Pencil,
  Plus,
  Trash2,
  Unplug,
} from "lucide-react";

type ProfileRow = NonNullable<
  ModelConfigOverview["groups"][number]["profiles"][number]
>;

/** ⑤ badge 双态（与聊天侧选择器同语义） */
function VisionBadge({ p }: { p: ProfileRow }) {
  if (p.supportsVision !== true) return null;
  const verified = p.mediaDeliveryOverride === "glm-chat-verified";
  return (
    <Badge
      variant={verified ? "default" : "secondary"}
      className="gap-0.5 px-1.5"
      title={
        verified
          ? "视觉已验证（模板 override）"
          : "视觉声明但投递关闭（自定义端点 fail-closed——图片将收占位文本）"
      }
    >
      {verified ? <EyeIcon className="size-3" /> : <EyeOffIcon className="size-3" />}
      {verified ? "视觉" : "视觉*"}
    </Badge>
  );
}

function formatContextWindow(n?: number): string {
  if (!n) return "";
  if (n >= 1_000_000) return `${Math.round(n / 1_000_000)}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}K`;
  return String(n);
}

/** 能力编辑弹窗（稀疏 overlay + reasoningEffort 档位 + 数值字段） */
function EditProfileDialog({
  profile,
  onClose,
  onSaved,
}: {
  profile: ProfileRow;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(profile.name);
  const [modelName, setModelName] = useState(profile.modelName);
  const [maxTokens, setMaxTokens] = useState(
    profile.maxTokens != null ? String(profile.maxTokens) : "",
  );
  const [contextLength, setContextLength] = useState(
    profile.contextLength != null ? String(profile.contextLength) : "",
  );
  const [reasoningEffort, setReasoningEffort] = useState<string | null>(
    profile.reasoningEffort ?? null,
  );
  const [visionOverride, setVisionOverride] = useState<boolean | undefined>(
    profile.supportsVision === undefined
      ? undefined
      : profile.supportsVision,
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // key 替换：服务端从不回传已存 key（列表仅 apiKeyConfigured 布尔）——
  // 留空=保持不变（与后端「空值不动」语义对齐），输入即覆盖保存。
  const [newApiKey, setNewApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      if (name !== profile.name || modelName !== profile.modelName) {
        await updateProfileIdentity(
          profile.profileId,
          {
            ...(name !== profile.name ? { name } : {}),
            ...(modelName !== profile.modelName ? { modelName } : {}),
          },
          0,
        ).catch(async (e: Error & { code?: string }) => {
          if (!e.code?.includes("REVISION")) throw e;
        });
      }
      await updateProfileFields(profile.profileId, {
        ...(newApiKey.trim() ? { apiKey: newApiKey.trim() } : {}),
        ...(maxTokens && Number(maxTokens) > 0
          ? { maxTokens: Number(maxTokens) }
          : {}),
        ...(contextLength && Number(contextLength) > 0
          ? { contextLength: Number(contextLength) }
          : {}),
        ...(reasoningEffort !== (profile.reasoningEffort ?? null)
          ? { reasoningEffort }
          : {}),
        ...(visionOverride !== undefined &&
        visionOverride !== profile.supportsVision
          ? {
              quirksOverlay: {
                leaves: { supportsVision: visionOverride },
              },
            }
          : {}),
      });
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>编辑模型</DialogTitle>
          <DialogDescription>
            修改后保存即可；未修改的字段保持不变。
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1">
              <Label className="text-xs">显示名</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="grid gap-1">
              <Label className="text-xs">模型名</Label>
              <Input
                value={modelName}
                onChange={(e) => setModelName(e.target.value)}
              />
            </div>
            <div className="grid gap-1">
              <Label className="text-xs">最大输出 token</Label>
              <Input
                inputMode="numeric"
                value={maxTokens}
                onChange={(e) =>
                  setMaxTokens(e.target.value.replace(/[^0-9]/g, ""))
                }
                placeholder="如 8192"
              />
            </div>
            <div className="grid gap-1">
              <Label className="text-xs">上下文长度</Label>
              <Input
                inputMode="numeric"
                value={contextLength}
                onChange={(e) =>
                  setContextLength(e.target.value.replace(/[^0-9]/g, ""))
                }
                placeholder="如 128000"
              />
            </div>
          </div>
          <div className="grid gap-1">
            <Label className="text-xs">
              API Key
              {profile.apiKeyConfigured && (
                <span className="ml-1.5 font-normal text-muted-foreground">
                  （已配置——留空保持不变，输入新值即替换）
                </span>
              )}
            </Label>
            <div className="relative">
              <Input
                type={showKey ? "text" : "password"}
                value={newApiKey}
                onChange={(e) => setNewApiKey(e.target.value)}
                autoComplete="off"
                placeholder={profile.apiKeyConfigured ? "留空保持当前 key" : "sk-…"}
              />
              {newApiKey && (
                <button
                  type="button"
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground"
                  onClick={() => setShowKey((v) => !v)}
                  aria-label={showKey ? "隐藏 key" : "显示 key"}
                >
                  {showKey ? (
                    <EyeOffIcon className="size-4" />
                  ) : (
                    <EyeIcon className="size-4" />
                  )}
                </button>
              )}
            </div>
          </div>
          <div className="grid gap-1">
            <Label className="text-xs">Reasoning Effort</Label>
            <div className="flex gap-1">
              {([null, "low", "medium", "high"] as const).map((v) => (
                <Button
                  key={v ?? "unset"}
                  size="sm"
                  variant={reasoningEffort === v ? "default" : "outline"}
                  onClick={() => setReasoningEffort(v)}
                  className="h-7 px-2 text-xs"
                >
                  {v ?? "未设置"}
                </Button>
              ))}
            </div>
          </div>
          <div className="flex items-center justify-between rounded-md border px-3 py-2">
            <div className="grid gap-0.5">
              <span className="text-sm flex items-center gap-1.5">
                支持视觉
                <VisionBadge p={profile} />
              </span>
              <span className="text-[10px] text-muted-foreground">
                继承值：{String(profile.supportsVision ?? "未声明")}
                {profile.supportsVision === true &&
                  profile.mediaDeliveryOverride !== "glm-chat-verified" &&
                  "——自定义端点下图片投递默认关闭（fail-closed）"}
              </span>
            </div>
            <div className="flex items-center gap-1">
              {visionOverride !== undefined &&
                visionOverride !== profile.supportsVision && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-xs"
                    onClick={() => setVisionOverride(undefined)}
                  >
                    还原继承
                  </Button>
                )}
              <Switch
                checked={visionOverride === true}
                onCheckedChange={(v) => setVisionOverride(v)}
              />
            </div>
          </div>
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button onClick={() => void save()} disabled={saving}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : "保存"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** 新增模型·第一步：选 provider（模板注册表投影一列；末尾自定义） */
function AddModelPickerDialog({
  presets,
  onClose,
  onPickPreset,
  onPickCustom,
}: {
  presets: ModelPresetEntry[];
  onClose: () => void;
  onPickPreset: (p: ModelPresetEntry) => void;
  onPickCustom: () => void;
}) {
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>新增模型</DialogTitle>
          <DialogDescription>选择提供商，或添加自定义端点。</DialogDescription>
        </DialogHeader>
        <div className="grid gap-1 max-h-80 overflow-y-auto">
          {presets.map((p) => (
            <button
              key={p.id}
              onClick={() => onPickPreset(p)}
              className="flex w-full items-center justify-between rounded-md border px-3 py-2 text-left text-sm hover:bg-muted transition-colors"
            >
              <span className="flex items-center gap-2">
                <span className="flex size-6 items-center justify-center rounded bg-muted text-[10px] font-bold uppercase">
                  {p.vendorLabel.slice(0, 2)}
                </span>
                {p.vendorLabel}
              </span>
              {p.branch === "coding" && (
                <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
                  订阅
                </Badge>
              )}
            </button>
          ))}
          <button
            onClick={onPickCustom}
            className="flex w-full items-center gap-2 rounded-md border border-dashed px-3 py-2 text-left text-sm text-muted-foreground hover:bg-muted transition-colors"
          >
            <span className="flex size-6 items-center justify-center rounded border border-dashed">
              <Plus className="size-3" />
            </span>
            自定义（任意 OpenAI/Anthropic 兼容端点）
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** 新增模型·第二步（模板）：选模型 + 填 key */
function AddFromPresetDialog({
  preset,
  onClose,
  onCreated,
}: {
  preset: ModelPresetEntry;
  onClose: () => void;
  onCreated: (msg: string) => void;
}) {
  const [modelId, setModelId] = useState(preset.models[0]?.modelId ?? "");
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    if (!modelId) {
      setError("请选择模型");
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const entry = preset.models.find((m) => m.modelId === modelId);
      await createModelProfile({
        name: `${preset.vendorLabel} ${modelId}`,
        protocol: preset.protocol,
        model_name: modelId,
        base_url: preset.baseURL,
        credentials: apiKey ? { api_key: apiKey } : undefined,
        context_length: entry?.contextLength,
        max_tokens: entry?.maxOutputTokens,
        quirks_json: entry?.mergedQuirks
          ? JSON.stringify(entry.mergedQuirks)
          : null,
        preset_provenance: preset.id,
      });
      onCreated(`已创建：${preset.vendorLabel} ${modelId}`);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {preset.vendorLabel}
            {preset.branch === "coding" && (
              <Badge variant="outline" className="ml-2 px-1.5 py-0 text-[10px]">
                订阅
              </Badge>
            )}
          </DialogTitle>
          <DialogDescription>{preset.baseURL}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1">
            <Label className="text-xs">模型</Label>
            <div className="grid gap-1 max-h-48 overflow-y-auto">
              {preset.models.map((m) => (
                <button
                  key={m.modelId}
                  onClick={() => setModelId(m.modelId)}
                  className={cn(
                    "flex w-full items-center justify-between rounded-md border px-3 py-1.5 text-left text-sm font-mono transition-colors",
                    modelId === m.modelId
                      ? "border-primary bg-accent"
                      : "hover:bg-muted",
                  )}
                >
                  <span className="truncate">{m.modelId}</span>
                  <span className="flex items-center gap-1 shrink-0">
                    {m.supportsVision && (
                      <EyeIcon
                        className="size-3 text-muted-foreground"
                        aria-label="视觉"
                      />
                    )}
                    {m.contextLength != null && (
                      <span className="text-[10px] text-muted-foreground">
                        {formatContextWindow(m.contextLength)}
                      </span>
                    )}
                  </span>
                </button>
              ))}
            </div>
          </div>
          <div className="grid gap-1">
            <Label className="text-xs">API Key</Label>
            <div className="relative">
              <Input
                type={showKey ? "text" : "password"}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="sk-…"
              />
              <button
                type="button"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground"
                onClick={() => setShowKey((v) => !v)}
                aria-label={showKey ? "隐藏 key" : "显示 key"}
              >
                {showKey ? (
                  <EyeOffIcon className="size-4" />
                ) : (
                  <EyeIcon className="size-4" />
                )}
              </button>
            </div>
          </div>
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button onClick={() => void create()} disabled={creating}>
            {creating ? <Loader2 className="size-4 animate-spin" /> : "保存"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** 新增模型·第二步（自定义端点） */
function CreateCustomDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (msg: string) => void;
}) {
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [modelName, setModelName] = useState("");
  const [protocol, setProtocol] = useState<ModelProtocol>("openai_compatible");
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [vision, setVision] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    if (!baseUrl.trim() || !modelName.trim()) {
      setError("Base URL 与模型名为必填");
      return;
    }
    setCreating(true);
    setError(null);
    try {
      await createModelProfile({
        name: name.trim() || modelName.trim(),
        protocol,
        model_name: modelName.trim(),
        base_url: baseUrl.trim(),
        credentials: apiKey ? { api_key: apiKey } : undefined,
        quirks_json: JSON.stringify({ supportsVision: vision }),
        preset_provenance: "hand",
      });
      onCreated("已创建自定义 profile");
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>自定义 Provider</DialogTitle>
          <DialogDescription>
            手配任意 OpenAI/Anthropic 兼容端点。
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1">
            <Label className="text-xs">Base URL（必填）</Label>
            <Input
              placeholder="https://api.example.com/v1"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1">
              <Label className="text-xs">协议族</Label>
              <select
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
                value={protocol}
                onChange={(e) => setProtocol(e.target.value as ModelProtocol)}
              >
                <option value="openai_compatible">openai_compatible</option>
                <option value="anthropic_compatible">
                  anthropic_compatible
                </option>
              </select>
            </div>
            <div className="grid gap-1">
              <Label className="text-xs">模型名（必填）</Label>
              <Input
                value={modelName}
                onChange={(e) => setModelName(e.target.value)}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1">
              <Label className="text-xs">显示名（可选）</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="grid gap-1">
              <Label className="text-xs">API Key</Label>
              <div className="relative">
                <Input
                  type={showKey ? "text" : "password"}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="sk-…"
                />
                <button
                  type="button"
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground"
                  onClick={() => setShowKey((v) => !v)}
                  aria-label={showKey ? "隐藏 key" : "显示 key"}
                >
                  {showKey ? (
                    <EyeOffIcon className="size-4" />
                  ) : (
                    <EyeIcon className="size-4" />
                  )}
                </button>
              </div>
            </div>
          </div>
          <div className="flex items-center justify-between rounded-md border px-3 py-2">
            <div className="grid gap-0.5">
              <span className="text-sm">支持视觉</span>
              <span className="text-[10px] text-muted-foreground">
                ⑤ 告知：自定义端点下图片投递默认关闭（fail-closed）——模型将
                收到占位文本而非图片字节
              </span>
            </div>
            <Switch checked={vision} onCheckedChange={setVision} />
          </div>
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button onClick={() => void create()} disabled={creating}>
            {creating ? <Loader2 className="size-4 animate-spin" /> : "创建"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ModelTab() {
  const [overview, setOverview] = useState<ModelConfigOverview | null>(null);
  const [presets, setPresets] = useState<ModelPresetEntry[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editing, setEditing] = useState<ProfileRow | null>(null);
  // 新增流弹窗态机：null=关 / 'picker' / { preset } / 'custom'
  const [addDialog, setAddDialog] = useState<
    null | "picker" | { preset: ModelPresetEntry } | "custom"
  >(null);
  const [deleteConfirm, setDeleteConfirm] = useState<ProfileRow | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{
    profileId: string;
    text: string;
    ok: boolean;
  } | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [ov, ps] = await Promise.all([
        getModelConfigOverview(),
        getModelPresets(),
      ]);
      setOverview(ov);
      setPresets(ps);
      setLoadError(null);
    } catch (e) {
      setLoadError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // revision 1s 轮询（跨端同步；弹窗打开时不刷新防表单覆盖）
  const lastRevision = useRef(0);
  const anyDialogOpen =
    editing !== null || addDialog !== null || deleteConfirm !== null;
  useEffect(() => {
    const timer = setInterval(async () => {
      try {
        const rev = await getModelConfigRevision();
        if (rev < 0) return;
        if (lastRevision.current === 0) {
          lastRevision.current = rev;
          return;
        }
        if (rev !== lastRevision.current) {
          lastRevision.current = rev;
          if (!anyDialogOpen) void refresh();
        }
      } catch {
        /* 静默 */
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [anyDialogOpen, refresh]);

  /** 平铺列表：当前使用置顶，其余按快照序（provider 聚合原序） */
  const allProfiles = useMemo(() => {
    if (!overview) return [];
    const rows = overview.groups.flatMap((g) =>
      g.profiles.map((p) => ({
        ...p,
        providerLabel: g.providerLabel,
        groupProtocol: g.protocol,
      })),
    );
    const selectedId = overview.selection;
    return rows.sort((a, b) => {
      if (a.profileId === selectedId) return -1;
      if (b.profileId === selectedId) return 1;
      return 0;
    });
  }, [overview]);

  /** 凭据复用测试（免手粘 key） */
  async function runTest(p: (typeof allProfiles)[number]) {
    setTestingId(p.profileId);
    setTestResult(null);
    try {
      const r = await probeDialect({
        model: p.modelName,
        protocol: (p.groupProtocol as ModelProtocol) || "openai_compatible",
        profileId: p.profileId,
      });
      if (r.validationStatus === "valid") {
        setTestResult({
          profileId: p.profileId,
          text: "测试成功",
          ok: true,
        });
      } else if (r.probe.indeterminate) {
        setTestResult({
          profileId: p.profileId,
          text: `无法判定（HTTP ${r.probe.httpStatus}）——凭据/网络问题`,
          ok: false,
        });
      } else {
        setTestResult({
          profileId: p.profileId,
          text: `疑似错族（HTTP ${r.probe.httpStatus}）：${r.probe.detail}`,
          ok: false,
        });
      }
      void refresh();
    } catch (e) {
      setTestResult({
        profileId: p.profileId,
        text: e instanceof Error ? e.message : String(e),
        ok: false,
      });
    } finally {
      setTestingId(null);
    }
  }

  async function doDelete(p: ProfileRow) {
    try {
      await deleteModelProfile(p.profileId);
      setDeleteConfirm(null);
      void refresh();
    } catch (e) {
      setMsg(`删除失败：${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (loadError) {
    return (
      <div className="space-y-2">
        <p className="text-sm text-destructive">加载失败：{loadError}</p>
        <Button size="sm" onClick={() => void refresh()}>
          重试
        </Button>
      </div>
    );
  }
  if (!overview) {
    return (
      <p className="text-sm text-muted-foreground py-8 text-center">加载中…</p>
    );
  }

  return (
    <div className="space-y-3">
      {msg && (
        <div className="rounded-md border bg-muted/50 px-3 py-2 text-sm">
          {msg}
        </div>
      )}

      {/* 已配置模型（平铺统一管理） */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">已配置模型</h3>
        <span className="text-xs text-muted-foreground">
          {allProfiles.length} 个
        </span>
      </div>
      <div className="space-y-2">
        {allProfiles.length === 0 && (
          <p className="text-sm text-muted-foreground py-4 text-center">
            还没有配置模型——点击下方「新增模型」开始。
          </p>
        )}
        {allProfiles.map((p) => {
          const selected = overview.selection === p.profileId;
          const testing = testingId === p.profileId;
          const result =
            testResult?.profileId === p.profileId ? testResult : null;
          return (
            <div
              key={p.profileId}
              className={cn(
                "flex items-center gap-2 rounded-md border px-3 py-2",
                selected && "border-primary/50",
              )}
            >
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-sm font-medium truncate">{p.name}</span>
                  {selected && <Badge>当前使用</Badge>}
                  <VisionBadge p={p} />
                  {p.contextLength != null && (
                    <Badge
                      variant="outline"
                      className="px-1.5 py-0 text-[10px]"
                    >
                      {formatContextWindow(p.contextLength)}
                    </Badge>
                  )}
                  {p.validationStatus === "valid" && (
                    <Badge
                      variant="outline"
                      className="px-1.5 py-0 text-[10px] text-emerald-600"
                    >
                      ✓
                    </Badge>
                  )}
                  {p.validationStatus === "needs_repair" && (
                    <Badge
                      variant="outline"
                      className="px-1.5 py-0 text-[10px] text-amber-600"
                    >
                      ⚠
                    </Badge>
                  )}
                  {p.presetProvenance === "hand" && (
                    <Badge
                      variant="secondary"
                      className="px-1.5 py-0 text-[10px]"
                    >
                      手配
                    </Badge>
                  )}
                </div>
                <div className="text-xs text-muted-foreground truncate">
                  <span className="font-mono">{p.modelName}</span>
                  <span className="mx-1">·</span>
                  {p.providerLabel}
                </div>
                {result && (
                  <p
                    className={cn(
                      "text-xs mt-1",
                      result.ok ? "text-emerald-600" : "text-destructive",
                    )}
                  >
                    {result.text}
                  </p>
                )}
              </div>
              <div className="flex gap-1 shrink-0">
                {!selected && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      void setModelSelection(p.profileId).then(refresh);
                    }}
                  >
                    使用
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label="测试连接"
                  title="测试连接"
                  disabled={testing || !p.apiKeyConfigured}
                  onClick={() => void runTest(p)}
                >
                  {testing ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Unplug className="size-4" />
                  )}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  aria-label="编辑"
                  onClick={() => setEditing(p)}
                >
                  <Pencil className="size-4" />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label="删除"
                  onClick={() => setDeleteConfirm(p)}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            </div>
          );
        })}
      </div>

      {/* 新增模型（两步式入口） */}
      <Button
        variant="outline"
        className="w-full border-dashed"
        onClick={() => setAddDialog("picker")}
      >
        <Plus className="size-4" />
        新增模型
      </Button>

      {/* 编辑弹窗 */}
      {editing && (
        <EditProfileDialog
          profile={editing}
          onClose={() => setEditing(null)}
          onSaved={() => void refresh()}
        />
      )}
      {/* 新增·第一步：选 provider */}
      {addDialog === "picker" && (
        <AddModelPickerDialog
          presets={presets}
          onClose={() => setAddDialog(null)}
          onPickPreset={(p) => setAddDialog({ preset: p })}
          onPickCustom={() => setAddDialog("custom")}
        />
      )}
      {/* 新增·第二步（模板）：选模型填 key */}
      {addDialog && typeof addDialog === "object" && "preset" in addDialog && (
        <AddFromPresetDialog
          preset={addDialog.preset}
          onClose={() => setAddDialog(null)}
          onCreated={(m) => {
            setMsg(m);
            void refresh();
          }}
        />
      )}
      {/* 新增·第二步（自定义） */}
      {addDialog === "custom" && (
        <CreateCustomDialog
          onClose={() => setAddDialog(null)}
          onCreated={(m) => {
            setMsg(m);
            void refresh();
          }}
        />
      )}
      {/* 删除确认 */}
      <Dialog
        open={deleteConfirm !== null}
        onOpenChange={(o) => !o && setDeleteConfirm(null)}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>确认删除</DialogTitle>
            <DialogDescription>
              将删除 profile「{deleteConfirm?.name}」（
              {deleteConfirm?.modelName}）。此操作不可撤销。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteConfirm(null)}>
              取消
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteConfirm && void doDelete(deleteConfirm)}
            >
              删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
