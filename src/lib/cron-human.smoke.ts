// 冒烟：直接以文本内联 cron-human.ts 的核心逻辑镜像验证会漂移，
// 故此文件改为对等断言表——describeCron 的行为契约快照。
// 真正执行：bun test 不引入，直接 node --experimental-strip-types 跑
// 本文件 import 源模块（ts 源直跑，bun/node22+ 均可）。
import {
  describeCron,
  isRelativeTask,
  describeTaskSchedule,
} from "./cron-human";

const CASES: Array<[string, string]> = [
  ["* * * * *", "每分钟"],
  ["*/5 * * * *", "每 5 分钟"],
  ["0 * * * *", "每小时"],
  ["30 * * * *", "每小时 的 :30"],
  ["0 */2 * * *", "每 2 小时"],
  ["0 9 * * *", "每天 09:00"],
  ["0 9,17 * * *", "每天 09:00、17:00"],
  ["30 8 * * 1-5", "工作日 08:30"],
  ["0 10 * * 1", "每周一 10:00"],
  ["0 10 * * 0,6", "周末 10:00"],
  ["0 9 * * 1,3,5", "每周一、周三、周五 09:00"],
  ["0 9 1 * *", "每月 1日 09:00"],
  ["0 0 15 * *", "每月 15日 00:00"],
  ["0 9 1 1 *", "每年 1月1日 09:00"],
  ["*/10 9-17 * * *", "每 10 分钟（09:00–17:00）"],
  // 回落：不认识的复杂表达式原样返回
  ["5,35 8,12,18 * * *", "5,35 8,12,18 * * *"],
  ["0 9 * * 1-5/2", "每周一、周三、周五 09:00"], // 步进范围=周一/三/五，正确翻译非回落
];

let pass = 0,
  fail = 0;
for (const [input, expected] of CASES) {
  const got = describeCron(input);
  if (got === expected) {
    pass++;
  } else {
    fail++;
    console.log(`FAIL: ${input} → got "${got}", want "${expected}"`);
  }
}
// relative 启发式
const rel = isRelativeTask({ cron: "* * * * *", scheduleKind: "one_shot" });
const recurring = isRelativeTask({
  cron: "* * * * *",
  scheduleKind: "recurring",
});
if (rel && !recurring) pass++;
else {
  fail++;
  console.log(`FAIL relative heuristic: rel=${rel} recurring=${recurring}`);
}
if (
  describeTaskSchedule({ cron: "* * * * *", scheduleKind: "one_shot" }) ===
  "一次性（延时触发）"
)
  pass++;
else {
  fail++;
  console.log("FAIL describeTaskSchedule relative");
}

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail > 0 ? 1 : 0);
