/**
 * 附件卡片（DM/群聊共用）。
 *
 * 图片直显（字节 URL <img>，onError 兜底图标）+ 点击放大模态（P1：
 * createPortal 全屏遮罩，Esc/点遮罩关闭）；其余 kind 渲染文件卡
 * （图标+名称+尺寸）。draft 模式带移除按钮（composer 草稿区用）。
 */
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Paperclip, FileText, FileImage, FileVideo, FileAudio, X } from "lucide-react";
import { attachmentByteUrl, type AttachmentRef } from "@/lib/api";

function formatBytes(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${(n / 1024 / 1024).toFixed(1)}MB`;
}

function kindIcon(kind: string) {
  switch (kind) {
    case "image":
      return <FileImage className="h-4 w-4 shrink-0" />;
    case "video":
      return <FileVideo className="h-4 w-4 shrink-0" />;
    case "audio":
      return <FileAudio className="h-4 w-4 shrink-0" />;
    default:
      return <FileText className="h-4 w-4 shrink-0" />;
  }
}

/** 图片放大模态：全屏遮罩 + 居中大图，Esc/点遮罩关闭。 */
function ImageLightbox({
  src,
  alt,
  onClose,
}: {
  src: string;
  alt: string;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`查看图片 ${alt}`}
    >
      <img
        src={src}
        alt={alt}
        className="max-h-full max-w-full rounded-md object-contain shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      />
      <button
        type="button"
        onClick={onClose}
        className="absolute right-4 top-4 rounded-full bg-background/80 p-2 shadow-md transition-colors hover:bg-background"
        aria-label="关闭"
      >
        <X className="h-4 w-4" />
      </button>
    </div>,
    document.body,
  );
}

export function AttachmentCard({
  ownerId,
  attachment,
  previewUrl,
  onRemove,
}: {
  ownerId: string;
  attachment: AttachmentRef;
  /** 乐观预览（本地 objectURL——图片类直显，免等服务端回读）。 */
  previewUrl?: string;
  onRemove?: () => void;
}) {
  const [lightbox, setLightbox] = useState(false);
  // 加载失败的图不可点开（onError 兜底切文件卡形态，模态无意义）。
  const [imgBroken, setImgBroken] = useState(false);
  const isImage = attachment.kind === "image";
  const src = previewUrl ?? attachmentByteUrl(ownerId, attachment.id);
  return (
    <div className="relative inline-flex max-w-[240px] flex-col gap-1 rounded-lg border bg-muted/50 p-2">
      {isImage ? (
        <img
          src={src}
          alt={attachment.name}
          className={`max-h-40 rounded-md object-cover${imgBroken ? "" : " cursor-zoom-in transition-opacity hover:opacity-90"}`}
          onClick={() => {
            if (!imgBroken) setLightbox(true);
          }}
          onError={(e) => {
            // 字节 404/加载失败兜底：换文件卡形态（不裂图）。
            setImgBroken(true);
            e.currentTarget.style.display = "none";
          }}
        />
      ) : (
        <div className="flex items-center gap-2">
          {kindIcon(attachment.kind)}
          <span className="truncate text-xs font-medium">{attachment.name}</span>
        </div>
      )}
      {isImage ? (
        <span className="truncate text-[10px] text-muted-foreground">
          {attachment.name} · {formatBytes(attachment.size)}
        </span>
      ) : (
        <span className="text-[10px] text-muted-foreground">
          {formatBytes(attachment.size)}
        </span>
      )}
      {onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          className="absolute -right-1.5 -top-1.5 rounded-full bg-background border p-0.5 shadow-sm"
          aria-label="移除附件"
        >
          <X className="h-3 w-3" />
        </button>
      ) : null}
      {lightbox && !imgBroken ? (
        <ImageLightbox src={src} alt={attachment.name} onClose={() => setLightbox(false)} />
      ) : null}
    </div>
  );
}

/** 草稿附件模型：ref + 图片类本地预览 URL（移除时 revoke）。 */
export type DraftAttachment = {
  ref: AttachmentRef;
  previewUrl?: string;
};

/**
 * 回形针统一入口：桌面端（Electron
 * preload 桥在位）走主进程原生 dialog——DOM file input 的 change 事件在
 * Electron 下因系统对话框致窗口失焦而不派发（真机双证）；浏览器环境自动
 * 回退传入的 input.click()。返回所选 File[]（取消为 []）。
 */
export async function pickFilesViaDialog(
  fallbackClick: () => void,
): Promise<File[]> {
  const picker = (window as unknown as {
    pybDesktop?: { pickFiles?: (o?: { multiple?: boolean }) => Promise<Array<{ name: string; bytes: ArrayBuffer }>> };
  }).pybDesktop?.pickFiles;
  if (!picker) {
    fallbackClick();
    return [];
  }
  const picked = await picker({ multiple: true });
  return picked.map(
    (p) => new File([p.bytes], p.name, { type: guessMime(p.name) }),
  );
}

function guessMime(name: string): string {
  const ext = name.slice(name.lastIndexOf(".")).toLowerCase();
  const m: Record<string, string> = {
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
    ".gif": "image/gif", ".webp": "image/webp", ".bmp": "image/bmp",
    ".pdf": "application/pdf", ".mp4": "video/mp4", ".webm": "video/webm",
    ".mp3": "audio/mpeg", ".wav": "audio/wav", ".txt": "text/plain",
    ".md": "text/plain", ".csv": "text/plain", ".json": "text/plain",
  };
  return m[ext] ?? "application/octet-stream";
}

/** 附件输入辅助：文件列表 → 上传 → DraftAttachment[]（上限 6 超出静默
 * 截断由调用方提示；上传失败逐项收集错误回传——fail-visible）。 */
export async function uploadDraftAttachments(
  ownerId: string,
  files: FileList | File[],
  existingCount: number,
): Promise<{ drafts: DraftAttachment[]; errors: string[] }> {
  const { uploadAttachment } = await import("@/lib/api");
  const drafts: DraftAttachment[] = [];
  const errors: string[] = [];
  const list = Array.from(files).slice(0, Math.max(0, 6 - existingCount));
  for (const f of list) {
    try {
      const ref = await uploadAttachment(ownerId, f);
      drafts.push({
        ref,
        ...(ref.kind === "image"
          ? { previewUrl: URL.createObjectURL(f) }
          : {}),
      });
    } catch (err) {
      errors.push(`${f.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return { drafts, errors };
}

export { Paperclip };
