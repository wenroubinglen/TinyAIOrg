"use client";

import React, { useEffect, useState } from "react";
import { codeToHtml } from "shiki";

import { cn } from "@/lib/utils";

export type CodeBlockProps = {
  children?: React.ReactNode;
  className?: string;
} & React.HTMLProps<HTMLDivElement>;

/** Bordered card that frames a code region. */
function CodeBlock({ children, className, ...rest }: CodeBlockProps) {
  return (
    <div
      className={cn(
        "not-prose flex w-full flex-col overflow-clip rounded-xl border",
        "border-border bg-card text-card-foreground",
        className
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

export type CodeBlockCodeProps = {
  code: string;
  language?: string;
  theme?: string;
  className?: string;
} & React.HTMLProps<HTMLDivElement>;

/**
 * Syntax-highlighted code via shiki. Renders plain markup on the server and
 * swaps in the highlighted HTML once the async highlight resolves.
 */
function CodeBlockCode({
  code,
  language = "tsx",
  theme = "github-light",
  className,
  ...rest
}: CodeBlockCodeProps) {
  const [html, setHtml] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      const result = code
        ? await codeToHtml(code, { lang: language, theme })
        : "<pre><code></code></pre>";
      if (!cancelled) setHtml(result);
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [code, language, theme]);

  const classes = cn(
    "w-full overflow-x-auto text-[13px] [&>pre]:px-4 [&>pre]:py-4",
    className
  );

  if (html !== null) {
    return (
      <div
        className={classes}
        dangerouslySetInnerHTML={{ __html: html }}
        {...rest}
      />
    );
  }

  // Pre-hydration fallback so SSR output is not empty.
  return (
    <div className={classes} {...rest}>
      <pre>
        <code>{code}</code>
      </pre>
    </div>
  );
}

export type CodeBlockGroupProps = React.HTMLAttributes<HTMLDivElement>;

/** Header strip above the code, typically holding a filename and actions. */
function CodeBlockGroup({ children, className, ...rest }: CodeBlockGroupProps) {
  return (
    <div className={cn("flex items-center justify-between", className)} {...rest}>
      {children}
    </div>
  );
}

export { CodeBlockGroup, CodeBlockCode, CodeBlock };
