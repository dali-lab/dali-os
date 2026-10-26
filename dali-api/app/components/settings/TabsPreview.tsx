import { cn } from "~/lib/cn";

export function TabsPreview({ tabs, className }: { tabs: boolean; className?: string }) {
  return (
    <div
      data-tabs-preview={tabs ? "on" : "off"}
      className={cn("flex h-20 gap-1.5 overflow-hidden rounded-lg border border-os-container bg-os-nav p-2", className)}
      aria-hidden
    >
      <div className="w-1/4 rounded bg-os-container" />
      <div className="flex flex-1 flex-col gap-1.5">
        {tabs && (
          <div data-preview-tabs className="flex gap-1">
            <div className="h-2.5 w-1/4 rounded-sm bg-os-card shadow-[0_1px_1px_var(--color-os-hover)]" />
            <div className="h-2.5 w-1/5 rounded-sm bg-os-container" />
            <div className="h-2.5 w-1/5 rounded-sm bg-os-container" />
          </div>
        )}
        <div className="h-2 w-2/3 rounded-full bg-os-container-hi" />
        <div className="flex-1 rounded bg-os-card" />
      </div>
    </div>
  );
}
