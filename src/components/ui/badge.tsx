import { type HTMLAttributes } from "react";

import { cn } from "@/lib/utils";

type BadgeTone = "default" | "secondary" | "outline" | "destructive";

export interface BadgeProps extends HTMLAttributes<HTMLDivElement> {
  variant?: BadgeTone;
}

// Static part shared by every badge variant.
const BADGE_BASE = "inline-flex items-center px-2.5 py-0.5 text-xs font-semibold transition-colors";

// Look-up table keyed by tone.
const BADGE_TONES: Record<BadgeTone, string> = {
  default: "bg-primary text-primary-foreground",
  secondary: "bg-secondary text-secondary-foreground",
  outline: "border text-foreground",
  destructive: "bg-destructive text-destructive-foreground",
};

export function Badge({ className, variant = "default", ...rest }: BadgeProps) {
  const classes = cn(BADGE_BASE, BADGE_TONES[variant], className);

  return <div className={classes} {...rest} />;
}
