"use client";

import { useEffect, useState } from "react";
import { ModelTab } from "@/components/settings/model-tab";
import { SearchTab } from "@/components/settings/search-tab";
import { Boxes, Globe } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * 画布化改造：设置 = 画布之上的模态层，不走路由——画布永不卸载，
 * 关闭即回到用户原来停留的视角（无重排）。全屏暗色虚化只突出中间
 * 不透明设置卡片；无标题栏无 X 钮，唯一退出 = 点击卡片外任意处 / Esc。
 * 分区导航在卡片左侧竖列（模型配置/搜索引擎），右侧为分区面板。
 */
export function SettingsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [activeSection, setActiveSection] = useState("model");

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const sections = [
    { key: "model", label: "模型配置", icon: Boxes },
    { key: "search", label: "搜索引擎", icon: Globe },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[82vh] w-[min(880px,88vw)] rounded-xl border border-border/60 bg-background shadow-2xl"
      >
        {/* 左侧竖列分区导航 */}
        <nav className="w-44 shrink-0 space-y-1 border-r border-border p-3">
          {sections.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setActiveSection(key)}
              className={cn(
                "flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm transition-colors",
                activeSection === key
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
              )}
            >
              <Icon className="size-4" />
              {label}
            </button>
          ))}
        </nav>

        {/* 右侧分区面板 */}
        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto p-5">
          {activeSection === "model" && <ModelTab />}
          {activeSection === "search" && <SearchTab />}
        </div>
      </div>
    </div>
  );
}
