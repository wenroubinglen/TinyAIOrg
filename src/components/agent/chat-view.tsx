"use client";

import { useState, useEffect, useCallback } from "react";
import { usePolling, timeAgo } from "@/lib/hooks";
import {
  getAgentMessages,
  sendMessage,
  getAgents,
  type AgentMessage,
  type AgentConfig,
  type DaemonHealthState,
} from "@/lib/api";
import { useConnectionPhase } from "@/lib/connection-phase";
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
import { Bot, ArrowUp, Square } from "lucide-react";
import { cn } from "@/lib/utils";

const MESSAGE_WINDOW = 300;
const HISTORY_LIMIT = 200;
const POLL_INTERVAL_MS = 2_000;

interface AgentChatItem {
  id: string;
  role: "user" | "assistant";
  content: string;
  created_at: number;
  sender?: string;
  message_id?: string;
}

// Map the global connection phase back to the legacy three-state health enum.
const PHASE_TO_HEALTH: Record<string, DaemonHealthState> = {
  ready: "hosted",
  unreachable: "dead",
};

const HEALTH_BADGES: Record<DaemonHealthState, { label: string; dot: string }> = {
  hosted: { label: "已连接", dot: "bg-primary animate-pulse-dot" },
  degraded: { label: "引擎恢复中…", dot: "bg-yellow-500 animate-pulse" },
  dead: { label: "Daemon 未运行", dot: "bg-destructive" },
};

// Stable per-agent avatar tint derived from the id string.
const AVATAR_COLORS = [
  "bg-blue-500", "bg-emerald-500", "bg-purple-500", "bg-orange-500",
  "bg-pink-500", "bg-cyan-500", "bg-yellow-500", "bg-red-500",
];

function avatarColor(agentId: string): string {
  let hash = 0;
  for (const ch of agentId) {
    hash = ((hash << 5) - hash + ch.charCodeAt(0)) | 0;
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

// Remove the routing mention (either "@id " or "@id\n") from a queued user message.
function stripMentionPrefix(text: string, agentId: string): string {
  const withSpace = `@${agentId} `;
  const withNewline = `@${agentId}\n`;
  if (text.startsWith(withSpace)) return text.slice(withSpace.length);
  if (text.startsWith(withNewline)) return text.slice(withNewline.length);
  return text;
}

function toChatItem(message: AgentMessage, agentId: string): AgentChatItem {
  return {
    id: `db-${message.id}`,
    role: message.role,
    content:
      message.role === "user"
        ? stripMentionPrefix(message.content, agentId)
        : message.content,
    created_at: message.created_at,
    sender: message.sender,
    message_id: message.message_id,
  };
}

// Merge freshly polled DB rows with optimistic local rows: keep a local row
// when its message_id already appears in the poll, or when an identical
// role:content pair exists (dedupe). Then order by timestamp and cap the window.
function mergeMessages(
  prev: AgentChatItem[],
  incoming: AgentChatItem[]
): AgentChatItem[] {
  const polledIds = new Set(
    incoming.map((m) => m.message_id).filter((v): v is string => Boolean(v))
  );
  const polledKeys = new Set(incoming.map((m) => `${m.role}:${m.content}`));
  const merged = [...incoming];
  for (const m of prev) {
    const keptById = m.message_id && polledIds.has(m.message_id);
    const keptByContent = polledKeys.has(`${m.role}:${m.content}`);
    if (!keptById && !keptByContent) merged.push(m);
  }
  merged.sort((a, b) =>
    a.created_at !== b.created_at
      ? a.created_at - b.created_at
      : a.id.localeCompare(b.id)
  );
  return merged.length > MESSAGE_WINDOW ? merged.slice(-MESSAGE_WINDOW) : merged;
}

function MessageBubble({
  item,
  agentId,
  agentName,
}: {
  item: AgentChatItem;
  agentId: string;
  agentName: string;
}) {
  const isUser = item.role === "user";
  const label = isUser ? "你" : agentName;
  const initials = label.slice(0, 2).toUpperCase();
  return (
    <div className="flex items-start gap-3">
      <div
        className={cn(
          "flex h-8 w-8 items-center justify-center text-[10px] font-bold uppercase shrink-0",
          isUser ? "bg-primary text-primary-foreground" : `${avatarColor(agentId)} text-white`
        )}
      >
        {isUser ? "你" : initials}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-semibold">{label}</span>
          <span className="text-[10px] text-muted-foreground">
            {timeAgo(item.created_at)}
          </span>
        </div>
        <Markdown className="prose prose-sm dark:prose-invert mt-0.5 max-w-none break-words text-foreground/90">
          {item.content}
        </Markdown>
      </div>
    </div>
  );
}

// Three-dot typing placeholder shown while a coupled agent's teammate turn runs.
function AwaitingReplyRow({ agentId, agentName }: { agentId: string; agentName: string }) {
  return (
    <div className="flex items-start gap-3">
      <div
        className={cn(
          "flex h-8 w-8 items-center justify-center text-[10px] font-bold uppercase shrink-0 text-white",
          avatarColor(agentId)
        )}
      >
        {agentName.slice(0, 2).toUpperCase()}
      </div>
      <div className="flex items-center gap-1.5 pt-2.5">
        <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/50 animate-pulse-dot" />
        <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/50 animate-pulse-dot [animation-delay:150ms]" />
        <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/50 animate-pulse-dot [animation-delay:300ms]" />
      </div>
    </div>
  );
}

export function AgentChatView({
  agentId,
  agentName,
}: {
  agentId: string;
  agentName: string;
}) {
  const [messages, setMessages] = useState<AgentChatItem[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);

  const { data: agentsMap } = usePolling<Record<string, AgentConfig>>(getAgents, 0);
  const isCoupled = agentsMap?.[agentId]?.kind === "pyb-coupled";
  const lastIsUser = messages.length > 0 && messages[messages.length - 1].role === "user";
  const awaitingReply = Boolean(isCoupled) && !sending && lastIsUser;

  const fetchHistory = useCallback(
    () => getAgentMessages(agentId, HISTORY_LIMIT, 0),
    [agentId]
  );
  const { data: polledMessages } = usePolling<AgentMessage[]>(fetchHistory, POLL_INTERVAL_MS, [agentId]);

  const connectionPhase = useConnectionPhase();
  const daemonHealth = PHASE_TO_HEALTH[connectionPhase] ?? "degraded";
  const { label: healthLabel, dot: healthDot } = HEALTH_BADGES[daemonHealth];

  useEffect(() => {
    if (!polledMessages) return;
    const incoming = polledMessages.map((row) => toChatItem(row, agentId));
    setMessages((prev) => mergeMessages(prev, incoming));
  }, [polledMessages, agentId]);

  const handleSend = useCallback(async () => {
    const outbound = input.trim();
    if (!outbound || sending) return;

    const pendingId = `local-${Date.now()}`;
    setSending(true);
    setMessages((prev) => [
      ...prev,
      {
        id: pendingId,
        role: "user",
        content: outbound,
        created_at: Date.now(),
        sender: "你",
      },
    ]);

    try {
      // Send directly to the daemon per-agent endpoint; no @mention prefix needed.
      const result = await sendMessage({
        message: outbound,
        agent: agentId,
        sender: "Web",
        channel: "web",
      });
      setMessages((prev) =>
        prev.map((m) =>
          m.id === pendingId ? { ...m, message_id: result.messageId } : m
        )
      );
      setInput("");
    } catch {
      // swallow send failures for now
    } finally {
      setSending(false);
    }
  }, [input, sending, agentId]);

  const composerButton = sending ? (
    <Square className="size-5 fill-current" />
  ) : (
    <ArrowUp className="size-5" />
  );

  return (
    <div className="flex h-full flex-col relative">
      {/* connection status chip */}
      <div className="absolute top-3 right-4 z-10 flex items-center gap-1.5">
        <div className={cn("h-1.5 w-1.5", healthDot)} />
        <span className="text-[10px] text-muted-foreground">{healthLabel}</span>
      </div>

      {messages.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center">
          <Bot className="h-8 w-8 text-muted-foreground/30 mb-3" />
          <p className="text-sm text-muted-foreground">给 {agentName} 发送消息开始对话</p>
        </div>
      ) : (
        <ChatContainerRoot className="flex-1">
          <ChatContainerContent className="space-y-3 px-6 pt-4 pb-28">
            {messages.map((msg) => (
              <MessageBubble key={msg.id} item={msg} agentId={agentId} agentName={agentName} />
            ))}
            {awaitingReply && <AwaitingReplyRow agentId={agentId} agentName={agentName} />}
            <ChatContainerScrollAnchor />
          </ChatContainerContent>
        </ChatContainerRoot>
      )}

      {/* composer pinned above the list */}
      <div className="absolute bottom-4 left-6 right-6 z-10">
        <PromptInput
          value={input}
          onValueChange={setInput}
          isLoading={sending}
          onSubmit={handleSend}
          className="relative w-full shadow-lg"
        >
          <PromptInputTextarea
            placeholder={`给 ${agentName} 发送消息...`}
            className="min-h-[70px]"
          />
          <PromptInputActions className="absolute bottom-2 right-2">
            <PromptInputAction tooltip={sending ? "发送中..." : "发送消息"}>
              <Button
                variant="default"
                size="icon"
                className="h-8 w-8 rounded-full"
                disabled={!input.trim() || sending}
                onClick={handleSend}
              >
                {composerButton}
              </Button>
            </PromptInputAction>
          </PromptInputActions>
        </PromptInput>
      </div>
    </div>
  );
}
