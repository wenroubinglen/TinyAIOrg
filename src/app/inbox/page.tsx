"use client";

/**
 * GTD 杂事箱（capture tray）。
 * 快速收集入口（随时添加）+ 清单 + 删除；厘清按钮接入向导——
 * 八终点处置后条目消亡。
 */
import { useState, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Inbox, Plus, Trash2, Loader2, Check } from "lucide-react";
import { usePolling } from "@/lib/hooks";
import { getInbox, addInboxItem, removeInboxItem, type InboxItemApi } from "@/lib/api";
import { ClarifyWizard } from "@/components/agent/clarify-wizard";
import { WeeklyReview } from "@/components/agent/weekly-review";

function fmtTime(ms: number): string {
  const d = new Date(ms);
  return `${d.getMonth() + 1}-${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export default function InboxPage() {
  const { data, loading, refresh } = usePolling<{ items: InboxItemApi[] }>(getInbox, 10000);
  const [input, setInput] = useState("");
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [error, setError] = useState("");

  const add = useCallback(async () => {
    const title = input.trim();
    if (!title || adding) return;
    setAdding(true);
    setError("");
    try {
      await addInboxItem(title);
      setInput("");
      refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setAdding(false);
    }
  }, [input, adding, refresh]);

  const remove = useCallback(async (itemId: string) => {
    setDeleting(itemId);
    try {
      await removeInboxItem(itemId);
      refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setDeleting(null);
    }
  }, [refresh]);

  const items = data?.items ?? [];

  return (
    <div className="p-8 space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Inbox className="h-5 w-5 text-primary" />
          杂事箱
          {items.length > 0 && (
            <Badge variant="secondary" className="text-[10px]">{items.length}</Badge>
          )}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          GTD 收集盘——想到什么先扔进来，稍后厘清（两分钟/日程/项目/委派/将来）
        </p>
      </div>

      {/* 快速收集 */}
      <div className="flex items-center gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); void add(); }
          }}
          placeholder="想到什么？回车快速收集..."
          className="flex-1 rounded-md border bg-background px-3 py-2 text-sm"
        />
        <Button onClick={() => void add()} disabled={adding || !input.trim()}>
          {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          收集
        </Button>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}

      {/* 清单 */}
      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-8">
          <Loader2 className="h-4 w-4 animate-spin" />
          加载杂事中...
        </div>
      ) : items.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center">
            <Inbox className="h-10 w-10 text-muted-foreground mx-auto mb-4" />
            <p className="text-lg font-medium">杂事箱是空的</p>
            <p className="text-sm text-muted-foreground mt-1">
              头脑清空——把一切未定之事先收集到这里
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="divide-y">
            {items.map((item) => (
              <div key={item.item_id} className="flex items-center justify-between py-3 px-2">
                <div className="min-w-0 flex-1">
                  <p className="text-sm truncate">{item.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {fmtTime(item.created_at)} · {item.source}
                    {item.status === "clarified" && item.disposition && (
                      <span className="ml-1 text-primary">→ {item.disposition}</span>
                    )}
                  </p>
                </div>
                <div className="flex items-center gap-1 shrink-0 ml-2">
                  {item.status === "pending" && (
                    <Badge variant="outline" className="text-[10px]">待厘清</Badge>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground hover:text-destructive"
                    onClick={() => void remove(item.item_id)}
                    disabled={deleting === item.item_id}
                  >
                    {deleting === item.item_id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Trash2 className="h-3.5 w-3.5" />
                    )}
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* 厘清向导（八终点决策树） */}
      <ClarifyWizard onChanged={refresh} />

      {/* 每周回顾（四源汇总） */}
      <WeeklyReview />
    </div>
  );
}
