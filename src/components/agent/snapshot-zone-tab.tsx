"use client";

/**
 * 快照 tab（摘要索引+点入文件）——Memory/Plan/自省+知识库共用。
 * 索引 = pyb/agent.zone.list（文件级清单）；点入 = pyb/agent.zone.read
 * （白名单+防穿越在引擎侧）。空态引导：teammate 事实性多为空，
 * 提示先在 Chat 里让它自建记忆。
 */
import { useState, useCallback, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft, FileText, Loader2, RefreshCw } from "lucide-react";
import {
  getPybZoneList,
  getPybZoneFile,
  type ZoneFileEntry,
} from "@/lib/api";

const ZONE_LABELS: Record<string, string> = {
  memory: "Memory（记忆快照）",
  plans: "Plan（计划快照）",
  iteration: "自省笔记（iteration）",
  study: "知识库（study wiki）",
};

const ZONE_EMPTY_HINTS: Record<string, string> = {
  memory: "这个队友还没有自己的记忆。在 Chat 里让它记住什么（它会用 memory 工具落盘），快照会出现在这里。",
  plans: "这个队友还没进过计划模式。当它进入 planmode 工作后，计划地图快照会出现在这里。",
  iteration: "这个队友还没有自省笔记。它自我迭代记录经验教训后，笔记会出现在这里。",
  study: "这个队友还没有知识库页面。当它整理学习资料进 wiki 后，页面会出现在这里。",
};

function fmtTime(ms: number): string {
  const d = new Date(ms);
  return `${d.getMonth() + 1}-${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function SnapshotZoneTab({
  agentId,
  zone,
  subZones,
}: {
  agentId: string;
  zone: string;
  /** 该 tab 覆盖的引擎 zone 列表（自省+知识库 tab = iteration+study 两区）。 */
  subZones: string[];
}) {
  const [index, setIndex] = useState<Record<string, ZoneFileEntry[]>>({});
  const [loading, setLoading] = useState(true);
  const [openFile, setOpenFile] = useState<{ zone: string; relPath: string } | null>(null);
  const [fileContent, setFileContent] = useState("");
  const [fileLoading, setFileLoading] = useState(false);

  const loadIndex = useCallback(async () => {
    setLoading(true);
    try {
      const results: Record<string, ZoneFileEntry[]> = {};
      for (const z of subZones) {
        const r = await getPybZoneList(agentId, z);
        results[z] = r.files;
      }
      setIndex(results);
    } catch {
      setIndex({});
    } finally {
      setLoading(false);
    }
  }, [agentId, subZones]);

  useEffect(() => { void loadIndex(); }, [loadIndex]);

  const openZoneFile = useCallback(async (z: string, relPath: string) => {
    setOpenFile({ zone: z, relPath });
    setFileLoading(true);
    try {
      const r = await getPybZoneFile(agentId, z, relPath);
      setFileContent(r.exists ? r.content : "（文件不存在或为空）");
    } catch (err) {
      setFileContent(`读取失败：${(err as Error).message}`);
    } finally {
      setFileLoading(false);
    }
  }, [agentId]);

  if (openFile) {
    return (
      <div className="p-6 max-w-4xl">
        <div className="flex items-center gap-2 mb-3">
          <Button variant="ghost" size="sm" onClick={() => setOpenFile(null)}>
            <ArrowLeft className="h-3.5 w-3.5" />
            返回索引
          </Button>
          <Badge variant="outline" className="font-mono text-[10px]">
            {openFile.zone}/{openFile.relPath}
          </Badge>
        </div>
        {fileLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-8">
            <Loader2 className="h-4 w-4 animate-spin" />
            读取文件中...
          </div>
        ) : (
          <pre className="text-xs whitespace-pre-wrap bg-muted/40 rounded-lg p-4 border max-h-[70vh] overflow-auto">
            {fileContent}
          </pre>
        )}
      </div>
    );
  }

  const totalFiles = Object.values(index).reduce((n, f) => n + f.length, 0);

  return (
    <div className="p-6 space-y-4 max-w-4xl">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold flex items-center gap-2">
          <FileText className="h-4 w-4 text-primary" />
          {ZONE_LABELS[zone] ?? zone}
          {totalFiles > 0 && (
            <Badge variant="secondary" className="text-[10px]">{totalFiles} 个文件</Badge>
          )}
        </h2>
        <Button variant="ghost" size="sm" onClick={() => void loadIndex()}>
          <RefreshCw className="h-3.5 w-3.5" />
          刷新
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-8">
          <Loader2 className="h-4 w-4 animate-spin" />
          加载快照索引中...
        </div>
      ) : totalFiles === 0 ? (
        <Card>
          <CardContent className="p-8 text-center">
            <FileText className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">
              {ZONE_EMPTY_HINTS[zone] ?? "这个区还没有内容。"}
            </p>
          </CardContent>
        </Card>
      ) : (
        subZones.map((z) =>
          (index[z] ?? []).length > 0 ? (
            <Card key={z}>
              <CardHeader className="pb-1">
                <CardTitle className="text-xs text-muted-foreground">
                  {z}（{index[z].length}）
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="divide-y">
                  {index[z].map((f) => (
                    <button
                      key={f.name}
                      className="w-full flex items-center justify-between py-2 px-2 text-left hover:bg-muted/40 rounded transition-colors"
                      onClick={() => void openZoneFile(z, f.name)}
                    >
                      <span className="font-mono text-xs truncate">{f.name}</span>
                      <span className="text-[10px] text-muted-foreground shrink-0 ml-2">
                        {(f.size / 1024).toFixed(1)}KB · {fmtTime(f.mtimeMs)}
                      </span>
                    </button>
                  ))}
                </div>
              </CardContent>
            </Card>
          ) : null,
        )
      )}
    </div>
  );
}
