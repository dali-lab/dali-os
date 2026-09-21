import type { ReactNode } from "react";
import { CheckCircle2, Circle } from "lucide-react";
import { useOsChrome } from "~/components/os-chrome";
import { cn } from "~/lib/cn";
import { SetupCard } from "./SetupCard";

// A read-only per-domain status list (challenges, review progress, delibs
// rounds): one row per cycle domain with its state.
export function DomainStatusList({
  title,
  description,
  rows,
}: {
  title: string;
  description?: string;
  rows: { domainId: string; name: string; done: boolean; detail: ReactNode }[];
}) {
  const { bodyText } = useOsChrome();
  return (
    <SetupCard title={title} description={description}>
      {rows.length === 0 ? (
        <p className={cn(bodyText, "py-4 text-center")}>No domains in this cycle yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((r) => (
            <li key={r.domainId} className="flex items-center justify-between gap-3 rounded-os-item bg-os-well px-4 py-3 text-sm">
              <span className="flex items-center gap-2 text-foreground">
                {r.done ? (
                  <CheckCircle2 className="h-4 w-4 text-os-green" aria-hidden />
                ) : (
                  <Circle className="h-4 w-4 text-os-grey" aria-hidden />
                )}
                {r.name}
              </span>
              <span className={cn("text-os-grey", r.done && "text-foreground")}>{r.detail}</span>
            </li>
          ))}
        </ul>
      )}
    </SetupCard>
  );
}
