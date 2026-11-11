"use client";

/**
 * 厘清向导——八终点决策树。
 *
 * 终点与动作：
 *  1. 2分钟内 → 立即完成（条目消亡）
 *  2. 有时间承诺 → agent.send 让 teammate 自己 CronCreate
 *  3. 多步骤 → agent.send 诱导 teammate 进 planmode（ACP 无直调，间接是设计）
 *  4. 委派 → agent.send 给目标 teammate
 *  5. 将来也许 → agent.send 让 teammate 自己 memory_write someday-*.md
 *  6. 参考大块 → agent.send 让 teammate 自己 study_write
 *  7. 参考小块 → agent.send 让 teammate 自己 memory_write reference-*.md
 *  8. 无价值 → 删除
 * memory/study 落 teammate 自己 per-agent 区（agent 自己写——zone.write 裸写
 * 破坏 frontmatter 契约，审计裁决禁止）。全部终点完成后条目消亡。
 */
import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Timer, CalendarClock, ListTodo, Send, Clock, BookOpen, Bookmark, Trash2,
  Loader2, User, X,
} from "lucide-react";
import {
  getInbox, getAgents, clarifyInboxItem, removeInboxItem, sendPybAgentMessage,
  type InboxItemApi, type AgentConfig,
} from "@/lib/api";

type Endpoint =
  | "done" | "schedule" | "project" | "delegate"
  | "someday" | "study" | "reference" | "trash";

const ENDPOINTS: Array<{
  id: Endpoint; label: string; hint: string; icon: typeof Timer; needsAgent?: boolean;
}> = [
  { id: "done", label: "2分钟内——立即做", hint: "不进系统，现在就完成它", icon: Timer },
  { id: "schedule", label: "有时间承诺——日程", hint: "teammate 用 CronCreate 落起始/截止/重复", icon: CalendarClock, needsAgent: true },
  { id: "project", label: "多步骤——转项目计划", hint: "teammate 进入 planmode 规划", icon: ListTodo, needsAgent: true },
  { id: "delegate", label: "委派给 Teammate", hint: "单聊投递，等待回执", icon: Send, needsAgent: true },
  { id: "someday", label: "将来也许", hint: "teammate 归档到自己的 someday 清单", icon: Clock, needsAgent: true },
  { id: "study", label: "参考资料（大块）", hint: "teammate 整理进自己的知识库", icon: BookOpen, needsAgent: true },
  { id: "reference", label: "参考资料（小块）", hint: "teammate 归档为速查参考", icon: Bookmark, needsAgent: true },
  { id: "trash", label: "无价值——丢弃", hint: "直接删除", icon: Trash2 },
];

function buildAgentInstruction(endpoint: Endpoint, title: string): string | null {
  switch (endpoint) {
    case "schedule":
      return `请为以下事项创建定时任务（用 CronCreate，起始/截止/重复三段按需设置，缺省段落省略）：${title}。创建后回复确认。`;
    case "project":
      return `以下事项是多步骤项目，请进入计划模式（EnterPlanMode）为它规划实施步骤：${title}`;
    case "delegate":
      return `请处理以下委派任务，完成后回报结果：${title}`;
    case "someday":
      return `请把以下事项归档到你的 someday（将来也许）清单：用 memory_write 在 topics/someday-*.md 落一行。事项：${title}`;
    case "study":
      return `以下是大块参考资料，请整理进你的知识库（study_write 落 wiki 页面）：${title}`;
    case "reference":
      return `以下是小块参考信息，请归档为速查参考（memory_write 落 topics/reference-*.md）：${title}`;
    default:
      return null;
  }
}

const DISPOSITION_MAP: Partial<Record<Endpoint, string>> = {
  schedule: "next_action",
  project: "plan",
  delegate: "delegate",
  someday: "someday",
  study: "reference",
  reference: "reference",
};

export function ClarifyWizard({ onChanged }: { onChanged?: () => void }) {
  const [items, setItems] = useState<InboxItemApi[]>([]);
  const [agents, setAgents] = useState<Record<string, AgentConfig>>({});
  const [activeItem, setActiveItem] = useState<InboxItemApi | null>(null);
  const [selectedAgent, setSelectedAgent] = useState("");
  const [executing, setExecuting] = useState<Endpoint | null>(null);
  const [feedback, setFeedback] = useState("");

  const load = useCallback(async () => {
    try {
      const [inbox, ag] = await Promise.all([getInbox(), getAgents()]);
      setItems(inbox.items ?? []);
      setAgents(ag ?? {});
    } catch { /* 保持现值 */ }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const pending = items.filter(i => i.status === "pending");
  const agentEntries = Object.entries(agents);

  const execute = async (endpoint: Endpoint) => {
    if (!activeItem) return;
    setExecuting(endpoint);
    setFeedback("");
    try {
      const instruction = buildAgentInstruction(endpoint, activeItem.title);
      const disposition = DISPOSITION_MAP[endpoint];

      if (instruction) {
        if (!selectedAgent) {
          setFeedback("此终点需要一个 Teammate——请先选择");
          setExecuting(null);
          return;
        }
        if (disposition) {
          await clarifyInboxItem(activeItem.item_id, disposition, selectedAgent);
        }
        const delivery = await sendPybAgentMessage(selectedAgent, instruction);
        if (!delivery?.delivered) {
          setFeedback("指令投递失败——条目保留，请重试");
          return;
        }
        // 投递确认后才消亡（send returned delivered=false 时条目保留——
        // turn 失败场景由 turn_failed 可观测，条目可重新厘清，不静默丢）
        await removeInboxItem(activeItem.item_id);
      } else {
        await removeInboxItem(activeItem.item_id);
      }
      setActiveItem(null);
      setSelectedAgent("");
      await load();
      onChanged?.();
    } catch (err) {
      setFeedback(`处置失败：${(err as Error).message}`);
    } finally {
      setExecuting(null);
    }
  };

  return (
    <div className="space-y-2">
      {pending.length > 0 && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">{pending.length} 条待厘清</p>
          <Button size="sm" variant="outline" onClick={() => setActiveItem(pending[0])}>
            开始厘清
          </Button>
        </div>
      )}

      {activeItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <Card className="w-full max-w-lg max-h-[85vh] overflow-auto">
            <CardContent className="p-4 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold truncate">
                  厘清：<span className="text-primary">{activeItem.title}</span>
                </p>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setActiveItem(null)}>
                  <X className="h-4 w-4" />
                </Button>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                  <User className="h-3 w-3" />
                  执行 Teammate（除"立即做/丢弃"外需要）
                </label>
                <select
                  value={selectedAgent}
                  onChange={(e) => setSelectedAgent(e.target.value)}
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                >
                  <option value="">选择 Teammate…</option>
                  {agentEntries.map(([id, a]) => (
                    <option key={id} value={id}>{a.name}（@{id}）</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-1 gap-2">
                {ENDPOINTS.map(({ id, label, hint, icon: Icon }) => (
                  <button
                    key={id}
                    onClick={() => void execute(id)}
                    disabled={!!executing}
                    className="flex items-center gap-3 border rounded-lg px-3 py-2 text-left hover:border-primary/50 hover:bg-muted/40 transition-colors disabled:opacity-50"
                  >
                    {executing === id ? (
                      <Loader2 className="h-4 w-4 animate-spin shrink-0" />
                    ) : (
                      <Icon className="h-4 w-4 shrink-0 text-primary" />
                    )}
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{label}</p>
                      <p className="text-xs text-muted-foreground">{hint}</p>
                    </div>
                  </button>
                ))}
              </div>

              {feedback && <p className="text-sm text-destructive">{feedback}</p>}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
