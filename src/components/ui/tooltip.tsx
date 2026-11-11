"use client";

import * as React from "react";
import { Tooltip as TooltipPrimitive } from "radix-ui";

import { cn } from "@/lib/utils";

type ProviderProps = React.ComponentProps<typeof TooltipPrimitive.Provider>;
type RootProps = React.ComponentProps<typeof TooltipPrimitive.Root>;
type TriggerProps = React.ComponentProps<typeof TooltipPrimitive.Trigger>;
type ContentProps = React.ComponentProps<typeof TooltipPrimitive.Content>;

/** App-wide tooltip configuration point; defaults to showing instantly. */
function TooltipProvider({ delayDuration = 0, ...rest }: ProviderProps) {
  return (
    <TooltipPrimitive.Provider
      data-slot="tooltip-provider"
      delayDuration={delayDuration}
      {...rest}
    />
  );
}

/** Root of a single tooltip; composes Provider > Root > Trigger + Content. */
function Tooltip(props: RootProps) {
  return <TooltipPrimitive.Root data-slot="tooltip" {...props} />;
}

function TooltipTrigger(props: TriggerProps) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />;
}

const TOOLTIP_CONTENT_CLASS =
  "z-50 w-fit origin-(--radix-tooltip-content-transform-origin) animate-in rounded-md bg-foreground px-3 py-1.5 text-xs text-balance text-background fade-in-0 zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95";

const TOOLTIP_ARROW_CLASS =
  "z-50 size-2.5 translate-y-[calc(-50%_-_2px)] rotate-45 rounded-[2px] bg-foreground fill-foreground";

function TooltipContent({
  className,
  sideOffset = 0,
  children,
  ...rest
}: ContentProps) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        className={cn(TOOLTIP_CONTENT_CLASS, className)}
        {...rest}
      >
        {children}
        <TooltipPrimitive.Arrow className={TOOLTIP_ARROW_CLASS} />
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  );
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider };
