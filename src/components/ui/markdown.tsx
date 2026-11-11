import { memo, useId, useMemo } from "react";
import ReactMarkdown, { Components } from "react-markdown";
import { marked } from "marked";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";

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

const DEFAULT_COMPONENTS: Partial<Components> = {
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
