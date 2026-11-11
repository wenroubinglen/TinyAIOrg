"use client";

/**
 * 游戏卡风格身份卡：
 * - 3D 翻转双态（perspective 1500px + backface-visibility
 *   + rotateY(±180deg) 0.8s）——卡面=查看态，卡背=编辑态
 * - 字段行面板——Name/Title/Description 行内编辑
 * - pikapika 呼吸动画——编辑未保存提示
 * - 卡面规格 160×225（32:45）圆角 6px
 * 头像四层兑底：avatar.png（daemon 字节口）→ avatarColor → agentColor
 * 哈希 → initials。写通道：savePybAgent（PUT profile 字段）+
 * uploadPybAgentAvatar（PUT 字节），写后 watcher→roster SSE 广播。
 */

import { useEffect, useRef, useState } from "react";
import type { AgentConfig } from "@/lib/api";
import { savePybAgent, uploadPybAgentAvatar, pybAgentAvatarUrl } from "@/lib/api";
import { SkillsBadgeStrip, SkillsManager, useAgentSkills } from "@/components/agent/skills-panel";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Check, X, Upload } from "lucide-react";
import { SHAPES, PALETTE, shapeStyle, hashIdx } from "@/components/agent/agent-avatar";

type Props = {
  agentId: string;
  agent: AgentConfig;
  onSaved?: () => void;
  /** 受控翻转（sidebar「编辑」入口经 ?card=edit 打开编辑面） */
  flipped?: boolean;
  onFlippedChange?: (flipped: boolean) => void;
};

export function IdentityCard({ agentId, agent, onSaved, flipped, onFlippedChange }: Props) {
  const [flippedLocal, setFlippedLocal] = useState(false); // 卡背=编辑态
  const isFlipped = flipped ?? flippedLocal;
  const toggleFlipped = (next: boolean) => {
    if (onFlippedChange) onFlippedChange(next);
    else setFlippedLocal(next);
  };
  const [name, setName] = useState(agent.name);
  const [title, setTitle] = useState(agent.title ?? "");
  const [description, setDescription] = useState(agent.description ?? "");
  const [shape, setShape] = useState(agent.avatar_shape ?? "");
  const [color, setColor] = useState(agent.avatar_color ?? "");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  // 技能面板数据——卡面徽条与卡背管理器
  // 共享一次拉取（useAgentSkills 内含 refresh；卡背操作后徽条同步刷新）
  const resolvedAgentId = agent.agent_id ?? agentId;
  const { skills } = useAgentSkills(resolvedAgentId);

  useEffect(() => {
    setAvatarUrl(null);
    fetch(pybAgentAvatarUrl(agent.agent_id ?? agentId))
      .then((r) => (r.ok ? setAvatarUrl(pybAgentAvatarUrl(agent.agent_id ?? agentId)) : null))
      .catch(() => null);
  }, [agentId, agent.agent_id]);

  // props 更新同步 draft（保存成功后父页重拉 roster，agent 快照变化时
  // 编辑框与正面渲染跟着走——React state 不自动响应 props 变化）
  useEffect(() => {
    setName(agent.name);
    setTitle(agent.title ?? "");
    setDescription(agent.description ?? "");
    setShape(agent.avatar_shape ?? "");
    setColor(agent.avatar_color ?? "");
  }, [agent]);

  useEffect(() => {
    setDirty(
      name !== agent.name ||
        title !== (agent.title ?? "") ||
        description !== (agent.description ?? "") ||
        shape !== (agent.avatar_shape ?? "") ||
        color !== (agent.avatar_color ?? "")
    );
  }, [name, title, description, shape, color, agent]);

  async function commit() {
    setSaving(true);
    setError(null);
    try {
      await savePybAgent(agent.agent_id ?? agentId, {
        ...(name !== agent.name ? { name } : {}),
        ...(title !== (agent.title ?? "") ? { title } : {}),
        ...(description !== (agent.description ?? "") ? { description } : {}),
        ...(shape !== (agent.avatar_shape ?? "") ? { avatarShape: shape } : {}),
        ...(color !== (agent.avatar_color ?? "") ? { avatarColor: color } : {}),
      });
      onSaved?.();
      toggleFlipped(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function onPickAvatar(file: File | undefined) {
    if (!file) return;
    setSaving(true);
    setError(null);
    try {
      await uploadPybAgentAvatar(agent.agent_id ?? agentId, file);
      setAvatarUrl(pybAgentAvatarUrl(agent.agent_id ?? agentId));
      onSaved?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  const initials = (agent.name || "?").slice(0, 2);
  const colorHex =
    color || PALETTE[hashIdx(agent.agent_id ?? agentId) % PALETTE.length].hex;

  return (
    <div className="flex h-full flex-col" style={{ perspective: "1500px" }}>
      {/* 卡面容器：aside 即卡——撑满右侧全部区域（满高卡） */}
      <div
        className="relative min-h-0 flex-1 cursor-pointer rounded-md overflow-hidden"
        style={{ transformStyle: "preserve-3d", transition: "transform 0.8s" }}
        onClick={() => !saving && toggleFlipped(!isFlipped)}
        title={isFlipped ? "点击翻回查看" : "点击翻面编辑"}
      >
          {/* 正面（查看态） */}
          <div
            className="absolute inset-0 rounded-md overflow-hidden"
            style={{
              backfaceVisibility: "hidden",
              boxShadow: "0 1px 6px rgba(0,0,0,0.35)",
              transform: isFlipped ? "rotateY(180deg)" : "rotateY(0deg)",
            }}
          >
            <div
              className="flex h-32 shrink-0 items-center justify-center"
              style={{ backgroundColor: colorHex }}
            >
              {avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={avatarUrl} alt="avatar" className="h-24 w-24 rounded-full object-cover border-2 border-white/70" />
              ) : (
                <div
                  className="flex items-center justify-center border-2 border-white/70"
                  style={{ ...shapeStyle(shape), backgroundColor: colorHex, width: 80, height: 80 }}
                >
                  <span className="font-bold text-white uppercase" style={{ fontSize: 80 / 3.2 }}>
                    {initials}
                  </span>
                </div>
              )}
            </div>
            <div className="flex min-h-0 flex-1 flex-col gap-2 p-4 overflow-y-auto">
              <div className="truncate text-base font-semibold">{agent.name}</div>
              <div className="truncate text-sm text-muted-foreground">{title || "—"}</div>
              <div className="mt-1 flex flex-wrap gap-1">
                <Badge variant="secondary" className="text-[10px]">{agent.status || "active"}</Badge>
                <Badge variant="outline" className="text-[10px] font-mono">{agent.permission_mode || "pyb"}</Badge>
              </div>
              <div className="mt-1 text-xs leading-relaxed text-muted-foreground whitespace-pre-wrap">
                {description || "暂无简介"}
              </div>
              {/* 卡面技能徽条——三 bucket 计数 + 专属技能名 */}
              <div className="mt-2 border-t pt-2">
                <SkillsBadgeStrip skills={skills} />
              </div>
            </div>
          </div>

          {/* 背面（编辑态） */}
          <div
            className="absolute inset-0 rounded-md bg-card p-3 flex flex-col gap-2 overflow-y-auto"
            style={{
              backfaceVisibility: "hidden",
              boxShadow: "0 1px 6px rgba(0,0,0,0.35)",
              transform: isFlipped ? "rotateY(0deg)" : "rotateY(-180deg)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-xs font-medium text-muted-foreground">编辑身份</div>
            <label className="text-[11px] text-muted-foreground">
              Name
              <Input value={name} onChange={(e) => setName(e.target.value)} className="mt-0.5 h-7 text-xs" />
            </label>
            <label className="text-[11px] text-muted-foreground">
              Title
              <Input value={title} onChange={(e) => setTitle(e.target.value)} className="mt-0.5 h-7 text-xs" />
            </label>
            <label className="text-[11px] text-muted-foreground">
              Description
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={4}
                className="mt-0.5 w-full rounded-md border bg-transparent px-2 py-1 text-xs resize-none"
              />
            </label>
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(e) => onPickAvatar(e.target.files?.[0])}
            />
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs w-full"
              onClick={() => fileRef.current?.click()}
              disabled={saving}
            >
              <Upload className="h-3 w-3" /> 上传头像
            </Button>
            {/* 形状×颜色参数化头像：选择写 draft，随保存一起 PUT */}
            <div className="mt-1 space-y-2">
              <div>
                <div className="text-[11px] text-muted-foreground">头像形状</div>
                <div className="mt-1 flex items-center gap-1.5">
                  {SHAPES.map((s) => (
                    <button
                      key={s}
                      type="button"
                      title={s}
                      aria-pressed={(shape || "circle") === s}
                      onClick={() => setShape(s)}
                      disabled={saving}
                      className={cn(
                        "flex h-8 w-8 items-center justify-center border bg-muted/40 transition-transform hover:scale-110",
                        (shape || "circle") === s && "ring-2 ring-primary",
                      )}
                    >
                      <span className="block h-5 w-5 bg-foreground/70" style={shapeStyle(s)} />
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <div className="text-[11px] text-muted-foreground">头像颜色</div>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  {PALETTE.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      title={c.id}
                      aria-pressed={colorHex === c.hex}
                      onClick={() => setColor(c.hex)}
                      disabled={saving}
                      className={cn(
                        "h-6 w-6 rounded-full border border-white/40 transition-transform hover:scale-110",
                        colorHex === c.hex && "ring-2 ring-primary ring-offset-1",
                      )}
                      style={{ backgroundColor: c.hex }}
                    />
                  ))}
                </div>
              </div>
            </div>
            {/* 卡背技能管理器——三 bucket 分组 + 开关/删除 */}
            <div className="mt-1 border-t pt-2">
              <SkillsManager agentId={resolvedAgentId} />
            </div>
            {error && <div className="text-[10px] text-destructive">{error}</div>}
            {dirty && (
              <div className="text-[10px] text-amber-500 animate-pulse">未保存更改</div>
            )}
            <div className="mt-auto flex gap-2">
              <Button size="sm" className="h-7 flex-1 text-xs" onClick={commit} disabled={saving || !dirty}>
                <Check className="h-3 w-3" /> 保存
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs"
                onClick={() => toggleFlipped(false)}
                disabled={saving}
              >
                <X className="h-3 w-3" />
              </Button>
            </div>
          </div>
      </div>
    </div>
  );
}
