"use client";

/**
 * Profile tab——一等 teammate 人设面。
 * 人设真相源 = 引擎 entities/<agentId>/profile.md 的 description（经
 * pyb/agent.list 携带，server /api/pyb-agents/:id/profile 代理）；
 * 编辑走 pyb/agent.update（description 双字段链）。
 * permissions 面当前只读（仅 ultraflowApproved 一个键，如实展示）。
 */
import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Check, Loader2, Pencil, Shield, FileText } from "lucide-react";
import { getPybAgentProfile, savePybAgent, type PybAgentProfile } from "@/lib/api";
import { usePolling } from "@/lib/hooks";

export function ProfileTab({ agentId, displayName }: { agentId: string; displayName: string }) {
  const { data: profile } = usePolling<PybAgentProfile>(
    () => getPybAgentProfile(agentId), 0,
  );
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  const startEdit = () => {
    setDraft(profile?.description ?? "");
    setEditing(true);
    setError("");
  };

  const save = useCallback(async () => {
    setSaving(true);
    setError("");
    try {
      await savePybAgent(agentId, { description: draft.trim() });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      setEditing(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }, [agentId, draft]);

  if (!profile) {
    return (
      <div className="p-8 text-sm text-muted-foreground flex items-center gap-2">
        <div className="h-3 w-3 animate-spin border-2 border-primary border-t-transparent" />
        加载人设中...
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4 max-w-3xl">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <FileText className="h-4 w-4 text-primary" />
            人设（profile.md description）
            <Badge variant="outline" className="font-mono text-[10px]">
              {profile.agent_id.slice(0, 20)}
            </Badge>
            <Badge variant="secondary" className="text-[10px]">{profile.status}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {editing ? (
            <>
              <Textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={8}
                className="text-sm"
                placeholder="队友的人设描述——它将以这个身份思考与行动"
              />
              {error && <p className="text-sm text-destructive">{error}</p>}
              <div className="flex items-center gap-2">
                <Button size="sm" onClick={save} disabled={saving || !draft.trim()}>
                  {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                  保存人设
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={saving}>
                  取消
                </Button>
              </div>
            </>
          ) : (
            <>
              <p className="text-sm whitespace-pre-wrap leading-relaxed">
                {profile.description || "（尚未设置人设——点击下方编辑补全）"}
              </p>
              <Button size="sm" variant="outline" onClick={startEdit}>
                <Pencil className="h-3.5 w-3.5" />
                编辑人设
              </Button>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Shield className="h-4 w-4 text-primary" />
            权限（只读）
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground">{profile.permissions.note}</p>
          <p className="text-xs text-muted-foreground mt-1">
            权限模式经 pyb/agent.create 的 default_permission_mode 逐体落定；
            弹窗决议走详情页权限通知。
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
