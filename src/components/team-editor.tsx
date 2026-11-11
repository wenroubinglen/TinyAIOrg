"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Crown, Plus, Pencil, Check, X, Loader2, Search } from "lucide-react";
import { Virtuoso } from "react-virtuoso";
import { agentColor } from "@/components/sidebar";
import { AgentAvatar } from "@/components/agent/agent-avatar";
import { cn } from "@/lib/utils";
import type { AgentConfig } from "@/lib/api";

/** 群编辑表单状态（teams 页与组织架构抽屉同构消费）。 */
export type TeamFormData = {
  id: string;
  name: string;
  /** D 柱：群职能描述（引擎必填——主管知职能/管理者组装资源视野的燃料）。 */
  description: string;
  agents: string[];
  leader: string;
};

export function TeamEditor({
  form, setForm, isNew, saving, error, onSave, onCancel, availableAgents, compact,
}: {
  form: TeamFormData;
  setForm: (f: TeamFormData) => void;
  isNew: boolean;
  saving: boolean;
  error: string;
  onSave: () => void;
  onCancel?: () => void;
  availableAgents: Record<string, AgentConfig>;
  /** 抽屉形态：单列紧凑网格、无 Card 外壳留白。 */
  compact?: boolean;
}) {
  const toggleAgent = (agentId: string) => {
    const inTeam = form.agents.includes(agentId);
    setForm({
      ...form,
      agents: inTeam ? form.agents.filter(a => a !== agentId) : [...form.agents, agentId],
      leader: inTeam && form.leader === agentId ? "" : form.leader,
    });
  };
  const toggleLeader = (agentId: string) => {
    setForm({ ...form, leader: form.leader === agentId ? "" : agentId });
  };

  // ── 成员册规模化：搜索过滤 + 虚拟滚动（默认视口 10 行；已选优先上浮） ──
  const [memberQuery, setMemberQuery] = useState("");
  const MEMBER_ROW_H = 44;
  const MEMBER_VIEW_ROWS = 10;
  const memberIds = useMemo(() => {
    const q = memberQuery.trim().toLowerCase();
    const filtered = q
      ? Object.keys(availableAgents).filter((id) =>
          availableAgents[id]?.name?.toLowerCase().includes(q)
        )
      : Object.keys(availableAgents);
    // 已选成员上浮（当前构成一眼可见），组内保持引擎返回序
    return [
      ...filtered.filter((id) => form.agents.includes(id)),
      ...filtered.filter((id) => !form.agents.includes(id)),
    ];
  }, [availableAgents, memberQuery, form.agents]);

  const renderMemberRow = (agentId: string) => {
    const agent = availableAgents[agentId];
    const selected = form.agents.includes(agentId);
    return (
      <div
        style={{ height: MEMBER_ROW_H }}
        className={`flex items-center justify-between border px-3 py-2 cursor-pointer transition-colors ${
          selected
            ? "border-primary/50 bg-primary/5"
            : "border-border hover:border-muted-foreground/50"
        }`}
        onClick={() => toggleAgent(agentId)}
      >
        <div className="flex items-center gap-2 min-w-0">
          <AgentAvatar
            agentId={agentId}
            name={agent.name}
            shape={agent.avatar_shape}
            colorHex={agent.avatar_color}
            size={24}
          />
          <div className="min-w-0">
            <p className="text-sm font-medium truncate">{agent.name}</p>
            {!compact && <p className="text-xs text-muted-foreground">@{agentId}</p>}
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0 ml-2" onClick={(e) => e.stopPropagation()}>
          {selected && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                toggleLeader(agentId);
              }}
              className={cn(
                "p-1 rounded transition-colors",
                form.leader === agentId
                  ? "text-primary bg-primary/10"
                  : "text-muted-foreground/60 hover:text-primary"
              )}
              title={form.leader === agentId ? "取消 Leader 标签" : "设为 Leader（接口成员：默认先接话，平权无特权）"}
            >
              <Crown className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
    );
  };

  const body = (
    <>
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground">团队名称</label>
        <Input
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          placeholder="如 Backend Team"
        />
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground">
          团队简介（必填）
        </label>
        <Input
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          placeholder="一句话说明本团队职能（如：负责后端 API 开发与维护）"
        />
        <p className="text-[10px] text-muted-foreground">
          主管以此知职能、组织管理者以此组装资源视野；空置无法保存
        </p>
      </div>

      <div className="space-y-2">
        <label className="text-xs font-medium text-muted-foreground">
          团队成员
          {form.agents.length > 0 && (
            <span className="ml-2 text-primary">已选 {form.agents.length} 个</span>
          )}
          <span className="ml-1 text-muted-foreground/70">共 {Object.keys(availableAgents).length} 人</span>
        </label>
        {/* 过滤搜索（标题正下方）：就地过滤成员册 */}
        <div className="flex items-center gap-1.5 border rounded-md px-2 py-1.5 focus-within:border-primary/60 transition-colors">
          <Search className="h-3 w-3 text-muted-foreground shrink-0" />
          <input
            value={memberQuery}
            onChange={(e) => setMemberQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Escape") setMemberQuery(""); }}
            placeholder="搜索成员…"
            className="w-full bg-transparent text-xs outline-none placeholder:text-muted-foreground text-foreground"
          />
          <span className="text-[9px] text-muted-foreground shrink-0">
            {memberQuery.trim() ? `${memberIds.length} 命中` : ""}
          </span>
        </div>
        {Object.keys(availableAgents).length > 0 ? (
          memberIds.length > 0 ? (
            /* 虚拟滚动：默认视口 10 行，全区可滚（已选上浮） */
            <div style={{ height: Math.min(memberIds.length, MEMBER_VIEW_ROWS) * MEMBER_ROW_H + 8 }}>
              <Virtuoso
                style={{ height: "100%" }}
                totalCount={memberIds.length}
                itemContent={(index) => renderMemberRow(memberIds[index])}
              />
            </div>
          ) : (
            <p className="text-sm text-muted-foreground py-2 text-center">无匹配成员</p>
          )
        ) : (
          <p className="text-sm text-muted-foreground">
            暂未配置 Agent。<Link href="/agents" className="text-primary hover:underline">先去创建 Agent</Link> 再组建 Team。
          </p>
        )}
      </div>

      {form.agents.length > 0 && (
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">团队构成</label>
          <div className="flex items-center gap-2 flex-wrap">
            {form.agents.map((agentId) => (
              <Badge key={agentId} variant="outline" className="flex items-center gap-1">
                {availableAgents[agentId]?.name || agentId}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex items-center gap-2 pt-2">
        <Button onClick={onSave} disabled={saving}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
          {isNew ? "创建 Team" : "保存修改"}
        </Button>
        {onCancel && (
          <Button variant="ghost" onClick={onCancel} disabled={saving}>
            <X className="h-4 w-4" />
            取消
          </Button>
        )}
      </div>
    </>
  );

  if (compact) return <div className="flex h-full flex-col gap-4 overflow-y-auto p-3">{body}</div>;

  return (
    <Card className="border-primary/50">
      <CardHeader>
        <CardTitle className="text-sm flex items-center gap-2">
          {isNew ? <Plus className="h-4 w-4 text-primary" /> : <Pencil className="h-4 w-4 text-primary" />}
          {isNew ? "新建 Team" : `编辑 @${form.id}`}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">{body}</CardContent>
    </Card>
  );
}
