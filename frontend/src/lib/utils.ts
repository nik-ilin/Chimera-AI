import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Merges Tailwind class names, resolving conflicts correctly.
 * This is the single utility for all className composition in the project.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
