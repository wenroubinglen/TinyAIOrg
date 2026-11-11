// cron 人话引擎（中文）。
// 算法骨架（模式归类：天数描述×时间描述合成），
// 引擎 cronToHuman 英文+弱覆盖+列表路径 relative 占位符裸输出——不消费，
// 前端自建。覆盖：每N分钟/每小时/每N小时/每天/星期单多/工作日/周末/
// 每月几号/年度日期/多时刻/区间窗口；不识别的复杂表达式回落裸 cron。

const DAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
const MONTHS = [
  "1月",
  "2月",
  "3月",
  "4月",
  "5月",
  "6月",
  "7月",
  "8月",
  "9月",
  "10月",
  "11月",
  "12月",
];

/** 解析单个 cron 字段为值集合；支持 * , - / 步进；非法返回 null */
function parseField(
  field: string,
  min: number,
  max: number,
): Set<number> | null {
  const values = new Set<number>();
  for (const part of field.split(",")) {
    const split = part.split("/");
    if (split.length > 2) return null;
    const rangePart = split[0] ?? "";
    const step = split.length === 2 ? Number(split[1]) : 1;
    if (!Number.isInteger(step) || step <= 0) return null;
    let start: number, end: number;
    if (rangePart === "*" || rangePart === "") {
      start = min;
      end = max;
    } else if (rangePart.includes("-")) {
      const pieces = rangePart.split("-");
      start = Number(pieces[0]);
      end = Number(pieces[1]);
    } else {
      start = Number(rangePart);
      end = split.length === 2 ? max : start;
    }
    if (
      !Number.isInteger(start) ||
      !Number.isInteger(end) ||
      start < min ||
      end > max ||
      start > end
    )
      return null;
    for (let v = start; v <= end; v += step) values.add(v);
  }
  return values.size > 0 ? values : null;
}

export interface CronMatcher {
  minute: Set<number>;
  hour: Set<number>;
  dayOfMonth: Set<number>;
  month: Set<number>;
  dayOfWeek: Set<number>;
  domRestricted: boolean;
  dowRestricted: boolean;
}

export function parseCron(expr: string): CronMatcher | null {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) return null;
  const [mi, hr, dom, mo, dow] = fields;
  const minute = parseField(mi ?? "", 0, 59);
  const hour = parseField(hr ?? "", 0, 23);
  const dayOfMonth = parseField(dom ?? "", 1, 31);
  const month = parseField(mo ?? "", 1, 12);
  const rawDow = parseField(dow ?? "", 0, 7);
  if (!minute || !hour || !dayOfMonth || !month || !rawDow) return null;
  return {
    minute,
    hour,
    dayOfMonth,
    month,
    dayOfWeek: new Set([...rawDow].map((d) => (d === 7 ? 0 : d))),
    domRestricted: dom !== "*",
    dowRestricted: dow !== "*",
  };
}

const ascending = (s: Set<number>) => [...s].sort((a, b) => a - b);
const eq = (a: Set<number>, b: Set<number>) =>
  a.size === b.size && [...a].every((v) => b.has(v));
/** 等差数列的公差（≥2 个元素才判）；否则 null */
const stride = (sorted: number[]): number | null => {
  if (sorted.length < 2) return null;
  const step = sorted[1]! - sorted[0]!;
  if (step <= 0) return null;
  for (let i = 2; i < sorted.length; i++) {
    if (sorted[i]! - sorted[i - 1]! !== step) return null;
  }
  return step;
};

function clock(hour: number, minute: number): string {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/** 天数部分 → {lead: 句首, on: 后缀}；null=无法人话（回落） */
function describeDays(
  m: CronMatcher,
): { lead: string; on: string | null } | null {
  const monthFull = m.month.size === 12;
  const dom = m.domRestricted && m.dayOfMonth.size < 31;
  const dow = m.dowRestricted && m.dayOfWeek.size < 7;
  if (dom && dow) return null; // 双限制组合太少见，回落
  if (dow) {
    if (!monthFull) return null;
    if (eq(m.dayOfWeek, new Set([1, 2, 3, 4, 5])))
      return { lead: "工作日", on: "（工作日）" };
    if (eq(m.dayOfWeek, new Set([0, 6])))
      return { lead: "周末", on: "（周末）" };
    const days = ascending(m.dayOfWeek);
    if (days.length > 3) {
      if (stride(days) !== 1) return null;
      return {
        lead: `${DAYS[days[0]!]!}至${DAYS[days[days.length - 1]!]!}`,
        on: null,
      };
    }
    const joined = days.map((d) => DAYS[d]!).join("、");
    return { lead: `每${joined}`, on: null };
  }
  if (dom) {
    const days = ascending(m.dayOfMonth);
    if (monthFull) {
      if (days.length > 3) return null;
      const ordinals = days.map((d) => `${d}日`).join("、");
      return { lead: `每月 ${ordinals}`, on: null };
    }
    if (m.month.size === 1 && days.length === 1) {
      const month = [...m.month][0]!;
      const day = days[0]!;
      return { lead: `每年 ${MONTHS[month - 1]!}${day}日`, on: null };
    }
    return null;
  }
  return monthFull ? { lead: "每天", on: null } : null;
}

/** 时间部分 → 固定时刻列表 | 周期描述；null=回落 */
function describeTime(
  m: CronMatcher,
):
  | { kind: "times"; times: string[] }
  | { kind: "interval"; text: string }
  | null {
  const minutes = ascending(m.minute);
  const hours = ascending(m.hour);
  const firstM = minutes[0] ?? 0;
  const firstH = hours[0] ?? 0;
  const lastH = hours[hours.length - 1] ?? 0;
  const fullHours = hours.length === 24;

  if (minutes.length === 1) {
    const suffix =
      firstM === 0 ? "" : ` 的 :${String(firstM).padStart(2, "0")}`;
    if (fullHours) return { kind: "interval", text: `每小时${suffix}` };
    if (hours.length === 1)
      return { kind: "times", times: [clock(firstH, firstM)] };
    const step = stride(hours);
    if (step != null) {
      if (firstH === 0 && lastH + step > 23)
        return { kind: "interval", text: `每 ${step} 小时${suffix}` };
      if (step === 1 || hours.length > 3) {
        return {
          kind: "interval",
          text: `每 ${step} 小时${suffix}（${clock(firstH, firstM)}–${clock(lastH, firstM)}）`,
        };
      }
    }
    return hours.length <= 3
      ? { kind: "times", times: hours.map((h) => clock(h, firstM)) }
      : null;
  }

  // 多分钟值：整点步进 = 每 N 分钟；单小时 = 多个时刻；否则每小时的 :mm 列表
  const step = minutes[0] === 0 ? stride(minutes) : null;
  const interval =
    step != null && minutes[minutes.length - 1]! + step > 59 ? step : null;
  if (interval != null) {
    const base = interval === 1 ? "每分钟" : `每 ${interval} 分钟`;
    if (fullHours) return { kind: "interval", text: base };
    if (hours.length === 1 || stride(hours) === 1) {
      const window =
        hours.length === 1
          ? ""
          : `（${clock(firstH, firstM)}–${clock(lastH, firstM)}）`;
      return { kind: "interval", text: `${base}${window}` };
    }
    return null;
  }
  if (minutes.length > 3) return null;
  if (!fullHours && hours.length === 1) {
    return { kind: "times", times: minutes.map((mi) => clock(firstH, mi)) };
  }
  if (fullHours) {
    return {
      kind: "interval",
      text: `每小时的 ${minutes.map((mi) => `:${String(mi).padStart(2, "0")}`).join("、")}`,
    };
  }
  return null;
}

/** cron 表达式 → 中文人话；无法归类时回落原表达式 */
export function describeCron(raw: string): string {
  const normalized = raw.trim();
  const m = parseCron(normalized);
  if (!m) return normalized;
  const days = describeDays(m);
  const time = describeTime(m);
  if (!days || !time) return normalized;
  if (time.kind === "times") {
    return `${days.lead} ${time.times.join("、")}`;
  }
  const on = days.on ? ` ${days.on}` : "";
  return `${time.text}${on}`
    .replace("每小时（工作日）", "工作日每小时")
    .replace("每小时（周末）", "周末每小时");
}

/**
 * relative 型任务识别（列表 API 无 scheduleSource 字段的启发式）：
 * one_shot + 占位符 `* * * * *` = 引擎 delayMinutes 相对任务
 * （真·每分钟 cron 必为 recurring，one_shot 每分钟无意义且创建期被
 * stale-triage 拦截，启发式安全）。
 */
export function isRelativeTask(task: {
  cron: string;
  scheduleKind?: string;
  recurring?: boolean;
}): boolean {
  const oneShot = task.scheduleKind
    ? task.scheduleKind === "one_shot"
    : task.recurring === false;
  return oneShot && task.cron.trim() === "* * * * *";
}

/** 统一入口：任务调度语义 → 中文（relative 优先于 cron 解析） */
export function describeTaskSchedule(task: {
  cron: string;
  scheduleKind?: string;
  recurring?: boolean;
}): string {
  if (isRelativeTask(task)) return "一次性（延时触发）";
  return describeCron(task.cron);
}
