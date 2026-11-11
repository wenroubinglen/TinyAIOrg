"use client";

/**
 * 组织指挥室抽屉（团队抽屉同构形态）。
 * 布局与团队/成员抽屉同构：flex min-w-0 flex-1（自适应宽度）+ 头部
 * （成员头像横排+指挥室名+人数 | 齿轮编辑+关闭按钮组）+ 消息面满填。
 * 消息面=注入版 ChatRoomView（teamId=cmdroom_{orgId}——SSE teamId 匹配
 * 即时刷新；sendFn=room/send 专用端点；附件桶 owner=cmdroom 群 id）。
 * 编辑栏（组织改名/换管理者）由 page.tsx 指挥室分支渲染——与团队
 * TeamEditor 编辑栏同位同律，本组件只负责聊天列与编辑开闭回调。
 */
import { useCallback, useMemo } from "react";
import { ChatRoomView } from "@/components/chatroom-view";
import { AgentAvatar } from "@/components/agent/agent-avatar";
import { Button } from "@/components/ui/button";
import {
  getAgents,
  getOrgRoomView,
  getPybTeamMessages,
  sendOrgRoomMessage,
  type AgentConfig,
  type AttachmentRef,
  type ChatMessage,
} from "@/lib/api";
import { usePolling } from "@/lib/hooks";
import { Crown, X } from "lucide-react";

export function CmdRoomDrawer({
  orgId,
  orgName,
  editPanelOpen,
  rightPane,
  onOpenPane,
  onClose,
}: {
  orgId: string;
  orgName: string;
  editPanelOpen: boolean;
  /** 右栏当前段（与单聊/群抽屉同律三态分段） */
  rightPane: "edit" | "schedule";
  /** 段切换回调（含再点当前段=收起的三态语义） */
  onOpenPane: (pane: "edit" | "schedule") => void;
  onClose: () => void;
}) {
  const { data: agents } = usePolling<Record<string, AgentConfig>>(getAgents, 0);

  // 视图端点：成员册（含未建室预览）——轮询跟随 roster 变化
  const { data: roomView } = usePolling(
    useCallback(async () => {
      try {
        const r = await getOrgRoomView(orgId);
        return r.room;
      } catch {
        return null;
      }
    }, [orgId]),
    0,
    [orgId],
  );

  const groupId = `cmdroom_${orgId}`;

  const sendFn = useCallback(
    async (message: string, attachments?: AttachmentRef[]) =>
      sendOrgRoomMessage(orgId, message, attachments),
    [orgId],
  );

  const fetchMessagesFn = useCallback(async (_teamId: string, limit: number) => {
    const msgs = await getPybTeamMessages(groupId, limit);
    return msgs.filter(
      (m) =>
        (typeof m.message === "string" && m.message.length > 0) ||
        (m.attachments?.length ?? 0) > 0,
    );
  }, [groupId]);

  const roomName = roomView?.name ?? `${orgName}·指挥室`;
  const memberIds = roomView?.memberIds ?? [];
  const chairId = roomView?.chairAgentId ?? null;
  const display = useMemo(() => memberIds.slice(0, 8), [memberIds]);

  return (
    <div className="flex min-w-0 flex-1 flex-col h-full">
      {/* 头部：与团队抽屉同构（头像+名+人数 | 齿轮+关闭）；
          主题色渐变=chair（主席）avatarColor（呼应 Crown 徽标） */}
      <div
        className="flex items-center justify-between px-4 py-3 border-b"
        style={
          chairId && agents?.[chairId]?.avatar_color
            ? {
                background: `linear-gradient(160deg, ${agents[chairId].avatar_color}1F 0%, transparent 100%)`,
              }
            : undefined
        }
      >
        <div className="flex items-center gap-2 min-w-0">
          <div className="flex items-center gap-1 shrink-0" title="指挥室成员">
            {display.map((id) => (
              <span key={id} className="relative inline-flex" title={agents?.[id]?.name ?? id}>
                <AgentAvatar
                  agentId={id}
                  name={agents?.[id]?.name ?? id}
                  shape={agents?.[id]?.avatar_shape ?? null}
                  colorHex={agents?.[id]?.avatar_color ?? null}
                  size={20}
                />
                {id === chairId && (
                  <Crown
                    className="absolute -top-1.5 left-1/2 h-2.5 w-2.5 -translate-x-1/2 rotate-[20deg] text-yellow-500"
                    strokeWidth={2.5}
                  />
                )}
              </span>
            ))}
            {memberIds.length > 8 && (
              <span className="text-[10px] text-muted-foreground ml-0.5">
                +{memberIds.length - 8}
              </span>
            )}
          </div>
          <span className="truncate text-sm font-medium">{roomName}</span>
          <span className="text-[10px] text-muted-foreground shrink-0">
            {memberIds.length} 人
          </span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {/* 指挥室抽屉同律凹陷分段双钮（组织编辑/定时任务——指挥室
              级用户特权通道，与单聊/群抽屉三态语义同构）。
              视觉语言：10px 圆角凹槽式分段触发器 */}
          <div className="flex items-center rounded-[10px] border bg-muted p-0.5 text-xs">
            {(
              [
                ["edit", "组织编辑"],
                ["schedule", "定时任务"],
              ] as Array<["edit" | "schedule", string]>
            ).map(([pane, label]) => (
              <button
                key={pane}
                type="button"
                onClick={() => onOpenPane(pane)}
                className={
                  "rounded-[8px] px-2.5 py-1 transition-colors " +
                  (editPanelOpen && rightPane === pane
                    ? "bg-primary font-medium text-primary-foreground"
                    : "text-muted-foreground hover:text-primary")
                }
              >
                {label}
              </button>
            ))}
          </div>
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={onClose}>
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
      {/* 消息面：满填（与团队 ChatRoomView 同位） */}
      <div className="min-h-0 flex-1">
        <ChatRoomView
          teamId={groupId}
          teamName={roomName}
          sendFn={sendFn}
          fetchMessagesFn={
            fetchMessagesFn as (teamId: string, limit: number) => Promise<ChatMessage[]>
          }
          uploadOwner={groupId}
        />
      </div>
    </div>
  );
}
