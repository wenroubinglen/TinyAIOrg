"use client";

/**
 * 搜索引擎设置分区（对齐模型侧体验）。
 * 平铺 6 个 provider 卡片——当前 provider 高亮单击即切（保存即生效：
 * 引擎每次 WebSearch 调用重读 config 零刷新）、需 key 的显示配置状态、
 * 免 key 的标徽标；「配置」按钮开两步式弹窗（选 provider→设 key，免 key
 * 的直接保存）。source=project 时提示「被项目配置覆盖」。
 * 安全纪律：key 永不回传明文（GET 只给 isSet+source）——留空=保持不变。
 */
import { useCallback, useState } from "react";
import {
  getWebSearchSettings,
  saveWebSearchSettings,
  type WebSearchSettings,
} from "@/lib/api";
import { usePolling } from "@/lib/hooks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Loader2, Search, EyeIcon, EyeOffIcon } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

const PROVIDERS: Array<{
  id: string;
  name: string;
  needsKey: boolean;
  note?: string;
}> = [
  { id: "duckduckgo", name: "DuckDuckGo", needsKey: false, note: "默认，开箱即用" },
  { id: "tavily", name: "Tavily", needsKey: true },
  { id: "exa", name: "Exa", needsKey: true },
  { id: "bocha", name: "博查（Bocha）", needsKey: true },
  { id: "zhipu", name: "智谱搜索", needsKey: true },
  { id: "searxng", name: "SearXNG", needsKey: false, note: "公共实例" },
];

function providerName(id: string): string {
  return PROVIDERS.find((p) => p.id === id)?.name ?? id;
}

export function SearchTab() {
  const { data, refresh } = usePolling<WebSearchSettings>(
    getWebSearchSettings,
    0,
    [],
  );
  // 配置弹窗目标 provider：卡片「配置」按钮已确定 provider——直接带 id
  // 进第二步设 key；null 才走完整两步（从选 provider 开始）。
  const [configTarget, setConfigTarget] = useState<string | null>(null);
  const [switching, setSwitching] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const current = data?.provider.value;
  const keyInfo = data?.apiKey;

  const switchProvider = useCallback(
    async (id: string) => {
      if (id === current || switching) return;
      // 直接切换：GET 投影只含当前 provider 的 key 状态，无法预判目标
      // provider 是否已配 key（曾据当前 provider 的 keyInfo 误判目标——
      // Tavily 已配 key 仍被弹配置框的缺陷根源）。目标已有 key 立即可用；
      // 未配的由用户在卡片上自行点「配置」。
      setSwitching(id);
      setStatus(null);
      try {
        await saveWebSearchSettings({ provider: id });
        await refresh();
        setStatus(`已切换到 ${providerName(id)}`);
      } catch (e) {
        setStatus(e instanceof Error ? e.message : String(e));
      } finally {
        setSwitching(null);
      }
    },
    [current, switching, keyInfo, refresh],
  );

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">搜索引擎</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Agent 联网搜索使用的引擎。切换与密钥保存后即时生效。
        </p>
      </div>

      {data?.provider.source === "project" && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-600 dark:text-amber-400">
          当前配置被项目配置覆盖（config.json 中 projects 段配置了搜索）——
          此处修改全局配置不影响当前项目。
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {PROVIDERS.map((p) => {
          const active = p.id === current;
          return (
            <div
              key={p.id}
              className={cn(
                "rounded-lg border p-4 transition-colors",
                active ? "border-primary bg-primary/5" : "hover:border-muted-foreground/30",
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-medium truncate">{p.name}</span>
                    {active && <Badge variant="default" className="px-1.5 text-[10px]">当前</Badge>}
                    {!p.needsKey && (
                      <Badge variant="secondary" className="px-1.5 text-[10px]">免 key</Badge>
                    )}
                  </div>
                  {p.note && (
                    <p className="text-xs text-muted-foreground mt-0.5">{p.note}</p>
                  )}
                  {p.needsKey && active && keyInfo && (
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {keyInfo.isSet
                        ? `密钥已配置（来源：${sourceLabel(keyInfo.source)}）`
                        : "未配置密钥——搜索将不可用，请先配置"}
                    </p>
                  )}
                  {p.needsKey && !active && (
                    <p className="text-xs text-muted-foreground/60 mt-0.5">需要 API Key</p>
                  )}
                </div>
                <div className="flex shrink-0 gap-1">
                  {p.needsKey && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => setConfigTarget(p.id)}
                    >
                      配置
                    </Button>
                  )}
                  <Button
                    variant={active ? "secondary" : "default"}
                    size="sm"
                    className="h-7 text-xs"
                    disabled={active || switching !== null}
                    onClick={() => void switchProvider(p.id)}
                  >
                    {switching === p.id ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : active ? (
                      "使用中"
                    ) : (
                      "切换"
                    )}
                  </Button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {status && <p className="text-sm text-muted-foreground">{status}</p>}

      {configTarget !== null && (
        <ConfigDialog
          initialProvider={configTarget}
          onClose={() => setConfigTarget(null)}
          onSaved={async (msg) => {
            setConfigTarget(null);
            await refresh();
            setStatus(msg);
          }}
        />
      )}
    </div>
  );
}

function sourceLabel(s: string): string {
  switch (s) {
    case "project": return "项目配置";
    case "global": return "全局配置";
    case "env": return "环境变量";
    default: return "未配置";
  }
}

/** 两步式配置弹窗：①选 provider ②设 key（免 key 的直接保存）。
 * initialProvider 有值（卡片「配置」按钮入口）时跳过第一步直达设 key。 */
function ConfigDialog({
  initialProvider,
  onClose,
  onSaved,
}: {
  initialProvider?: string;
  onClose: () => void;
  onSaved: (msg: string) => void;
}) {
  const [step, setStep] = useState<1 | 2>(initialProvider ? 2 : 1);
  const [provider, setProvider] = useState<string | null>(initialProvider ?? null);
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const target = PROVIDERS.find((p) => p.id === provider);

  async function save(clearKey = false) {
    if (!provider) return;
    setSaving(true);
    setError(null);
    try {
      await saveWebSearchSettings({
        provider,
        ...(clearKey
          ? { apiKey: null }
          : apiKey.trim()
            ? { apiKey: apiKey.trim() }
            : {}),
      });
      onSaved(
        clearKey
          ? `已清除 ${providerName(provider)} 密钥`
          : `已保存 ${providerName(provider)}`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        {step === 1 ? (
          <>
            <DialogHeader>
              <DialogTitle>选择搜索引擎</DialogTitle>
              <DialogDescription>
                选择要配置或切换到的引擎。
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-2">
              {PROVIDERS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    setProvider(p.id);
                    if (p.needsKey) setStep(2);
                    else void save();
                  }}
                  disabled={saving}
                  className="flex items-center justify-between rounded-md border px-3 py-2.5 text-left text-sm transition-colors hover:bg-accent disabled:opacity-50"
                >
                  <span className="flex items-center gap-2">
                    <Search className="size-4 text-muted-foreground" />
                    {p.name}
                    {!p.needsKey && (
                      <Badge variant="secondary" className="px-1.5 text-[10px]">免 key</Badge>
                    )}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {p.needsKey ? "需 API Key" : p.note}
                  </span>
                </button>
              ))}
            </div>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>配置 {target?.name}</DialogTitle>
              <DialogDescription>
                {apiKey
                  ? "输入新密钥后保存即替换。"
                  : "留空保持当前密钥不变，输入新值即替换。"}
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-1">
              <Label className="text-xs">API Key</Label>
              <div className="relative">
                <Input
                  type={showKey ? "text" : "password"}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  autoComplete="off"
                  placeholder="留空保持当前 key"
                />
                {apiKey && (
                  <button
                    type="button"
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground"
                    onClick={() => setShowKey((v) => !v)}
                    aria-label={showKey ? "隐藏 key" : "显示 key"}
                  >
                    {showKey ? <EyeOffIcon className="size-4" /> : <EyeIcon className="size-4" />}
                  </button>
                )}
              </div>
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <DialogFooter className="flex-row justify-between sm:justify-between">
              <Button
                variant="ghost"
                className="text-destructive hover:text-destructive"
                disabled={saving}
                onClick={() => void save(true)}
              >
                清除密钥
              </Button>
              <div className="flex gap-2">
                <Button variant="outline" disabled={saving} onClick={() => setStep(1)}>
                  上一步
                </Button>
                <Button onClick={() => void save()} disabled={saving}>
                  {saving ? <Loader2 className="size-4 animate-spin" /> : "保存"}
                </Button>
              </div>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
