import { cn } from "~/lib/cn";

export type Channel = "inApp" | "desktop" | "slackDm" | "email";

const line = "h-1 rounded-full bg-os-container-hi";

export function ChannelPreview({ channel, className }: { channel: Channel; className?: string }) {
  return (
    <div
      data-channel-preview={channel}
      className={cn("relative h-9 w-14 overflow-hidden rounded-md border border-os-container bg-os-nav", className)}
      aria-hidden
    >
      {channel === "inApp" && (
        <>
          <div className="absolute inset-y-1 left-1 w-2.5 rounded-sm bg-os-container" />
          <div className="absolute right-1 top-1 flex w-7 flex-col gap-0.5 rounded-sm bg-os-card p-0.5 shadow-[0_1px_2px_var(--color-os-hover)]">
            <div className="flex items-center gap-0.5">
              <div className="h-1 w-1 shrink-0 rounded-full bg-os-accent" />
              <div className={cn(line, "flex-1")} />
            </div>
            <div className={cn(line, "ml-1.5 w-3/5 bg-os-container")} />
            <div className={cn(line, "ml-1.5 w-1/2 bg-os-container")} />
          </div>
        </>
      )}
      {channel === "desktop" && (
        <>
          <div className="absolute inset-x-0 top-0 h-1 bg-os-container" />
          <div className="absolute right-1 top-2 flex w-8 items-center gap-0.5 rounded-sm bg-os-card p-0.5 shadow-[0_1px_2px_var(--color-os-hover)]">
            <div className="h-2.5 w-2.5 shrink-0 rounded-[2px] bg-os-accent" />
            <div className="flex flex-1 flex-col gap-0.5">
              <div className={cn(line, "w-full")} />
              <div className={cn(line, "w-2/3 bg-os-container")} />
            </div>
          </div>
        </>
      )}
      {channel === "slackDm" && (
        <div className="flex h-full flex-col justify-center gap-1 px-1.5">
          {["w-6", "w-8"].map((w, i) => (
            <div key={w} className="flex items-center gap-1">
              <div className={cn("h-2 w-2 shrink-0 rounded-[2px]", i === 0 ? "bg-os-accent" : "bg-os-container-hi")} />
              <div className={cn(line, w)} />
            </div>
          ))}
        </div>
      )}
      {channel === "email" && (
        <div className="absolute inset-x-2.5 inset-y-1.5 overflow-hidden rounded-sm bg-os-card">
          <div className="absolute inset-x-0 top-0 h-3/5 bg-os-container-hi [clip-path:polygon(0_0,100%_0,50%_100%)]" />
        </div>
      )}
    </div>
  );
}
