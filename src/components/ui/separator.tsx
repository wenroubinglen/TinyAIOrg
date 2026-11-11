"use client";

import * as React from "react";
import { Separator as SeparatorPrimitive } from "radix-ui";

import { cn } from "@/lib/utils";

const SEPARATOR_CLASS =
  "shrink-0 bg-border data-[orientation=horizontal]:h-px data-[orientation=horizontal]:w-full data-[orientation=vertical]:h-full data-[orientation=vertical]:w-px";

type SeparatorProps = React.ComponentProps<typeof SeparatorPrimitive.Root>;

/** Horizontal or vertical divider line (decorative by default). */
function Separator({
  className,
  orientation = "horizontal",
  decorative = true,
  ...rest
}: SeparatorProps) {
  return (
    <SeparatorPrimitive.Root
      data-slot="separator"
      decorative={decorative}
      orientation={orientation}
      className={cn(SEPARATOR_CLASS, className)}
      {...rest}
    />
  );
}

export { Separator };
