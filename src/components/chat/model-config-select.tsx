"use client";

/**
 * 聊天侧模型选择器（ModelConfigSelect 同构）。
 *
 * 两级菜单（provider 分组→模型），能力 badge 双态（视觉已验证/视觉声明
 * 但投递关闭），当前选中态，footer 直跳设置页。数据源全部现成
 * （getModelConfigOverview + setModelSelection——零后端）；1s revision
 * 轮询感知跨端切换（切换下一 turn 生效——引擎实时读库已坐实）。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getModelConfigOverview,
  getModelConfigRevision,
  setModelSelection,
  type ModelConfigOverview,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EyeIcon, EyeOffIcon, ChevronRight } from "lucide-react";

function useModelConfigPolling(onChange: () => void) {
  const lastRevision = useRef(0);
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
          onChange();
        }
      } catch {
        /* 轮询失败静默 */
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [onChange]);
}

/** ⑤ badge 双态：声明视觉且 override=「已验证」；声明但无 override=「投递关闭」 */
function VisionBadge({
  supportsVision,
  mediaDeliveryOverride,
}: {
  supportsVision?: boolean;
  mediaDeliveryOverride?: string | null;
}) {
  if (supportsVision !== true) return null;
  const verified = mediaDeliveryOverride === "glm-chat-verified";
  return (
    <Badge
      variant={verified ? "default" : "secondary"}
      className="ml-1.5 gap-0.5 px-1 py-0 text-[10px]"
      title={
        verified
          ? "视觉已验证（模板 override）"
          : "视觉声明但投递关闭（自定义端点 fail-closed）"
      }
    >
      {verified ? (
        <EyeIcon className="size-2.5" />
      ) : (
        <EyeOffIcon className="size-2.5" />
      )}
      {verified ? "视觉" : "视觉*"}
    </Badge>
  );
}

export function ModelConfigSelect({ className }: { className?: string }) {
  const [overview, setOverview] = useState<ModelConfigOverview | null>(null);
  const [switching, setSwitching] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setOverview(await getModelConfigOverview());
    } catch {
      /* 拉取失败保持旧数据 */
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useModelConfigPolling(refresh);

  const selected = useMemo(
    () =>
      overview?.groups
        .flatMap((g) => g.profiles)
        .find((p) => p.profileId === overview.selection) ?? null,
    [overview],
  );

  async function select(profileId: string) {
    setSwitching(true);
    try {
      await setModelSelection(profileId);
      await refresh();
    } finally {
      setSwitching(false);
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={`h-7 gap-1.5 px-2 text-xs ${className ?? ""}`}
          disabled={switching}
        >
          {selected ? (
            <>
              <span className="max-w-[140px] truncate font-medium">
                {selected.modelName}
              </span>
              <VisionBadge
                supportsVision={selected.supportsVision}
                mediaDeliveryOverride={selected.mediaDeliveryOverride}
              />
            </>
          ) : (
            "选择模型"
          )}
          <ChevronRight className="size-3 rotate-90 opacity-50" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        {overview?.groups.map((group) => (
          <DropdownMenuSub key={group.providerId ?? "__unassigned__"}>
            <DropdownMenuSubTrigger className="text-xs">
              <span className="max-w-[180px] truncate">
                {group.providerLabel}
              </span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="max-h-72 overflow-y-auto">
              <DropdownMenuLabel className="text-[10px] text-muted-foreground">
                {group.providerLabel}
              </DropdownMenuLabel>
              {group.profiles.map((p) => (
                <DropdownMenuItem
                  key={p.profileId}
                  onClick={() => void select(p.profileId)}
                  className={
                    p.profileId === overview.selection
                      ? "bg-accent text-accent-foreground"
                      : ""
                  }
                >
                  <span className="max-w-[160px] truncate font-mono text-xs">
                    {p.modelName}
                  </span>
                  <VisionBadge
                    supportsVision={p.supportsVision}
                    mediaDeliveryOverride={p.mediaDeliveryOverride}
                  />
                  {p.validationStatus === "valid" && (
                    <Badge
                      variant="outline"
                      className="ml-auto px-1 py-0 text-[10px]"
                    >
                      ✓
                    </Badge>
                  )}
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <a href="/settings" className="text-xs text-muted-foreground">
            管理模型…（设置页）
          </a>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
