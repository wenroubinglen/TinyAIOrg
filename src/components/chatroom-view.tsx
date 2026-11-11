"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter, usePathname } from "next/navigation";
import { usePolling, timeAgo } from "@/lib/hooks";
import { CHAT_MESSAGE_EVENT, SSE_RECONNECTED_EVENT } from "@/lib/live-events";
import { ROSTER_DRAWER_OPEN_EVENT } from "@/components/sidebar";
import {
  getAgents, getTeams, getPybTeamMessages, sendPybTeamMessage,
  type ChatMessage, type AgentConfig, type TeamConfig, type AttachmentRef,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  ChatContainerRoot,
  ChatContainerContent,
  ChatContainerScrollAnchor,
} from "@/components/ui/chat-container";
import {
  PromptInput,
  PromptInputAction,
  PromptInputActions,
  PromptInputTextarea,
} from "@/components/ui/prompt-input";
import { Markdown } from "@/components/ui/markdown";
import { AgentAvatar } from "@/components/agent/agent-avatar";
import { ModelConfigSelect } from "@/components/chat/model-config-select";
import {
  AttachmentCard,
  uploadDraftAttachments,
  pickFilesViaDialog,
  type DraftAttachment,
} from "@/components/attachment-card";
import { Hash, ArrowUp, ArrowDown, Square, Paperclip, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

const AGENT_COLORS = [
  "bg-blue-500", "bg-emerald-500", "bg-purple-500", "bg-orange-500",
  "bg-pink-500", "bg-cyan-500", "bg-yellow-500", "bg-red-500",
];

function agentColor(agentId: string): string {
  let hash = 0;
  for (let i = 0; i < agentId.length; i++) {
    hash = ((hash << 5) - hash + agentId.charCodeAt(i)) | 0;
  }
  return AGENT_COLORS[Math.abs(hash) % AGENT_COLORS.length];
}

/** pyb 群聊 (pass) 弱化显示（与 pyb groupChat.ts 的 pass 识别正则同源）。 */
function isPassContent(text: string): boolean {
  return /^\(?\s*pass\s*\)?\.?$/i.test(text.trim());
}

export function ChatRoomView({
  teamId,
  teamName,
  sendFn,
  fetchMessagesFn,
  uploadOwner,
}: {
  teamId: string;
  teamName: string;
  /**
   * 可选注入——指挥室抽屉场景
   * 发送走 POST /api/pyb-orgs/:orgId/room/send（引擎前缀路由要求专用
   * 端点）。不传=现行为（/api/pyb-teams/:id/send）。响应形状
   * {delivered,messageId,reason,recorded} 乐观对账兼容。
   */
  sendFn?: (message: string, attachments?: AttachmentRef[]) => Promise<{
    delivered?: boolean;
    messageId?: string;
    reason?: string;
    recorded?: boolean;
  }>;
  /** 可选拉取注入——不传=现行为（/api/pyb-teams/:id/messages）。 */
  fetchMessagesFn?: (teamId: string, limit: number) => Promise<ChatMessage[]>;
  /** 可选附件桶 owner 覆写——不传=teamId（现行为）。 */
  uploadOwner?: string;
}) {
  const { data: agents } = usePolling<Record<string, AgentConfig>>(getAgents, 0);
  const { data: teams } = usePolling<Record<string, TeamConfig>>(getTeams, 0);
  const isCoupled = teams?.[teamId]?.kind === "pyb-coupled";
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  // 送达三态呈现——delivered/reason/recorded 内联提示（10s 自动消隐）
  const [sendStatus, setSendStatus] = useState<string | null>(null);
  useEffect(() => {
    if (!sendStatus) return;
    const t = window.setTimeout(() => setSendStatus(null), 10_000);
    return () => window.clearTimeout(t);
  }, [sendStatus]);
  // 草稿附件（上限6；图片本地预览）+拖拽态。
  const [drafts, setDrafts] = useState<DraftAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchMessages = useCallback(async (): Promise<ChatMessage[]> => {
    // teams 未就绪（挂载竞态）时短路——此前 isCoupled=false 走
    // 已退役旧端点 404，messages 定格空壳。teams 到位后 isCoupled 翻转，
    // deps 重建自动重拉。旧端点路径删除：daemon 面所有群史统一在 pyb 库
    //（getTeams 投影恒 kind=pyb-coupled，isCoupled 仅作就绪信号）。
    if (teams == null) return [];
    // 可选拉取注入（指挥室场景传 fetchMessagesFn——读链与发送链
    // 同源切换；不传走默认 team messages 端点）
    if (fetchMessagesFn) return fetchMessagesFn(teamId, 100);
    const msgs = await getPybTeamMessages(teamId, 100);
    return msgs
      // 严格投影：空内容行丢弃（服务端已滤 pass；此为前端兜底）——
      // 修正：纯附件消息（空内容有附件）不再被吞。
      .filter(
        (m) =>
          (typeof m.message === "string" && m.message.length > 0) ||
          (m.attachments?.length ?? 0) > 0,
      )
      .map((m, i) => ({
      // 保留引擎行 id（fo:*/ent:*——乐观条目对账键），
      // 旧行无 id 回退 index
      id: m.id ?? i + 1,
      team_id: m.team_id,
      from_agent: m.from_agent,
      // 引擎群史带 speaker 身份（user|agent 二分）
      speaker: (m as { speaker?: { kind?: string } }).speaker,
      // 附件引用透传。
      ...(m.attachments?.length ? { attachments: m.attachments } : {}),
      message: m.message,
      created_at: m.created_at,
    }));
  }, [teamId, teams, fetchMessagesFn]);

  const { data: polledMessages, refresh: refreshMessages } = usePolling<ChatMessage[]>(fetchMessages, 0, [teamId, teams]);
  // 群聊 intervalMs 2000→0；实时性由 SSE 事件驱动——
  // CHAT_MESSAGE_EVENT 路由匹配（teamId）即时 refresh；SSE_RECONNECTED
  //（含首连/断线重连）全量重拉补齐断线期内容（snapshot 语义）。
  useEffect(() => {
    const onChatMessage = (e: Event) => {
      const d = (e as CustomEvent<{ teamId?: string }>).detail ?? {};
      if (d.teamId === teamId) {
        // 根因修复：必须走 usePolling 的 refresh（写 state）——此前裸调
        // fetchMessages() 返回值被丢弃，数据拉到即蒸发，界面永不更新。
        // 双拉：立即+400ms 补拉（事件先于 DB 落库的竞态窗口）。
        void refreshMessages();
        window.setTimeout(() => void refreshMessages(), 400);
      }
    };
    const onReconnected = () => void refreshMessages();
    window.addEventListener(CHAT_MESSAGE_EVENT, onChatMessage);
    window.addEventListener(SSE_RECONNECTED_EVENT, onReconnected);
    return () => {
      window.removeEventListener(CHAT_MESSAGE_EVENT, onChatMessage);
      window.removeEventListener(SSE_RECONNECTED_EVENT, onReconnected);
    };
  }, [teamId, refreshMessages]);

  // 智能滚动+未读——count+lastTime 双元 diff
  //（消息无可用 id——单聊端点无 id 字段、群 am_* id 已被映射丢弃）。
  // isAtBottom 由 StickToBottom context 提供（ChatContainerRoot render-prop）。
  const [unreadCount, setUnreadCount] = useState(0);
  const [atBottom, setAtBottom] = useState(true);
  const lastSeen = useRef<{ count: number; lastTime: number } | null>(null);
  const scrollCtxRef = useRef<{ isAtBottom: boolean; scrollToBottom: () => void } | null>(null);

  useEffect(() => {
    if (!polledMessages) return;
    const count = polledMessages.length;
    const lastTime = polledMessages[count - 1]?.created_at ?? 0;
    const prev = lastSeen.current;
    lastSeen.current = { count, lastTime };
    if (!prev) return; // 首载不计数
    const isNew = count > prev.count || lastTime > prev.lastTime;
    if (!isNew) return;
    if (scrollCtxRef.current?.isAtBottom) return; // 贴底态：跟随，无需未读
    setUnreadCount((c) => c + (count - prev.count || 1));
  }, [polledMessages]);

  const jumpToBottom = useCallback(() => {
    scrollCtxRef.current?.scrollToBottom();
    setUnreadCount(0);
  }, []);

  // 群聊 typing——宽判定（任一新消息即撤）；
  // 双兑底：3 分钟超时+点击取消；切群重置
  const [typingSince, setTypingSince] = useState<number | null>(null);
  const TYPING_TIMEOUT_MS = 3 * 60 * 1000;
  useEffect(() => {
    if (typingSince !== null && polledMessages && polledMessages.length > 0) {
      const lastTime = polledMessages[polledMessages.length - 1]?.created_at ?? 0;
      if (lastTime > typingSince) setTypingSince(null);
    }
  }, [polledMessages, typingSince]);
  useEffect(() => {
    if (typingSince === null) return;
    const t = window.setTimeout(() => setTypingSince(null), Math.max(0, TYPING_TIMEOUT_MS - (Date.now() - typingSince)));
    return () => window.clearTimeout(t);
  }, [typingSince]);
  useEffect(() => {
    setTypingSince(null); setUnreadCount(0); lastSeen.current = null; setOptimistic([]);
    for (const d of drafts) if (d.previewUrl) URL.revokeObjectURL(d.previewUrl);
    setDrafts([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamId]);

  // 乐观条目——发送成功即上屏（messageId 对账键，
  // 群行 id=fo:fanoutId），轮询数据出现同 id 行时自动隐藏。
  const [optimistic, setOptimistic] = useState<Array<{ id: string; content: string; ts: number; attachments?: DraftAttachment[] }>>([]);
  const optimisticVisible = optimistic.filter(
    (o) => !messages.some((m) => m.id === o.id),
  );

  useEffect(() => {
    if (polledMessages) {
      setMessages(polledMessages);
    }
  }, [polledMessages]);

  // 附件收集统一口（按钮/粘贴/拖拽共用）。
  const addFiles = useCallback(
    async (files: FileList | File[]) => {
      if (drafts.length >= 6) {
        setSendStatus("附件上限 6 个/条");
        return;
      }
      setUploading(true);
      try {
        const { drafts: added, errors } = await uploadDraftAttachments(
          // 可选 owner 覆写（指挥室附件桶=cmdroom_xxx；不传=teamId 现行为）
          uploadOwner ?? teamId,
          files,
          drafts.length,
        );
        if (added.length > 0) setDrafts((prev) => [...prev, ...added]);
        if (errors.length > 0) setSendStatus(errors.join("; "));
      } finally {
        setUploading(false);
      }
    },
    [teamId, drafts.length],
  );

  const removeDraft = useCallback((idx: number) => {
    setDrafts((prev) => {
      const d = prev[idx];
      if (d?.previewUrl) URL.revokeObjectURL(d.previewUrl);
      return prev.filter((_, i) => i !== idx);
    });
  }, []);

  const handleSend = useCallback(async () => {
    if ((!input.trim() && drafts.length === 0) || sending || uploading) return;
    const sentDrafts = drafts;
    const sentRefs: AttachmentRef[] = sentDrafts.map((d) => d.ref);
    setSending(true);
    setSendStatus(null);
    try {
      // 所有群统一走 daemon 面 /api/pyb-teams/:id/send——旧 /api/chatroom
      // 路由在 daemon 面不存在（已退役；kind 投影恒 coupled 无分支意义）
      // 可选发送注入（指挥室走 room/send；不传=默认 team send）
      const r = sendFn
        ? await sendFn(input.trim(), sentRefs.length > 0 ? sentRefs : undefined)
        : await sendPybTeamMessage(teamId, input.trim(), sentRefs.length > 0 ? sentRefs : undefined);
      // 乐观条目立即上屏（群行 id=fo:fanoutId 由响应携带）；
      // 附件随乐观条目渲染本地预览。
      if (r.delivered && r.messageId) {
        setOptimistic((prev) => [...prev, { id: r.messageId!, content: input.trim(), ts: Date.now(), ...(sentDrafts.length > 0 ? { attachments: sentDrafts } : {}) }]);
      }
      if (r.delivered) setTypingSince(Date.now());
      // 送达三态如实呈现——delivered=false 时展示 reason（A12 恒 200，
      // 失败语义经 reason 表达；recorded=false 单独提示未落库）
      if (!r.delivered) {
        const reason = r.reason ?? "未送达";
        setSendStatus(r.recorded === false ? `发送失败：${reason}（消息未落库）` : `未送达：${reason}`);
        setDrafts(sentDrafts);
      } else {
        setInput("");
        setDrafts((prev) => prev.filter((d) => !sentDrafts.includes(d)));
      }
    } catch (err) {
      // 网络/HTTP 异常（非 A12 语义面）如实展示
      setSendStatus(`发送出错：${err instanceof Error ? err.message : String(err)}`);
      setDrafts(sentDrafts);
    } finally {
      setSending(false);
    }
  }, [input, teamId, sending, uploading, drafts, sendFn]);

  const channelName = teamName.toLowerCase().replace(/\s+/g, "-");
  const router = useRouter();
  const pathname = usePathname();
  // 点成员头像/名称 → 打开该成员单聊抽屉（与画布点节点同效果）。
  // 双场景：画布内嵌群聊（画布已挂载，sessionStorage 意图只在挂载时消费一次
  // 不会触发）→ 直接派发 ROSTER_DRAWER_OPEN_EVENT 实时开抽屉；
  // 独立群聊页（/team/:id）→ 写 sessionStorage 意图 + 跳回画布，挂载时消费。
  const openMemberDrawer = useCallback((agentId: string) => {
    if (pathname?.startsWith("/company")) {
      window.dispatchEvent(
        new CustomEvent(ROSTER_DRAWER_OPEN_EVENT, { detail: { kind: "agent", id: agentId } }),
      );
      return;
    }
    try {
      window.sessionStorage.setItem("pyb-desktop_open_drawer", JSON.stringify({ kind: "agent", id: agentId }));
    } catch { /* 静默 */ }
    router.push("/company");
  }, [router, pathname]);

  return (
    <div
      className="flex h-full flex-col relative"
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        if (e.dataTransfer.files.length > 0) void addFiles(e.dataTransfer.files);
      }}
    >
      {dragOver && (
        <div
          className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center bg-background/80 border-2 border-dashed rounded-lg text-sm text-muted-foreground"
        >
          松开以添加附件
        </div>
      )}
      {/* Messages */}
      {messages.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center">
          <Hash className="h-8 w-8 text-muted-foreground/30 mb-3" />
          <p className="text-sm text-muted-foreground">
            #{channelName} 暂无消息
          </p>
          <p className="text-xs text-muted-foreground/60 mt-1">
            Agent 对话将显示在这里
          </p>
        </div>
      ) : (
        <ChatContainerRoot
          className="flex-1"
          contextRef={(ctx: { isAtBottom: boolean; scrollToBottom: () => void } | null) => {
            // 每次渲染刷新 ref（isAtBottom 变化时按钮显隐由 atBottom state 驱动）
            if (!ctx) return;
            scrollCtxRef.current = ctx;
            const nowBottom = ctx.isAtBottom;
            setAtBottom((prev) => (prev === nowBottom ? prev : nowBottom));
          }}
        >
          <ChatContainerContent className="space-y-3 px-6 pt-4 pb-28">
            {messages.map((msg, i) => {
              const agent = agents?.[msg.from_agent];
              const displayName = agent?.name || msg.from_agent;
              const initials = displayName.slice(0, 2).toUpperCase();
              // speaker 权威判用户；旧行无
              // speaker 回退 from_agent==='user'（聚合层映射兼容）。
              const isUser =
                msg.speaker?.kind === "user" || msg.from_agent === "user";
              // 同作者连续聚合——作者键相同的前一条
              // 存在时本条隐藏头像/名字/时间（无时间阈值）
              const authorKey = (m: ChatMessage) =>
                m.speaker?.kind === "user" || m.from_agent === "user"
                  ? "user"
                  : m.from_agent;
              const continued = i > 0 && authorKey(messages[i - 1]) === authorKey(msg);

              return (
                <div key={msg.id} className={cn("flex items-start gap-3", continued && "mt-0.5")}>
                  {isUser ? (
                    continued ? null : (
                      <div className="flex h-8 w-8 items-center justify-center text-[10px] font-bold uppercase shrink-0 bg-primary text-primary-foreground">
                        你
                      </div>
                    )
                  ) : continued ? (
                    <span className="w-8 shrink-0" />
                  ) : (
                    <button
                      onClick={() => openMemberDrawer(msg.from_agent)}
                      className="shrink-0 rounded-full transition-opacity hover:opacity-75"
                      title={`打开与 ${displayName} 的单聊`}
                    >
                      <AgentAvatar
                        agentId={msg.from_agent}
                        name={displayName}
                        shape={agent?.avatar_shape}
                        colorHex={agent?.avatar_color}
                        size={32}
                      />
                    </button>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2">
                      {!continued && (
                        <>
                          <span className="text-sm font-semibold">
                            {isUser ? "你" : (
                              <button
                                onClick={() => openMemberDrawer(msg.from_agent)}
                                className="transition-colors hover:text-primary"
                                title={`打开与 ${displayName} 的单聊`}
                              >
                                {displayName}
                              </button>
                            )}
                          </span>
                          {!isUser && agent?.kind === "pyb-coupled" && (
                            <span className="text-[9px] px-1 rounded bg-secondary text-secondary-foreground">pyb</span>
                          )}
                          <span className="text-[10px] text-muted-foreground">
                            {timeAgo(msg.created_at)}
                          </span>
                        </>
                      )}
                    </div>
                    {msg.attachments?.length ? (
                      <div className="flex flex-wrap gap-2 mt-0.5">
                        {msg.attachments.map((a) => (
                          <AttachmentCard key={a.id} ownerId={uploadOwner ?? teamId} attachment={a} />
                        ))}
                      </div>
                    ) : null}
                    {!isUser && isPassContent(msg.message) ? (
                      // pyb 群轮转 pass 回合——弱化显示，不占视觉重量
                      <p className="text-xs italic text-muted-foreground/60 mt-0.5">
                        （{displayName} 已跳过）
                      </p>
                    ) : msg.message ? (
                      <Markdown className="prose prose-sm dark:prose-invert mt-0.5 max-w-none break-words text-foreground/90">
                        {msg.message}
                      </Markdown>
                    ) : null}
                  </div>
                </div>
              );
            })}
            <ChatContainerScrollAnchor />
            {/* 乐观条目（发送即显；轮询拉到同 id 行自动隐藏） */}
            {optimisticVisible.map((o) => (
              <div key={o.id} className="flex items-start gap-3">
                <div className="flex h-8 w-8 items-center justify-center text-[10px] font-bold uppercase shrink-0 bg-primary text-primary-foreground opacity-70">
                  你
                </div>
                <div className="flex-1 min-w-0">
                  {o.attachments?.length ? (
                    <div className="flex flex-wrap gap-2 mt-0.5">
                      {o.attachments.map((d) => (
                        <AttachmentCard key={d.ref.id} ownerId={uploadOwner ?? teamId} attachment={d.ref} previewUrl={d.previewUrl} />
                      ))}
                    </div>
                  ) : null}
                  {o.content ? (
                    <Markdown className="prose prose-sm dark:prose-invert mt-0.5 max-w-none break-words text-foreground/70 opacity-80">
                      {o.content}
                    </Markdown>
                  ) : null}
                </div>
              </div>
            ))}
            {/* 群聊 typing 三点（任一成员回复即撤；点击取消） */}
            {typingSince !== null && (
              <button
                onClick={() => setTypingSince(null)}
                className="flex items-start gap-3 pt-1"
                title="队友回复中…（点击取消）"
              >
                <span className="w-8 shrink-0" />
                <span className="inline-flex items-center gap-1 rounded-lg bg-muted px-4 py-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground animate-pulse" />
                  <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground animate-pulse [animation-delay:200ms]" />
                  <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground animate-pulse [animation-delay:400ms]" />
                </span>
              </button>
            )}
          </ChatContainerContent>
        </ChatContainerRoot>
      )}

      {/* 回到底部按钮（非贴底态浮现；点击 scrollToBottom+清未读） */}
      {messages.length > 0 && (unreadCount > 0 || !atBottom) && (
        <button
          onClick={jumpToBottom}
          className="absolute bottom-28 right-6 z-20 flex items-center gap-1.5 rounded-full border bg-card px-3 py-1.5 text-xs shadow-lg text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowDown className="h-3.5 w-3.5" />
          {unreadCount > 0 ? `${unreadCount} 条新消息` : "回到底部"}
        </button>
      )}

      {/* 送达状态内联提示（输入框上方，10s 消隐） */}
      {sendStatus && (
        <div className="absolute bottom-24 left-6 right-6 z-20">
          <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-1.5 text-xs text-destructive">
            {sendStatus}
          </div>
        </div>
      )}

      {/* Floating composer */}
      <div className="absolute bottom-4 left-6 right-6 z-10">
        {drafts.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-2">
            {drafts.map((d, idx) => (
              <AttachmentCard
                key={d.ref.id}
                ownerId={uploadOwner ?? teamId}
                attachment={d.ref}
                previewUrl={d.previewUrl}
                onRemove={() => removeDraft(idx)}
              />
            ))}
          </div>
        )}
        {/* Electron/Chromium 怪癖：display:none 的 file input 选完文件后
            change 事件不派发（真机坐实 2026-10-29）——用视觉隐藏替代 hidden。 */}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="absolute h-px w-px overflow-hidden opacity-0"
          onChange={(e) => {
            if (e.target.files?.length) void addFiles(e.target.files);
            e.target.value = "";
          }}
        />
        <PromptInput
          value={input}
          onValueChange={setInput}
          isLoading={sending}
          onSubmit={handleSend}
          className="relative w-full shadow-lg"
        >
          <PromptInputTextarea
            placeholder={`给 #${channelName} 发送消息...`}
            className="min-h-[70px]"
            onPaste={(e: React.ClipboardEvent<HTMLTextAreaElement>) => {
              if (e.clipboardData.files.length > 0) {
                e.preventDefault();
                void addFiles(e.clipboardData.files);
              }
            }}
          />
          <PromptInputActions className="absolute bottom-2 right-2">
            {/* 聊天侧模型选择器（两级菜单+badge 双态） */}
            <PromptInputAction tooltip="切换模型">
              <ModelConfigSelect />
            </PromptInputAction>
            <PromptInputAction tooltip={uploading ? "上传中..." : "添加附件（最多 6 个）"}>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 rounded-full"
                disabled={uploading || drafts.length >= 6}
                onClick={async () => {
                  // 桌面端走原生对话框桥（DOM input change 在 Electron 失焦
                  // 态不派发）；浏览器回退隐藏 input。
                  const files = await pickFilesViaDialog(() =>
                    fileInputRef.current?.click(),
                  );
                  if (files.length > 0) void addFiles(files);
                }}
              >
                {uploading ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Paperclip className="size-4" />
                )}
              </Button>
            </PromptInputAction>
            <PromptInputAction
              tooltip={sending ? "发送中..." : "发送消息"}
            >
              <Button
                variant="default"
                size="icon"
                className="h-8 w-8 rounded-full"
                disabled={(!input.trim() && drafts.length === 0) || sending}
                onClick={handleSend}
              >
                {sending ? (
                  <Square className="size-5 fill-current" />
                ) : (
                  <ArrowUp className="size-5" />
                )}
              </Button>
            </PromptInputAction>
          </PromptInputActions>
        </PromptInput>
      </div>
    </div>
  );
}
