"use client";

/**
 * 形状×颜色参数化头像（AvatarEditor 借鉴）：
 * 共享渲染模块——身份卡、sidebar、teammate 列表、详情页顶栏统一消费。
 * 引擎 avatarShape 为自由字符串（agentProfileStore strField），枚举由 UI 侧定义；
 * 颜色盘存 hex（与 profile.avatarColor 持久化值同构）。
 * 兜底链：上传图（调用方自行处理）→ shape×color 参数化 → agentId 哈希色。
 */

export const SHAPES = ["circle", "rounded", "square", "hexagon"] as const;

export const PALETTE = [
  { id: "blue", hex: "#3b82f6" },
  { id: "emerald", hex: "#10b981" },
  { id: "purple", hex: "#a855f7" },
  { id: "orange", hex: "#f97316" },
  { id: "pink", hex: "#ec4899" },
  { id: "cyan", hex: "#06b6d4" },
  { id: "yellow", hex: "#eab308" },
  { id: "red", hex: "#ef4444" },
] as const;

export function hashIdx(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = ((hash << 5) - hash + id.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

export function fallbackColorHex(agentId: string): string {
  return PALETTE[hashIdx(agentId) % PALETTE.length].hex;
}

export function shapeStyle(shape: string | null | undefined): React.CSSProperties {
  switch (shape) {
    case "square":
      return { borderRadius: "12%" };
    case "rounded":
      return { borderRadius: "24%" };
    case "hexagon":
      return { clipPath: "polygon(25% 4%, 75% 4%, 100% 50%, 75% 96%, 25% 96%, 0% 50%)" };
    default:
      return { borderRadius: "50%" };
  }
}

export function AgentAvatar({
  agentId,
  name,
  shape,
  colorHex,
  size = 24,
  className,
}: {
  agentId: string;
  name: string;
  shape?: string | null;
  colorHex?: string | null;
  size?: number;
  className?: string;
}) {
  const hex = colorHex || fallbackColorHex(agentId);
  return (
    <div
      className={"flex items-center justify-center font-bold uppercase shrink-0 text-white " + (className ?? "")}
      style={{ ...shapeStyle(shape), backgroundColor: hex, width: size, height: size, fontSize: size / 2.8 }}
      title={name}
    >
      {(name || "?").slice(0, 2)}
    </div>
  );
}
