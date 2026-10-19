import { useState } from "react";
import { Tooltip } from "~/components/ui/floating";
import { cn } from "~/lib/cn";

// Measured on enter rather than every render, so long lists don't pay for layout reads.
export function Truncated({
  as = "span",
  text,
  className,
}: {
  as?: "span" | "p" | "h3";
  text: string;
  className?: string;
}) {
  const Tag = as as "span";
  const [cut, setCut] = useState(false);
  return (
    <Tooltip content={text} variant="rich" disabled={!cut}>
      <Tag
        className={cn("block min-w-0 truncate", className)}
        onMouseEnter={(e) => setCut(e.currentTarget.scrollWidth > e.currentTarget.clientWidth)}
      >
        {text}
      </Tag>
    </Tooltip>
  );
}
