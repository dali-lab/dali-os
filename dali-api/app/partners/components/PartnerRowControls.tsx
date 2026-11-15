import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { PageRowControls } from "~/components/os-page";
import { cn } from "~/lib/cn";

// Same dress as the primary control PageTabRow draws itself; that one cannot sit after the search and filters.
export const ROW_PRIMARY_CLASS =
  "ml-1.5 inline-flex h-7 shrink-0 items-center gap-[5px] whitespace-nowrap rounded-full bg-os-accent-fill px-2.5 text-[13px] font-semibold text-os-accent-label transition-colors hover:opacity-90 disabled:pointer-events-none disabled:opacity-50";

export function RowPrimaryButton({
  label,
  icon: Icon,
  onClick,
}: {
  label: string;
  icon: LucideIcon;
  onClick: () => void;
}) {
  return (
    <button type="button" onClick={onClick} className={ROW_PRIMARY_CLASS}>
      <Icon className="h-[13px] w-[13px]" aria-hidden />
      {label}
    </button>
  );
}

export function PartnerRowControls({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <PageRowControls>
      <div className={cn("flex min-w-0 flex-wrap items-center justify-end gap-2", className)}>{children}</div>
    </PageRowControls>
  );
}
