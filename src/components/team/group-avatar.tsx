"use client";

/**
 * 群叠加头像（GroupAvatar 同构移植，
 * 纯参数化——格子不 fetch 上传图）：
 * 1 人 100% / 2 人对角 2/3 / 3 人品字 5/9 / 4+ 四宫格 5/9（超 4 显前 3
 * + 右下 +N 徽标）；槽位 absolute + overflow hidden 几何裁剪咬合。
 * 每格复用 AgentAvatar（显式 shape/color 优先、id 哈希兜底）——头像即
 * 成员册快照。成员册 Set 去重后入格（脏数据教训）。
 */

import { AgentAvatar } from "@/components/agent/agent-avatar";
import type { AgentConfig } from "@/lib/api";

function groupSlots(count: number, frame: number): Array<{ x: number; y: number; size: number }> {
  if (count <= 1) return [{ x: 0, y: 0, size: frame }];
  if (count === 2) { const size = frame * 2 / 3; return [{ x: 0, y: 0, size }, { x: frame - size, y: frame - size, size }]; }
  const size = frame * 5 / 9, offset = frame - size;
  return count === 3
    ? [{ x: offset / 2, y: 0, size }, { x: 0, y: offset, size }, { x: offset, y: offset, size }]
    : [{ x: 0, y: 0, size }, { x: offset, y: 0, size }, { x: 0, y: offset, size }, { x: offset, y: offset, size }];
}

export function GroupAvatar({
  memberIds,
  agents,
  size = 28,
  title,
}: {
  memberIds: readonly string[];
  agents: Record<string, AgentConfig> | undefined | null;
  size?: number;
  title?: string;
}) {
  const participants = [...new Set(memberIds)];
  const visible = participants.slice(0, participants.length > 4 ? 3 : 4);
  const slots = groupSlots(Math.min(visible.length + (participants.length > 4 ? 1 : 0), 4), size);
  return (
    <span
      aria-hidden="true"
      className="relative inline-block shrink-0 rounded"
      style={{ width: size, height: size }}
      title={title}
    >
      {visible.slice(0, slots.length).map((memberId, index) => {
        const agent = agents?.[memberId];
        const slot = slots[index];
        return (
          <span
            key={memberId}
            className="absolute overflow-hidden"
            style={{ left: slot.x, top: slot.y, width: slot.size, height: slot.size }}
          >
            <AgentAvatar
              agentId={agent?.agent_id ?? memberId}
              name={agent?.name ?? memberId}
              shape={agent?.avatar_shape ?? null}
              colorHex={agent?.avatar_color ?? null}
              size={slot.size}
            />
          </span>
        );
      })}
      {participants.length > 4 ? (
        <span
          className="absolute bottom-0 right-0 grid place-items-center rounded-full border bg-card text-foreground"
          style={{ minWidth: size / 2.2, minHeight: size / 2.2, fontSize: Math.max(8, size / 3.4), lineHeight: 1, padding: "0 2px" }}
        >
          +{participants.length - 3}
        </span>
      ) : null}
    </span>
  );
}
