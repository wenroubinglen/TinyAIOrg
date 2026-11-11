import { redirect } from "next/navigation";

/**
 * 画布化改造：设置已改为画布之上的模态层（sidebar 浮层入口，不走路由）。
 * 本路由仅作兜底——直接输 URL / 老链接进来时送回画布，不再渲染整页设置。
 */
export default function SettingsPage() {
  redirect("/company");
}
