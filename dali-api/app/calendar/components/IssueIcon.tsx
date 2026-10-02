import { AlertCircle } from "lucide-react";
import { cn } from "~/lib/cn";

/** Marks an event missing a required field: a solid red circle with a white "!". */
export function IssueIcon({ className }: { className?: string }) {
  return (
    <AlertCircle
      className={cn("shrink-0 fill-red-700 text-red-700 [&>line]:stroke-white", className)}
      aria-hidden
    />
  );
}
