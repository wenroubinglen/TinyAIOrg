"use client";

/**
 * Skills tab——只暴露外部 skill（pyb/skill.list 非 bundled 清单，
 * 含项目级/用户级来源标注）。一等语义裁决：内置 skill/MCP/委派面不展示。
 */
import { useState, useEffect } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Swords, Loader2, RefreshCw } from "lucide-react";
import { getPybSkills, type SkillEntryRpc } from "@/lib/api";

const SOURCE_LABELS: Record<string, string> = {
  localSettings: "项目级",
  userSettings: "用户级",
  pluginDir: "插件",
  dynamic: "动态",
};

export function SkillsListTab({ agentId }: { agentId: string }) {
  const [skills, setSkills] = useState<SkillEntryRpc[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const r = await getPybSkills(agentId);
      setSkills(r.skills ?? []);
    } catch {
      setSkills([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [agentId]);

  return (
    <div className="p-6 space-y-4 max-w-4xl">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold flex items-center gap-2">
          <Swords className="h-4 w-4 text-primary" />
          外部 Skills
          {skills.length > 0 && (
            <Badge variant="secondary" className="text-[10px]">{skills.length}</Badge>
          )}
        </h2>
        <button className="text-muted-foreground hover:text-foreground" onClick={() => void load()}>
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-8">
          <Loader2 className="h-4 w-4 animate-spin" />
          加载 skill 清单中...
        </div>
      ) : skills.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center">
            <Swords className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">
              还没有外部 skill。把 skill 放进项目 .pyb/skills/ 或用户 ~/.pyb/skills/
              目录（子目录含 SKILL.md），刷新后即可见。
            </p>
            <p className="text-xs text-muted-foreground mt-2">
              内置 skill 与 MCP 面按一等语义不在此展示。
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {skills.map((s) => (
            <Card key={s.name}>
              <CardHeader className="pb-1">
                <CardTitle className="text-sm flex items-center gap-2">
                  <span className="font-mono">{s.name}</span>
                  <Badge variant="outline" className="text-[10px]">
                    {SOURCE_LABELS[s.source] ?? s.source}
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground line-clamp-3">
                  {s.description || "（无描述）"}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
