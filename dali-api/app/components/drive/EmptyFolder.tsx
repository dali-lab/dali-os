import type { ReactNode } from "react";

export function EmptyFolder({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={`flex flex-col items-center gap-4 px-3 py-8 text-center ${className ?? ""}`}>
      <div
        data-empty-folder-art
        className="relative flex h-14 w-24 flex-col gap-1.5 rounded-lg border-2 border-dashed border-os-container-hi p-2"
        aria-hidden
      >
        <div className="flex items-center gap-1.5 opacity-60">
          <div className="h-2.5 w-2 rounded-[2px] bg-os-container-hi" />
          <div className="h-1 w-10 rounded-full bg-os-container" />
        </div>
        <div className="flex items-center gap-1.5 opacity-40">
          <div className="h-2.5 w-2 rounded-[2px] bg-os-container-hi" />
          <div className="h-1 w-8 rounded-full bg-os-container" />
        </div>
        <div className="absolute -bottom-2 left-1/2 flex h-4 w-4 -translate-x-1/2 items-center justify-center rounded-full bg-os-accent">
          <div className="h-1.5 w-1.5 -translate-y-px rotate-45 border-b-2 border-r-2 border-os-nav" />
        </div>
      </div>
      <p className="text-sm text-os-muted">{children}</p>
    </div>
  );
}
