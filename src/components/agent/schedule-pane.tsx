"use client";

/**
 * bot 定时任务全景面（原聊天窗模式切换载体）。
 * props 泛化 recipient{kind:'agent'|'group',id}
 * ——单聊面双源（owned+assigned）join listScheduledTasks 补齐；群/指挥室面
 * 单源群库全量（用户特权通道）。Run history + Test run 两面同用。
 * 内容区自适应栏宽（去 max-w-3xl——右栏抽屉共用 editW）。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  CalendarDays,
  Clock,
  Loader2,
  PlayCircle,
  RefreshCw,
  Trash2,
  Zap,
} from "lucide-react";
import {
  getPybCronForAgent,
  getPybCronForGroup,
  deletePybCron,
  deletePybCronForGroup,
  listScheduledTasks,
  listRecentScheduledTaskRuns,
  triggerScheduledTaskRun,
  isSkillTriggerFor,
  type ScheduledTaskRunLite,
} from "@/lib/api";
import { describeCron, describeTaskSchedule } from "@/lib/cron-human";
import { TaskCreateForm } from "@/components/agent/task-create-form";

function fmtTime(ts: number | null | undefined): string {
  if (!ts) return "—";
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(
    d.getMinutes(),
  ).padStart(2, "0")}`;
}

const STATUS_LABEL: Record<string, string> = {
  enabled: "启用",
  active: "进行中",
  pending: "未激活",
  expired: "已过期",
  completed: "已完成",
  disabled: "已禁用",
};
const STATUS_BADGE: Record<string, "secondary" | "outline" | "destructive"> = {
  enabled: "secondary",
  active: "secondary",
  pending: "outline",
  completed: "outline",
  disabled: "outline",
  expired: "destructive",
};

/** 类型徽章：延时（relative 启发式）/一次性/循环/技能触发（prompt 含 /id） */
function TypeBadge({
  scheduleKind,
  cron,
  prompt,
}: {
  scheduleKind?: string;
  cron: string;
  prompt?: string;
}) {
  const oneShot = scheduleKind
    ? scheduleKind === "one_shot"
    : cron.trim() === "* * * * *";
  const isRelative = oneShot && cron.trim() === "* * * * *";
  if (isRelative) {
    return (
      <Badge variant="outline" className="text-[9px] gap-0.5">
        <Zap className="h-2.5 w-2.5" /> 延时
      </Badge>
    );
  }
  if (oneShot) {
    return (
      <Badge variant="outline" className="text-[9px]">
        一次性
      </Badge>
    );
  }
  const skillMatch =
    typeof prompt === "string" && prompt.includes("使用 SkillTool 运行技能 /");
  return (
    <Badge variant="outline" className="text-[9px] gap-0.5">
      <Clock className="h-2.5 w-2.5" /> {skillMatch ? "技能循环" : "循环"}
    </Badge>
  );
}

function RunStatusIcon({ status }: { status: string }) {
  const map: Record<string, { c: string; t: string }> = {
    running: { c: "text-blue-500 animate-pulse", t: "运行中" },
    dispatching: { c: "text-blue-400", t: "派发中" },
    queued: { c: "text-muted-foreground", t: "排队" },
    completed: { c: "text-emerald-500", t: "成功" },
    failed: { c: "text-destructive", t: "失败" },
    killed: { c: "text-destructive", t: "被杀" },
    timed_out: { c: "text-amber-500", t: "超时" },
    skipped: { c: "text-muted-foreground", t: "跳过" },
  };
  const s = map[status] ?? { c: "text-muted-foreground", t: status };
  return (
    <span className={`text-[9px] ${s.c}`} title={status}>
      {s.t}
    </span>
  );
}

export function SchedulePane({
  recipient,
  recipientLabel,
}: {
  /** recipient 泛化：agent（单聊面，双源 owned/assigned）| group（群/指挥室
   *  面，群库全量——用户特权通道，无 assigned 概念） */
  recipient: { kind: "agent" | "group"; id: string };
  /** 受众显示名（群面徽章文案用） */
  recipientLabel?: string;
}) {
  const [tasks, setTasks] = useState<Array<{
    taskId: string;
    name: string;
    cron: string;
    prompt?: string;
    nextFireAt: number | null;
    status: string;
    kind: "owned" | "assigned";
    scheduleKind?: string;
  }> | null>(null);
  const [runs, setRuns] = useState<ScheduledTaskRunLite[] | null>(null);
  const [busyTask, setBusyTask] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      if (recipient.kind === "group") {
        // 群/指挥室面：单源群库全量（含 prompt/scheduleKind），无 owned/assigned 之分
        const { tasks: groupTasks } = await getPybCronForGroup(recipient.id);
        setTasks(
          groupTasks.map((t) => ({
            taskId: t.taskId,
            name: t.name,
            cron: t.cron,
            prompt: t.prompt ?? undefined,
            nextFireAt: t.nextFireAt,
            status: t.status,
            kind: "owned" as const,
            scheduleKind: t.scheduleKind ?? undefined,
          })),
        );
      } else {
        // 单聊面：双源 + 全量 join（scheduleKind/status 补齐）
        const [dual, all] = await Promise.all([
          getPybCronForAgent(recipient.id),
          listScheduledTasks().catch(
            () => [] as Awaited<ReturnType<typeof listScheduledTasks>>,
          ),
        ]);
        const byId = new Map(all.map((t) => [t.taskId, t]));
        const merged = [
          ...dual.owned.map((t) => {
            const full = byId.get(t.taskId);
            return {
              taskId: t.taskId,
              name: t.name,
              cron: t.cron,
              prompt: full?.prompt,
              nextFireAt: t.nextFireAt ?? full?.nextFireAt ?? null,
              status: t.status ?? full?.status ?? "enabled",
              kind: "owned" as const,
              scheduleKind: full?.scheduleKind,
            };
          }),
          ...dual.assigned.map((t) => {
            const full = byId.get(t.taskId);
            return {
              taskId: t.taskId,
              name: t.name,
              cron: t.cron,
              prompt: full?.prompt,
              nextFireAt: t.nextFireAt ?? full?.nextFireAt ?? null,
              status: t.status ?? full?.status ?? "enabled",
              kind: "assigned" as const,
              scheduleKind: full?.scheduleKind,
            };
          }),
        ];
        setTasks(merged);
      }
    } catch {
      setTasks([]);
    }
    try {
      setRuns(await listRecentScheduledTaskRuns(50));
    } catch {
      setRuns([]);
    }
  }, [recipient.kind, recipient.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const runsByTask = useMemo(() => {
    const m = new Map<string, ScheduledTaskRunLite[]>();
    for (const r of runs ?? []) {
      const arr = m.get(r.taskId) ?? [];
      if (arr.length < 5) arr.push(r);
      m.set(r.taskId, arr);
    }
    return m;
  }, [runs]);

  // 终审三合一②前端对偶：终态任务折叠（主列表=活跃，终态入可展开区）
  const [showTerminal, setShowTerminal] = useState(false);
  const activeTasks = (tasks ?? []).filter(
    (t) => t.status !== "completed" && t.status !== "expired",
  );
  const terminalTasks = (tasks ?? []).filter(
    (t) => t.status === "completed" || t.status === "expired",
  );

  const handleDelete = async (taskId: string) => {
    setBusyTask(taskId);
    setNotice(null);
    try {
      if (recipient.kind === "group") {
        await deletePybCronForGroup(recipient.id, taskId);
      } else {
        await deletePybCron(recipient.id, taskId);
      }
      await load();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyTask(null);
      setConfirming(null);
    }
  };

  const handleRunNow = async (taskId: string) => {
    setBusyTask(taskId);
    setNotice(null);
    try {
      const r = await triggerScheduledTaskRun(taskId);
      setNotice(
        r.ok
          ? `已手动触发（run ${r.runId?.slice(0, 8) ?? "?"})——结果将出现在运行历史与聊天流`
          : `触发失败：${r.error ?? "未知错误"}`,
      );
      if (r.ok) setTimeout(() => void load(), 1500);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyTask(null);
    }
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-full p-4 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <CalendarDays className="h-4 w-4 text-primary" />
            定时任务
            {tasks && tasks.length > 0 && (
              <Badge variant="secondary" className="text-[10px]">
                {tasks.length}
              </Badge>
            )}
          </h2>
          <div className="flex items-center gap-2">
            {/* 桌面直建四段表单（recipient 随面绑 agent/group） */}
            <TaskCreateForm
              recipient={recipient}
              recipientLabel={recipientLabel}
              onCreated={() => void load()}
            />
            <button
              className="text-muted-foreground hover:text-foreground"
              onClick={() => void load()}
              title="刷新"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {notice && (
          <div className="rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-xs text-foreground">
            {notice}
          </div>
        )}

        {tasks === null || runs === null ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-8">
            <Loader2 className="h-4 w-4 animate-spin" /> 加载任务清单…
          </div>
        ) : activeTasks.length === 0 && terminalTasks.length === 0 ? (
          <div className="rounded-lg border border-dashed p-8 text-center">
            <CalendarDays className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">还没有定时任务。</p>
            <p className="text-xs text-muted-foreground mt-2">
              {recipient.kind === "agent"
                ? "点上方「新建任务」四段表单直建（循环/一次性/延时+起止窗）；或在聊天里说「每天 9 点提醒我…」让它自己 CronCreate；技能面板 ⏰ 可挂技能循环。"
                : `点上方「新建任务」为「${recipientLabel ?? "群"}」建群级定时提醒（到点向全员轮转发）；成员自己的提醒由成员在单聊建。`}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {activeTasks.map((t) => {
              const myRuns = runsByTask.get(t.taskId) ?? [];
              return (
                <div key={t.taskId} className="rounded-lg border p-3 space-y-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium truncate max-w-[16rem]">
                      {t.name || t.taskId.slice(0, 12)}
                    </span>
                    <TypeBadge
                      scheduleKind={t.scheduleKind}
                      cron={t.cron}
                      prompt={t.prompt}
                    />
                    {recipient.kind === "agent" && (
                      <Badge
                        variant={t.kind === "owned" ? "outline" : "secondary"}
                        className="text-[9px]"
                      >
                        {t.kind === "owned" ? "自有" : "被指派"}
                      </Badge>
                    )}
                    <Badge
                      variant={STATUS_BADGE[t.status] ?? "outline"}
                      className="text-[9px]"
                    >
                      {STATUS_LABEL[t.status] ?? t.status}
                    </Badge>
                    <span className="ml-auto flex items-center gap-1">
                      {confirming === t.taskId ? (
                        <>
                          <Button
                            variant="destructive"
                            size="sm"
                            className="h-6 text-[10px]"
                            disabled={busyTask === t.taskId}
                            onClick={() => void handleDelete(t.taskId)}
                          >
                            确认删除
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 text-[10px]"
                            onClick={() => setConfirming(null)}
                          >
                            取消
                          </Button>
                        </>
                      ) : (
                        <>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 gap-1 text-[10px]"
                            title="手动触发一次（不影响调度节奏）"
                            disabled={busyTask === t.taskId}
                            onClick={() => void handleRunNow(t.taskId)}
                          >
                            <PlayCircle className="h-3 w-3" />
                            {busyTask === t.taskId ? "触发中…" : "试跑"}
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 text-muted-foreground hover:text-destructive"
                            title="删除任务"
                            disabled={busyTask === t.taskId}
                            onClick={() => setConfirming(t.taskId)}
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </>
                      )}
                    </span>
                  </div>
                  <div
                    className="text-xs text-muted-foreground font-mono truncate"
                    title={t.cron}
                  >
                    {describeTaskSchedule({
                      cron: t.cron,
                      scheduleKind: t.scheduleKind,
                    })}{" "}
                    · 下次 {fmtTime(t.nextFireAt)}
                  </div>
                  {t.prompt && (
                    <div
                      className="text-[11px] text-muted-foreground/80 truncate"
                      title={t.prompt}
                    >
                      {t.prompt}
                    </div>
                  )}
                  {myRuns.length > 0 && (
                    <div className="border-t pt-1.5 flex items-center gap-3 flex-wrap">
                      <span className="text-[9px] text-muted-foreground">
                        近期运行
                      </span>
                      {myRuns.map((r) => (
                        <span
                          key={r.runId}
                          className="flex items-center gap-1 text-[9px] text-muted-foreground"
                        >
                          {fmtTime(r.triggeredAt).slice(5)}
                          <RunStatusIcon status={r.status} />
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}

            {/* 终态折叠区：completed/expired 归档（不占主列表，上限计数也不计） */}
            {terminalTasks.length > 0 && (
              <div className="rounded-lg border border-dashed">
                <button
                  type="button"
                  className="flex w-full items-center gap-2 px-3 py-2 text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => setShowTerminal((v) => !v)}
                >
                  {showTerminal ? "▾" : "▸"} 已结束（{terminalTasks.length}）
                  <span className="text-[10px] text-muted-foreground/60">
                    完成/过期任务归档——不影响 50 活任务上限
                  </span>
                </button>
                {showTerminal &&
                  terminalTasks.map((t) => (
                    <div
                      key={t.taskId}
                      className="flex items-center gap-2 border-t px-3 py-2 text-xs text-muted-foreground"
                    >
                      <span className="truncate max-w-[14rem]">
                        {t.name || t.taskId.slice(0, 12)}
                      </span>
                      <Badge variant="outline" className="text-[9px]">
                        {STATUS_LABEL[t.status] ?? t.status}
                      </Badge>
                      <span
                        className="truncate font-mono text-[10px] opacity-70"
                        title={t.cron}
                      >
                        {describeTaskSchedule({
                          cron: t.cron,
                          scheduleKind: t.scheduleKind,
                        })}
                      </span>
                      <button
                        className="ml-auto text-muted-foreground/60 hover:text-destructive"
                        title="删除归档任务"
                        onClick={() => void handleDelete(t.taskId)}
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
              </div>
            )}
          </div>
        )}

        <p className="text-[10px] text-muted-foreground">
          {recipient.kind === "agent"
            ? "任务与 bot 的 cron 库同源（自有=它创建的，被指派=全局指派给它的）；试跑以手动模式触发一次，不改变原调度节奏。"
            : `群级任务落群独立库（用户特权通道——到点向「${recipientLabel ?? "群"}」全员轮转发提醒）；试跑同律，不改变原调度节奏。`}
        </p>
      </div>
    </div>
  );
}
