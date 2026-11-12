import { memo, useId, useMemo } from "react";
import ReactMarkdown, { Components } from "react-markdown";
import { marked } from "marked";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import { Link2 } from "lucide-react";

import { CodeBlock, CodeBlockCode } from "./code-block";
import { cn } from "@/lib/utils";

export type MarkdownProps = {
  children: string;
  id?: string;
  className?: string;
  components?: Partial<Components>;
};

/** Split markdown source into top-level blocks so each can memoize independently. */
function splitIntoBlocks(markdown: string): string[] {
  return marked.lexer(markdown).map((token) => token.raw);
}

/** Pull the language token out of a `language-xyz` className, if present. */
function languageFromClassName(className?: string): string {
  const found = className?.match(/language-(\w+)/);
  return found?.[1] ?? "plaintext";
}

const INLINE_CODE_CLASS = "bg-primary-foreground rounded-sm px-1 font-mono text-sm";

/** Pull hostname out of an href for the link card label. */
function hostFromHref(href: string): string {
  try {
    return new URL(href).host;
  } catch {
    return href;
  }
}

/** Truncate long hrefs so bare-URL cards stay inside the bubble. */
function truncateHref(href: string, max = 48): string {
  return href.length > max ? `${href.slice(0, max)}…` : href;
}

const LINK_ANCHOR_CLASS =
  "text-primary underline underline-offset-2 hover:opacity-80 break-all";

const DEFAULT_COMPONENTS: Partial<Components> = {
  // Bare URLs (GFM autolink) render as a compact link card; labeled
  // [text](url) links stay inline. All external links open in a new tab.
  a: function MarkdownLink({ href, children, node: _node, ...props }) {
    const url = href ?? "";
    const childrenText = Array.isArray(children)
      ? children.map((c) => (typeof c === "string" ? c : "")).join("")
      : typeof children === "string"
        ? children
        : "";
    const isBareUrl =
      /^https?:\/\//i.test(childrenText) || childrenText.trim() === "" || /^www\./i.test(childrenText.trim());

    if (isBareUrl) {
      return (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="my-1 flex max-w-full items-center gap-2 rounded-md border bg-muted/50 px-3 py-2 text-xs no-underline transition-colors hover:bg-muted"
        >
          <Link2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="flex min-w-0 flex-col">
            <span className="font-medium text-foreground">{hostFromHref(url)}</span>
            <span className="block truncate text-muted-foreground">{truncateHref(childrenText.trim() || url)}</span>
          </span>
        </a>
      );
    }

    return (
      <a href={url} target="_blank" rel="noopener noreferrer" className={LINK_ANCHOR_CLASS} {...props}>
        {children}
      </a>
    );
  },
  // Fenced blocks are rendered through CodeBlock; inline code gets a chip look.
  code: function MarkdownCode({ className, children, ...props }) {
    const startPos = props.node?.position?.start.line;
    const endPos = props.node?.position?.end.line;
    const inline = !startPos || startPos === endPos;

    if (inline) {
      return (
        <span className={cn(INLINE_CODE_CLASS, className)} {...props}>
          {children}
        </span>
      );
    }

    return (
      <CodeBlock className={className}>
        <CodeBlockCode code={children as string} language={languageFromClassName(className)} />
      </CodeBlock>
    );
  },
  // The <pre> wrapper is supplied by CodeBlock itself.
  pre: function MarkdownPre({ children }) {
    return <>{children}</>;
  },
};

type BlockProps = {
  content: string;
  components?: Partial<Components>;
};

/** One markdown block; only re-renders when its raw content changes. */
const MarkdownBlock = memo(
  function MarkdownBlock({ content, components = DEFAULT_COMPONENTS }: BlockProps) {
    return (
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        components={components}
      >
        {content}
      </ReactMarkdown>
    );
  },
  (prev, next) => prev.content === next.content
);

MarkdownBlock.displayName = "MarkdownBlock";

function MarkdownBase({
  children,
  id,
  className,
  components = DEFAULT_COMPONENTS,
}: MarkdownProps) {
  const autoId = useId();
  const scopeId = id ?? autoId;

  const blocks = useMemo(() => splitIntoBlocks(children), [children]);

  return (
    <div className={className}>
      {blocks.map((block, index) => (
        <MarkdownBlock
          key={`${scopeId}-block-${index}`}
          content={block}
          components={components}
        />
      ))}
    </div>
  );
}

const Markdown = memo(MarkdownBase);
Markdown.displayName = "Markdown";

export { Markdown };
