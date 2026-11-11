import * as React from "react";

import { cn } from "@/lib/utils";

const TEXTAREA_CLASS =
  "flex field-sizing-content min-h-16 w-full rounded-md border border-input bg-transparent px-3 py-2 text-base shadow-xs transition-[color,box-shadow] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30 dark:aria-invalid:ring-destructive/40";

/** Multi-line text control with the standard focus/invalid treatment. */
function Textarea({ className, ...rest }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(TEXTAREA_CLASS, className)}
      {...rest}
    />
  );
}

export { Textarea };
