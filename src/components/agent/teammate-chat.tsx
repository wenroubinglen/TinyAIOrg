"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { ChatContainerRoot, ChatContainerContent, ChatContainerScrollAnchor } from "@/components/ui/chat-container";
import { usePolling } from "@/lib/hooks";
import { CHAT_MESSAGE_EVENT, SSE_RECONNECTED_EVENT } from "@/lib/live-events";
import {
  getPybAgentMessages,
  sendPybAgentMessage,
  type ChatWindowContext,
  type PybMessageSpeaker,
  type AttachmentRef,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Loader2, ArrowUp, ArrowDown, Paperclip, Square } from "lucide-react";
import {
  PromptInput,
  PromptInputTextarea,
  PromptInputActions,
  PromptInputAction,
} from "@/components/ui/prompt-input";
import { cn } from "@/lib/utils";
import { Markdown } from "@/components/ui/markdown";
import {
  AttachmentCard,
  uploadDraftAttachments,
  pickFilesViaDialog,
  type DraftAttachment,
} from "@/components/attachment-card";
import { ModelConfigSelect } from "@/components/chat/model-config-select";

/**
 * 单 teammate 聊天窗（自 agents/[id] 页抽出复用——组织架构页
 * overlay 抽屉同源消费）：历史 = pyb/agent.messages（真相源 pyb 库）；
 * 发送 = /api/pyb-agents/:id/send（pyb/agent.send RPC 直达，一等用户身份
 * speaker:{kind:'user'} 引擎侧盖戳——用户消息不经 SendMessage 工具）；
 * 刷新 = 轮询（推送流单 session 守卫——轮询是设计形态）。
 * 附件输入（按钮/粘贴/拖拽，上限6）+卡片渲染+
 * 纯附件消息判据修正（content||attachments）。
 */
export function TeammateChat({
  agentId, agentName, chatContext,
}: {
  agentId: string;
  agentName: string;
  /** 聊天窗上下文（挂载点派生——画布抽屉传
   * {orgId[,teamId]}，独立页不传=全局窗）。透传引擎验算盖戳 chatFocus。 */
  chatContext?: ChatWindowContext;
}) {
  const { data, refresh } = usePolling<{ messages: Array<{ id?: string; role: string; content?: string; created_at?: number; speaker?: PybMessageSpeaker; attachments?: AttachmentRef[] }>; hasSession: boolean }>(
    // 零轮询：intervalMs 5000→0（挂载拉一次+保 refresh，无定时器）；
    // deps 必传防 fetcher 钉死首 agentId（抽屉常驻切成员）。
    () => getPybAgentMessages(agentId), 0,
    [agentId],
  );
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  // 草稿附件（上限6；图片带本地预览）。
  const [drafts, setDrafts] = useState<DraftAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 智能滚动+未读——与群聊同构：ChatContainerRoot
  // （内部 StickToBottom 组件，含 initial="instant" 与 Content 内容观测协议），
  // contextRef 拿 isAtBottom/scrollToBottom；count+lastTime 双元 diff 判新。
  const scrollCtxRef = useRef<{ isAtBottom: boolean; scrollToBottom: (o?: unknown) => void } | null>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const scrollToBottom = useCallback((opts?: unknown) => {
    scrollCtxRef.current?.scrollToBottom(opts);
  }, []);
  const [unreadCount, setUnreadCount] = useState(0);
  const lastSeen = useRef<{ count: number; lastTime: number } | null>(null);
  const wasAtBottom = useRef(true);

  const messages = (data?.messages ?? []).filter(
    (m) =>
      (m.role === "user" || m.role === "assistant") &&
      // 纯附件消息判据——空内容但有附件的行
      // 不再被吞（原 content.length>0 会静默丢弃）。
      ((typeof m.content === "string" && m.content.length > 0) ||
        (m.attachments?.length ?? 0) > 0),
  );

  // 乐观条目——发送成功即上屏（messageId 对账键），
  // 轮询数据出现同 id 行时自动隐藏（对账完成）。独立 state 不污染轮询 diff。
  const [optimistic, setOptimistic] = useState<Array<{ id: string; content: string; ts: number; attachments?: DraftAttachment[] }>>([]);
  const optimisticVisible = optimistic.filter(
    (o) => !messages.some((m) => m.id === o.id),
  );

  useEffect(() => {
    if (!data?.messages) return;
    const list = messages;
    const count = list.length;
    const lastTime = list[count - 1]?.created_at ?? 0;
    const prev = lastSeen.current;
    lastSeen.current = { count, lastTime };
    if (!prev) return; // 首载不计数
    const isNew = count > prev.count || lastTime > prev.lastTime;
    if (!isNew) return;
    if (wasAtBottom.current) return; // 贴底态：库自动跟随
    setUnreadCount((c) => c + (count - prev.count || 1));
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { wasAtBottom.current = isAtBottom; }, [isAtBottom]);
  useEffect(() => { if (isAtBottom) setUnreadCount(0); }, [isAtBottom]);
  // agentId 切换后首批数据布局就绪即贴底（多帧重试；
  // 经 contextRef 调库 scrollToBottom 同步内部状态）
  const firstDataForAgent = useRef<string | null>(null);
  useEffect(() => {
    if (!data?.messages || messages.length === 0) return;
    if (firstDataForAgent.current === agentId) return;
    firstDataForAgent.current = agentId;
    let frames = 0;
    let raf = 0;
    const tryScroll = () => {
      const ctx = scrollCtxRef.current;
      if (ctx) {
        scrollToBottom("instant");
        return;
      }
      if (++frames < 20) raf = requestAnimationFrame(tryScroll);
    };
    raf = requestAnimationFrame(tryScroll);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, agentId, messages.length]);

  // 唤醒 typing 气泡——发送成功记 sentAt，该
  // agent 无 created_at>sentAt 的消息时流末显三点；双兑底：3 分钟超时+点击取消
  const [typingSince, setTypingSince] = useState<number | null>(null);
  const TYPING_TIMEOUT_MS = 3 * 60 * 1000;
  const replyArrived = useCallback(() => {
    if (typingSince === null) return false;
    return messages.some(
      (m) => (m.created_at ?? 0) > typingSince && !(m.speaker?.kind === "user" || (!m.speaker && m.role === "user")),
    );
  }, [typingSince, messages]);
  useEffect(() => {
    if (typingSince !== null && replyArrived()) setTypingSince(null);
  }, [typingSince, replyArrived]);
  useEffect(() => {
    if (typingSince === null) return;
    const t = window.setTimeout(() => setTypingSince(null), Math.max(0, TYPING_TIMEOUT_MS - (Date.now() - typingSince)));
    return () => window.clearTimeout(t);
  }, [typingSince]);
  // 切会话重置（agentId 变化）+草稿清理（预览 objectURL revoke）
  useEffect(() => {
    setTypingSince(null); setUnreadCount(0); lastSeen.current = null; setOptimistic([]);
    for (const d of drafts) if (d.previewUrl) URL.revokeObjectURL(d.previewUrl);
    setDrafts([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId]);

  // SSE 事件驱动刷新——CHAT_MESSAGE_EVENT 路由匹配（单聊
  // toAgentId=当前 agent 或 agentId=当前 agent 的回复）即时 refresh；SSE_RECONNECTED
  // （含首连/断线重连）全量重拉补齐断线期内容（snapshot 语义）。
  useEffect(() => {
    const onChatMessage = (e: Event) => {
      const d = (e as CustomEvent<{ toAgentId?: string; agentId?: string }>).detail ?? {};
      if (d.toAgentId === agentId || d.agentId === agentId) {
        // 双拉：立即+400ms 补拉——事件可能在 DB 行落库前到达（user_notification
        // 随邮箱投递发射，dm 行写入有毫秒级滞后；零轮询后无重试机会）。
        void refresh();
        window.setTimeout(() => void refresh(), 400);
      }
    };
    const onReconnected = () => void refresh();
    window.addEventListener(CHAT_MESSAGE_EVENT, onChatMessage);
    window.addEventListener(SSE_RECONNECTED_EVENT, onReconnected);
    return () => {
      window.removeEventListener(CHAT_MESSAGE_EVENT, onChatMessage);
      window.removeEventListener(SSE_RECONNECTED_EVENT, onReconnected);
    };
  }, [agentId, refresh]);

  // 附件收集统一口（按钮/粘贴/拖拽共用）——
  // 上传逐项 fail-visible（失败项进 error 不静默）。
  const addFiles = useCallback(
    async (files: FileList | File[]) => {
      if (drafts.length >= 6) {
        setError("附件上限 6 个/条");
        return;
      }
      setUploading(true);
      setError("");
      try {
        const { drafts: added, errors } = await uploadDraftAttachments(
          agentId,
          files,
          drafts.length,
        );
        if (added.length > 0) setDrafts((prev) => [...prev, ...added]);
        if (errors.length > 0) setError(errors.join("; "));
      } finally {
        setUploading(false);
      }
    },
    [agentId, drafts.length],
  );

  const removeDraft = useCallback((idx: number) => {
    setDrafts((prev) => {
      const d = prev[idx];
      if (d?.previewUrl) URL.revokeObjectURL(d.previewUrl);
      return prev.filter((_, i) => i !== idx);
    });
  }, []);

  const send = useCallback(async () => {
    const message = input.trim();
    if ((!message && drafts.length === 0) || sending || uploading) return;
    const sentDrafts = drafts;
    const sentRefs = sentDrafts.map((d) => d.ref);
    setSending(true);
    setError("");
    try {
      const r = await sendPybAgentMessage(agentId, message, sentRefs.length > 0 ? sentRefs : undefined, chatContext);
      setInput("");
      // 用户发消息必看最新：强制贴底（Content 协议之上的双保险）
      scrollToBottom();
      // 乐观条目立即上屏（发送后 0s 可见；messageId 响应携带）；
      // 附件随乐观条目渲染本地预览（对账后由
      // 历史行附件接管——objectURL 移交乐观条目生命周期，revoke 顺延）。
      if (r.delivered && r.messageId) {
        setOptimistic((prev) => [...prev, { id: r.messageId!, content: message, ts: Date.now(), ...(sentDrafts.length > 0 ? { attachments: sentDrafts } : {}) }]);
        setDrafts([]);
      }
      // 送达状态如实呈现（delivered=false 经 reason 表达）
      if (!r.delivered) {
        setError(`未送达：${"reason" in r && typeof r.reason === "string" ? r.reason : "未知原因"}`);
        setDrafts(sentDrafts);
      }
      if (r.delivered) setTypingSince(Date.now());
      // 唤醒投递后稍等再刷（teammate 异步 turn）
      setTimeout(() => refresh(), 1500);
    } catch (err) {
      setError((err as Error).message);
      setDrafts(sentDrafts);
    } finally {
      setSending(false);
    }
  }, [input, sending, uploading, drafts, agentId, refresh]);

  return (
    <div
      className="flex flex-col h-full relative"
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
      <ChatContainerRoot
        className="flex-1"
        contextRef={(ctx) => {
          if (!ctx) return;
          scrollCtxRef.current = { isAtBottom: ctx.isAtBottom, scrollToBottom: ctx.scrollToBottom as (o?: unknown) => void };
          setIsAtBottom((prev) => (prev === ctx.isAtBottom ? prev : ctx.isAtBottom));
        }}
      >
        <ChatContainerContent className="space-y-3 px-6 pt-4 pb-28">
        {messages.length === 0 ? (
          <div className="text-sm text-muted-foreground text-center py-12">
            {data?.hasSession === false
              ? "这个队友还没有会话——发送第一条消息唤醒它"
              : "加载会话中..."}
          </div>
        ) : (
          messages.map((m, i) => {
            // speaker 权威判定用户气泡——speaker 缺席的
            // 旧行（main 代发时代）回退 role 兼容渲染。
            const isUser = m.speaker?.kind === "user" || (!m.speaker && m.role === "user");
            // 同作者连续聚合——作者键相同的前一条
            // 存在时本条隐藏名字（无时间阈值，按作者连续即聚合）
            const prev = messages[i - 1];
            const prevKey = prev
              ? prev.speaker?.kind === "user" || (!prev.speaker && prev.role === "user")
                ? "user"
                : `agent:${prev.speaker?.kind === "agent" ? prev.speaker.agentId : agentId}`
              : null;
            const curKey = isUser ? "user" : `agent:${m.speaker?.kind === "agent" ? m.speaker.agentId : agentId}`;
            const continued = prevKey === curKey;
            return (
            <div
              key={i}
              className={cn(
                // agent 气泡走 Markdown（自管换行），用户气泡保持
                // 纯文本 pre-wrap——用户自己打的字不该被解析。
                "max-w-[80%] rounded-lg px-4 py-2 text-sm",
                isUser
                  ? "ml-auto bg-[var(--chat-user-bubble)] text-[var(--chat-user-bubble-fg)] whitespace-pre-wrap"
                  : "bg-muted",
                continued && "mt-0.5",
              )}
            >
              {!isUser && !continued && (
                <p className="text-[10px] text-muted-foreground mb-1">{agentName}</p>
              )}
              {m.attachments?.length ? (
                <div className="flex flex-wrap gap-2 mb-1">
                  {m.attachments.map((a) => (
                    <AttachmentCard key={a.id} ownerId={agentId} attachment={a} />
                  ))}
                </div>
              ) : null}
              {isUser
                ? (m.content || "")
                : m.content
                  ? (
                    <Markdown className="prose prose-sm dark:prose-invert mt-0.5 max-w-none break-words text-foreground/90">
                      {m.content}
                    </Markdown>
                  )
                  : null}
            </div>
            );
          })
        )}
        {/* 乐观条目（发送即显；轮询拉到同 id 行自动隐藏） */}
        {optimisticVisible.map((o) => (
          <div
            key={o.id}
            className="max-w-[80%] rounded-lg px-4 py-2 text-sm whitespace-pre-wrap ml-auto bg-[var(--chat-user-bubble)] text-[var(--chat-user-bubble-fg)] opacity-70"
          >
            {o.attachments?.length ? (
              <div className="flex flex-wrap gap-2 mb-1">
                {o.attachments.map((d) => (
                  <AttachmentCard key={d.ref.id} ownerId={agentId} attachment={d.ref} previewUrl={d.previewUrl} />
                ))}
              </div>
            ) : null}
            {o.content}
          </div>
        ))}
        {/* typing 三点气泡（流末；点击取消——delivered 失真兜底） */}
        {typingSince !== null && !replyArrived() && (
          <button
            onClick={() => setTypingSince(null)}
            className="max-w-[80%] rounded-lg px-4 py-2 bg-muted text-left"
            title="等待回复中…（点击取消）"
          >
            <p className="text-[10px] text-muted-foreground mb-1">{agentName}</p>
            <span className="inline-flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground animate-pulse" />
              <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground animate-pulse [animation-delay:200ms]" />
              <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground animate-pulse [animation-delay:400ms]" />
            </span>
          </button>
        )}
        <ChatContainerScrollAnchor />
        </ChatContainerContent>
      </ChatContainerRoot>
      {error && (
        <div className="absolute bottom-24 left-6 right-6 z-20">
          <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-1.5 text-xs text-destructive">
            {error}
          </div>
        </div>
      )}
      {/* 回到底部按钮（非贴底态浮现） */}
      {messages.length > 0 && (unreadCount > 0 || !isAtBottom) && (
        <button
          onClick={() => { scrollToBottom(); setUnreadCount(0); }}
          className="absolute bottom-28 right-6 z-20 flex items-center gap-1.5 rounded-full border bg-card px-3 py-1.5 text-xs shadow-lg text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowDown className="h-3.5 w-3.5" />
          {unreadCount > 0 ? `${unreadCount} 条新消息` : "回到底部"}
        </button>
      )}
      {/* Floating composer（与群聊 chatroom-view 同款圆润 PromptInput） */}
      <div className="absolute bottom-4 left-6 right-6 z-10">
        {drafts.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-2">
            {drafts.map((d, idx) => (
              <AttachmentCard
                key={d.ref.id}
                ownerId={agentId}
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
          onSubmit={() => void send()}
          className="relative w-full shadow-lg"
        >
          <PromptInputTextarea
            placeholder={`给 ${agentName} 发送消息...`}
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
                disabled={(!input.trim() && drafts.length === 0) || sending || uploading}
                onClick={() => void send()}
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
