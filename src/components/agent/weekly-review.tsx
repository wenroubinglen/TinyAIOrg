"use client";

/**
 * 每周回顾——四源汇总。
 * 数据面：①cron（cron.list 全局+per-agent via ask agent）②inbox 存量
 * （inbox.list）③someday 清单（zone.list memory 区 topics/someday-*）
 * ④teammate 状态（agent.list）。手动发起为主；cron 自动触发可经
 * ClarifyWizard 的日程终点让 officer 自己建（recipient 绑定自身）。
 */
import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  CalendarCheck, Inbox as InboxIcon, Clock, Bot, Loader2, RefreshCw,
} from "lucide-react";
import {
  getInbox, getAgents, getPybZoneList,
  type InboxItemApi, type AgentConfig,
} from "@/lib/api";

interface ReviewData {
  inbox: InboxItemApi[];
  somedayFiles: Array<{ agent: string; files: Array<{ name: string; mtimeMs: number }> }>;
  teammates: Array<{ id: string; name: string; agentId: string }>;
  generatedAt: number;
}

async function collectReview(): Promise<ReviewData> {
  const [inbox, agents] = await Promise.all([getInbox(), getAgents()]);
  const teammateEntries = Object.entries(agents ?? {});

  // someday 清单：扫各 teammate memory 区（经 api base 的 zone 代理——
  // 相对路径 fetch 会打到 next 端口恒 404，审计第三轮坐实）
  const somedayFiles: ReviewData["somedayFiles"] = [];
  for (const [id, a] of teammateEntries) {
    try {
      const r = await getPybZoneList(id, "memory");
      const someday = (r.files ?? []).filter(f => f.name.includes("someday"));
      if (someday.length > 0) {
        somedayFiles.push({ agent: a.name, files: someday });
      }
    } catch { /* 单个 teammate 失败不阻塞回顾 */ }
  }

  return {
    inbox: inbox.items ?? [],
    somedayFiles,
    teammates: teammateEntries.map(([id, a]) => ({
      id, name: a.name, agentId: a.agent_id ?? "",
    })),
    generatedAt: Date.now(),
  };
}

export function WeeklyReview() {
  const [data, setData] = useState<ReviewData | null>(null);
  const [loading, setLoading] = useState(false);

  const run = useCallback(async () => {
    setLoading(true);
    try {
      setData(await collectReview());
    } catch { /* 保持现值 */ } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void run(); }, [run]);

  const pending = data?.inbox.filter(i => i.status === "pending") ?? [];
  const somedayTotal = data?.somedayFiles.reduce((n, s) => n + s.files.length, 0) ?? 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold flex items-center gap-2">
          <CalendarCheck className="h-4 w-4 text-primary" />
          每周回顾
        </h2>
        <Button size="sm" variant="ghost" onClick={() => void run()} disabled={loading}>
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          重新汇总
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {/* ① inbox 存量 */}
        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="text-xs flex items-center gap-2 text-muted-foreground">
              <InboxIcon className="h-3.5 w-3.5" />
              杂事箱存量
              <Badge variant="secondary" className="text-[10px]">{pending.length} 待厘清</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {pending.length === 0 ? (
              <p className="text-xs text-muted-foreground">收件箱清空 ✓</p>
            ) : (
              <div className="space-y-1">
                {pending.slice(0, 5).map(i => (
                  <p key={i.item_id} className="text-xs truncate">· {i.title}</p>
                ))}
                {pending.length > 5 && (
                  <p className="text-[10px] text-muted-foreground">…共 {pending.length} 条</p>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* ② someday 清单 */}
        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="text-xs flex items-center gap-2 text-muted-foreground">
              <Clock className="h-3.5 w-3.5" />
              将来也许（someday）
              <Badge variant="secondary" className="text-[10px]">{somedayTotal} 项</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {somedayTotal === 0 ? (
              <p className="text-xs text-muted-foreground">暂无 someday 条目</p>
            ) : (
              <div className="space-y-1">
                {data!.somedayFiles.map(s => (
                  <p key={s.agent} className="text-xs truncate">
                    · {s.agent}：{s.files.length} 项
                  </p>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* ③ teammate 状态 */}
        <Card className="md:col-span-2">
          <CardHeader className="pb-1">
            <CardTitle className="text-xs flex items-center gap-2 text-muted-foreground">
              <Bot className="h-3.5 w-3.5" />
              Teammates
              <Badge variant="secondary" className="text-[10px]">{data?.teammates.length ?? 0}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {(data?.teammates ?? []).length === 0 ? (
              <p className="text-xs text-muted-foreground">暂无 teammate</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {data!.teammates.map(t => (
                  <Badge key={t.id} variant="outline" className="text-[10px]">
                    {t.name}（@{t.id}）
                  </Badge>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <p className="text-xs text-muted-foreground">
        cron 任务面在各 teammate 详情页 Schedule tab 查看（cron.list-for-agent 双源）。
        回顾建议：清空 inbox → 检视 someday（孵化或删除）→ 检视各 teammate
        Schedule 下周任务。
      </p>
    </div>
  );
}
