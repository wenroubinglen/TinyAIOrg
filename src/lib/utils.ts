import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Merge conditional class names, resolving Tailwind conflicts. */
export function cn(...classes: ClassValue[]): string {
  return twMerge(clsx(classes));
}
