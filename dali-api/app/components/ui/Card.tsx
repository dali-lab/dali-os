import type { HTMLAttributes } from "react";
import { cn } from "~/lib/cn";

// No border: os panels separate from the page by fill alone, like the inline
// `rounded-os-card bg-card` panels across the app. Floating layers and
// banners keep theirs.
export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-os-card bg-card", className)} {...props} />;
}
