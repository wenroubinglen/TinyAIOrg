import * as React from "react";

import { cn } from "@/lib/utils";

// Layout, borders, and file-input styling shared by all inputs.
const INPUT_SHELL =
  "h-9 w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-xs transition-[color,box-shadow] outline-none md:text-sm dark:bg-input/30";

// Selection + placeholder + disabled states.
const INPUT_STATES =
  "selection:bg-primary selection:text-primary-foreground file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50";

// Focus ring and invalid styling.
const INPUT_FOCUS =
  "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40";

function Input({ className, type, ...rest }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(INPUT_SHELL, INPUT_STATES, INPUT_FOCUS, className)}
      {...rest}
    />
  );
}

export { Input };
