"use client";

/**
 * 四段创建表单（挂 SchedulePane）。
 * ①模式（循环/一次性/延时）②时间（96 档 15 分钟选择器 × 星期 + Advanced cron）
 * ③起止窗（validFrom/expiresAt，仅 cron 模式——R4/R6 契约）④recipient。
 * 调度预览统一走 describeTaskSchedule 纪律；引擎 R1-R6 全护栏。
 * props 泛化 recipient{kind:'agent'|'group',id}
 * ——单聊面绑 agent 库（技能维度可用）；群/指挥室面绑群库（用户特权通道，
 * 技能维度隐藏——群任务无单一 agent 技能面）。
 */
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, Plus, Sparkles, X } from "lucide-react";
import { createScheduledTask, listAgentSkills } from "@/lib/api";
import { describeCron, describeTaskSchedule } from "@/lib/cron-human";

const DAYS = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
/** 96 档 15 分钟时刻 */
const TIME_OPTIONS = Array.from({ length: 96 }, (_, i) => {
  const m = i * 15;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return {
    label: `${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}`,
    minute: m,
  };
});

type Mode = "recurring" | "one_shot" | "delay";

function toLocalIso(local: string): string | undefined {
  // datetime-local → ISO（含本地时区偏移，引擎按墙钟解析）
  if (!local) return undefined;
  const d = new Date(local);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

export function TaskCreateForm({
  recipient,
  recipientLabel,
  onCreated,
}: {
  /** recipient 泛化：agent（单聊面）| group（群/指挥室面，用户特权通道） */
  recipient: { kind: "agent" | "group"; id: string };
  /** 受众显示名（bot 名 / 群名——底部归属提示与占位文案用） */
  recipientLabel?: string;
  onCreated: () => Promise<void> | void;
}) {
  const agentId = recipient.kind === "agent" ? recipient.id : null;
  const groupName =
    recipient.kind === "group" ? (recipientLabel ?? recipient.id) : null;
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("recurring");
  const [prompt, setPrompt] = useState("");
  // cron 模式态
  const [advanced, setAdvanced] = useState(false);
  const [cronText, setCronText] = useState("0 9 * * *");
  const [times, setTimes] = useState<string[]>(["09:00"]); // HH:mm 列表
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5]); // dow 值
  // 延时模式态
  const [delayNum, setDelayNum] = useState(30);
  const [delayUnit, setDelayUnit] = useState<"m" | "h" | "d">("m");
  // 窗
  const [validFrom, setValidFrom] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  // 技能维度（默认不开启；开启后可多选，@注入指令强化遵循）
  const [skillsOn, setSkillsOn] = useState(false);
  const [allSkills, setAllSkills] = useState<
    Array<{ name: string; displayName?: string | null }>
  >([]);
  const [pickedSkills, setPickedSkills] = useState<string[]>([]);
  const [skillQuery, setSkillQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!agentId || !skillsOn || allSkills.length > 0) return;
    listAgentSkills(agentId)
      .then((r) => setAllSkills(r.skills ?? []))
      .catch(() => setAllSkills([]));
  }, [skillsOn, agentId, allSkills.length]);

  const filteredSkills = useMemo(() => {
    const q = skillQuery.trim().toLowerCase();
    const pool = allSkills.filter((s) => !pickedSkills.includes(s.name));
    if (!q) return pool.slice(0, 8);
    return pool
      .filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          (s.displayName ?? "").toLowerCase().includes(q),
      )
      .slice(0, 8);
  }, [allSkills, pickedSkills, skillQuery]);

  /** 由选择器态合成 cron；advanced 时直接用文本 */
  const composedCron = useMemo(() => {
    if (advanced) return cronText.trim();
    const dow = days.length === 7 ? "*" : [...days].sort().join(",");
    const hourMin = times
      .map((t) => {
        const [h, m] = t.split(":").map(Number);
        return { h: h ?? 0, m: m ?? 0 };
      })
      .sort((a, b) => a.h - b.h || a.m - b.m);
    if (hourMin.length === 0) return null;
    if (hourMin.length === 1) {
      return `${hourMin[0]!.m} ${hourMin[0]!.h} * * ${dow}`;
    }
    // 多时刻：同分钟多 hour → minute 单值+hour 列表；否则逗号列表（引擎多时刻列表仅支持同分钟多小时的清晰形态，异分钟拆多条由用户 Advanced 处理）
    const sameMinute = hourMin.every((x) => x.m === hourMin[0]!.m);
    if (!sameMinute || hourMin.length > 4) return null;
    return `${hourMin[0]!.m} ${hourMin.map((x) => x.h).join(",")} * * ${dow}`;
  }, [advanced, cronText, times, days]);

  const preview = useMemo(() => {
    if (mode === "delay") {
      const mins =
        delayNum * (delayUnit === "m" ? 1 : delayUnit === "h" ? 60 : 1440);
      return `${mins} 分钟后触发一次`;
    }
    if (composedCron == null) return "（时刻组合过复杂——切 Advanced 手写）";
    return (
      describeTaskSchedule({
        cron: composedCron,
        scheduleKind: mode === "one_shot" ? "one_shot" : "recurring",
      }) + (mode === "one_shot" ? "（仅触发一次）" : "")
    );
  }, [mode, composedCron, delayNum, delayUnit]);

  /** 提交用 prompt：用户指令 + 技能注入段（@技能强化遵循） */
  const finalPrompt = useMemo(() => {
    const base = prompt.trim();
    if (!skillsOn || pickedSkills.length === 0) return base;
    const refs = pickedSkills.map((s) => `/${s}`).join("、");
    return `${base}\n\n使用 SkillTool 运行技能 ${refs}，严格遵循技能流程执行。`;
  }, [prompt, skillsOn, pickedSkills]);

  const valid = useMemo(() => {
    if (!prompt.trim()) return false;
    if (mode === "delay") {
      const mins =
        delayNum * (delayUnit === "m" ? 1 : delayUnit === "h" ? 60 : 1440);
      return Number.isInteger(mins) && mins >= 1 && mins <= 525600;
    }
    if (composedCron == null) return false;
    if (advanced) return composedCron.split(/\s+/).length === 5;
    return true;
  }, [prompt, mode, composedCron, advanced, delayNum, delayUnit]);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const delayMinutes =
        mode === "delay"
          ? delayNum * (delayUnit === "m" ? 1 : delayUnit === "h" ? 60 : 1440)
          : undefined;
      const r = await createScheduledTask({
        prompt: finalPrompt,
        ...(recipient.kind === "agent"
          ? { agentId: recipient.id }
          : { groupId: recipient.id }),
        ...(mode === "delay"
          ? { delayMinutes }
          : {
              cron: composedCron ?? undefined,
              recurring: mode === "recurring",
              ...(validFrom ? { validFrom: toLocalIso(validFrom) } : {}),
              ...(expiresAt ? { expiresAt: toLocalIso(expiresAt) } : {}),
            }),
      });
      if (r.ok) {
        setOpen(false);
        setPrompt("");
        await onCreated();
      } else {
        setError(r.error ?? "创建失败");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <Button
        variant="outline"
        size="sm"
        className="h-7 gap-1 text-xs"
        onClick={() => setOpen(true)}
      >
        <Plus className="h-3 w-3" /> 新建任务
      </Button>
    );
  }

  return (
    <div className="rounded-lg border border-primary/30 bg-muted/20 p-3 space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-xs font-medium text-primary">新建定时任务</div>
        <button
          className="text-muted-foreground hover:text-foreground"
          onClick={() => setOpen(false)}
          title="收起"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* ① 模式 */}
      <div className="flex items-center gap-2">
        <span className="w-14 shrink-0 text-[11px] text-muted-foreground">
          模式
        </span>
        <div className="flex rounded-md border overflow-hidden text-xs">
          {(
            [
              ["recurring", "循环"],
              ["one_shot", "一次性"],
              ["delay", "延时"],
            ] as Array<[Mode, string]>
          ).map(([m, label]) => (
            <button
              key={m}
              type="button"
              className={
                "px-2.5 py-1 transition-colors " +
                (mode === m
                  ? "bg-primary text-primary-foreground"
                  : "bg-background hover:bg-muted")
              }
              onClick={() => setMode(m)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* ② 时间（仅 cron 模式） */}
      {mode !== "delay" && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <span className="w-14 shrink-0 text-[11px] text-muted-foreground">
              时间
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className={
                  "rounded-md border px-2 py-1 text-[11px] transition-colors " +
                  (!advanced
                    ? "border-primary/50 bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-muted")
                }
                onClick={() => setAdvanced(false)}
              >
                选择
              </button>
              <button
                type="button"
                className={
                  "rounded-md border px-2 py-1 text-[11px] transition-colors " +
                  (advanced
                    ? "border-primary/50 bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-muted")
                }
                onClick={() => setAdvanced(true)}
              >
                Advanced (cron)
              </button>
            </div>
          </div>
          {advanced ? (
            <input
              className="ml-16 w-56 rounded border bg-background px-2 py-1 font-mono text-xs"
              placeholder="5 字段 cron 表达式"
              value={cronText}
              onChange={(e) => setCronText(e.target.value)}
            />
          ) : (
            <div className="ml-16 space-y-1.5">
              <div className="flex flex-wrap items-center gap-1">
                {DAYS.map((d, i) => {
                  const dow = i === 6 ? 0 : i + 1;
                  const on = days.includes(dow);
                  return (
                    <button
                      key={d}
                      type="button"
                      className={
                        "h-6 rounded-md border px-2 text-[11px] transition-colors " +
                        (on
                          ? "border-primary/50 bg-primary/10 text-primary"
                          : "text-muted-foreground hover:bg-muted")
                      }
                      onClick={() =>
                        setDays((prev) =>
                          prev.includes(dow)
                            ? prev.filter((x) => x !== dow)
                            : [...prev, dow],
                        )
                      }
                    >
                      {d}
                    </button>
                  );
                })}
              </div>
              <div className="flex flex-wrap items-center gap-1">
                {times.map((t, idx) => (
                  <span key={idx} className="flex items-center gap-1">
                    <select
                      className="rounded border bg-background px-1.5 py-1 text-xs"
                      value={t}
                      onChange={(e) =>
                        setTimes((prev) =>
                          prev.map((x, i) => (i === idx ? e.target.value : x)),
                        )
                      }
                    >
                      {TIME_OPTIONS.map((o) => (
                        <option key={o.label} value={o.label}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                    {times.length > 1 && (
                      <button
                        className="text-muted-foreground hover:text-destructive"
                        onClick={() =>
                          setTimes((prev) => prev.filter((_, i) => i !== idx))
                        }
                        title="移除此时刻"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    )}
                  </span>
                ))}
                {times.length < 4 && (
                  <button
                    className="rounded-md border px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted"
                    onClick={() => setTimes((prev) => [...prev, "12:00"])}
                  >
                    + 时刻
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ②' 延时（仅 delay 模式） */}
      {mode === "delay" && (
        <div className="flex items-center gap-2">
          <span className="w-14 shrink-0 text-[11px] text-muted-foreground">
            延时
          </span>
          <input
            type="number"
            min={1}
            className="w-20 rounded border bg-background px-2 py-1 text-xs"
            value={delayNum}
            onChange={(e) => setDelayNum(Number(e.target.value) || 1)}
          />
          <div className="flex rounded-md border overflow-hidden text-xs">
            {(
              [
                ["m", "分钟"],
                ["h", "小时"],
                ["d", "天"],
              ] as Array<["m" | "h" | "d", string]>
            ).map(([u, label]) => (
              <button
                key={u}
                type="button"
                className={
                  "px-2 py-1 " +
                  (delayUnit === u
                    ? "bg-primary text-primary-foreground"
                    : "bg-background hover:bg-muted")
                }
                onClick={() => setDelayUnit(u)}
              >
                {label}
              </button>
            ))}
          </div>
          <span className="text-[10px] text-muted-foreground">后触发一次</span>
        </div>
      )}

      {/* ③ 起止窗（仅 cron 模式——R4/R6 契约） */}
      {mode !== "delay" && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="w-14 shrink-0 text-[11px] text-muted-foreground">
            起止窗
          </span>
          <input
            type="datetime-local"
            className="rounded border bg-background px-2 py-1 text-xs"
            value={validFrom}
            onChange={(e) => setValidFrom(e.target.value)}
          />
          <span className="text-[11px] text-muted-foreground">至</span>
          <input
            type="datetime-local"
            className="rounded border bg-background px-2 py-1 text-xs"
            value={expiresAt}
            onChange={(e) => setExpiresAt(e.target.value)}
          />
          <span className="text-[10px] text-muted-foreground">
            （可选；窗内才触发）
          </span>
        </div>
      )}

      {/* ④ 指令 + 预览 */}
      <div className="flex items-start gap-2">
        <span className="w-14 shrink-0 pt-1 text-[11px] text-muted-foreground">
          指令
        </span>
        <textarea
          className="min-h-16 flex-1 rounded border bg-background px-2 py-1 text-xs resize-none"
          placeholder={
            recipient.kind === "agent"
              ? "到点后让这个 bot 做什么？（如：汇总今天的会议纪要并发给我）"
              : `到点后向「${groupName ?? "群"}」发什么提醒？（如：每天早上向群内做晨会简报）`
          }
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
        />
      </div>
      {/* 技能维度（仅 agent 面——群任务无单一 agent 技能面；默认不开启；
          开启后多选 + @注入指令） */}
      {recipient.kind === "agent" && (
      <div className="flex items-start gap-2">
        <span className="w-14 shrink-0 pt-1 text-[11px] text-muted-foreground">
          技能
        </span>
        <div className="flex-1 space-y-1.5">
          <button
            type="button"
            className={
              "flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] transition-colors " +
              (skillsOn
                ? "border-primary/50 bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-muted")
            }
            onClick={() => setSkillsOn((v) => !v)}
          >
            <Sparkles className="h-3 w-3" />
            {skillsOn ? "已开启" : "附加技能（可选）"}
          </button>
          {skillsOn && (
            <div className="space-y-1.5">
              {pickedSkills.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {pickedSkills.map((s) => (
                    <span
                      key={s}
                      className="flex items-center gap-1 rounded-sm border border-primary/40 bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary"
                    >
                      /{s}
                      <button
                        className="hover:opacity-70"
                        onClick={() =>
                          setPickedSkills((prev) => prev.filter((x) => x !== s))
                        }
                        title="移除"
                      >
                        <X className="h-2.5 w-2.5" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <input
                className="w-64 rounded border bg-background px-2 py-1 text-xs"
                placeholder="搜索技能…（名称或显示名）"
                value={skillQuery}
                onChange={(e) => setSkillQuery(e.target.value)}
              />
              {filteredSkills.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {filteredSkills.map((s) => (
                    <button
                      key={s.name}
                      type="button"
                      className="rounded-sm border px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground"
                      title={s.name}
                      onClick={() =>
                        setPickedSkills((prev) => [...prev, s.name])
                      }
                    >
                      + {s.displayName ?? s.name}
                    </button>
                  ))}
                </div>
              )}
              {allSkills.length === 0 && (
                <div className="text-[10px] text-muted-foreground">
                  技能加载中/为空…
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      )}

      <div className="ml-16 text-[11px] text-muted-foreground">
        预览：<span className="text-foreground">{preview}</span>
        {mode !== "delay" && composedCron != null && !advanced && (
          <code className="ml-2 text-muted-foreground/60">{composedCron}</code>
        )}
        {mode !== "delay" && advanced && composedCron && (
          <span className="ml-2 text-muted-foreground/60">
            {describeCron(composedCron) === composedCron
              ? "（无法翻译——原样生效）"
              : ""}
          </span>
        )}
      </div>

      {error && (
        <div className="ml-16 text-[11px] text-destructive">{error}</div>
      )}
      {skillsOn && pickedSkills.length > 0 && (
        <div className="ml-16 rounded-md bg-muted/40 px-2 py-1.5 text-[10px] text-muted-foreground whitespace-pre-wrap">
          <span className="text-primary">@注入预览：</span>
          {`使用 SkillTool 运行技能 ${pickedSkills.map((s) => `/${s}`).join("、")}，严格遵循技能流程执行。`}
        </div>
      )}

      <div className="flex items-center justify-end gap-2">
        <span className="mr-auto text-[10px] text-muted-foreground">
          {recipient.kind === "agent"
            ? "以该成员身份触发（recipient 自动绑定）"
            : `到点向「${groupName ?? "群"}」全员轮转发提醒（用户特权通道）`}
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs"
          onClick={() => setOpen(false)}
        >
          取消
        </Button>
        <Button
          size="sm"
          className="h-7 text-xs"
          disabled={!valid || busy}
          onClick={() => void submit()}
        >
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : "创建"}
        </Button>
      </div>
    </div>
  );
}
