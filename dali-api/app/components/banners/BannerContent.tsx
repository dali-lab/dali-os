import { useId, useState } from "react";
import { ArrowUpRight, Image as ImageIcon, X } from "lucide-react";
import { Modal } from "~/components/Modal";
import { Checkbox } from "~/components/ui/Checkbox";
import { useOsChrome } from "~/components/os-chrome";
import { cn } from "~/lib/cn";
import { snoozeOffered, type BannerFrequency, type BannerKind, type BannerTone } from "~/core/lib/banners";

export type BannerView = {
  name: string;
  kind: BannerKind;
  mediaUrl: string | null;
  videoUrl: string | null;
  headline: string;
  body: string;
  ctaLabel: string;
  ctaUrl: string;
  tone: BannerTone;
  frequency: BannerFrequency;
  allowSnooze: boolean;
  author: string;
};

const TONE_SURFACE: Record<BannerTone, string> = {
  Accent: "bg-os-accent text-os-bg",
  Amber: "bg-os-amber text-os-bg",
  Card: "bg-os-card text-foreground",
};

export const BANNER_CARD_WIDTH = 880;

/** The banner's own content. `inert` keeps the editor preview from playing or navigating. */
export function BannerContent({
  banner,
  inert = false,
  onCta,
}: {
  banner: BannerView;
  inert?: boolean;
  onCta?: () => void;
}) {
  const os = useOsChrome();
  const onTone = banner.kind === "Text" && banner.tone !== "Card";
  const hasText = Boolean(banner.headline || banner.body || banner.ctaLabel);

  const text = hasText && (
    <div className="flex flex-col gap-3">
      {banner.headline && (
        <h2
          className={cn(
            "font-heading font-semibold leading-tight",
            banner.kind === "Text" ? "text-4xl md:text-5xl" : "text-3xl",
            onTone ? "text-os-bg" : "text-foreground",
          )}
        >
          {banner.headline}
        </h2>
      )}
      {banner.body && (
        <p className={cn("max-w-prose whitespace-pre-line text-base leading-relaxed", onTone ? "text-os-bg/80" : "text-os-grey")}>
          {banner.body}
        </p>
      )}
      {banner.ctaLabel && (
        <div className="mt-2">
          <a
            href={inert ? undefined : banner.ctaUrl || undefined}
            target={banner.ctaUrl.startsWith("https://") ? "_blank" : undefined}
            rel="noreferrer"
            onClick={(e) => {
              if (inert) e.preventDefault();
              else onCta?.();
            }}
            className={
              onTone
                ? "inline-flex items-center gap-1.5 rounded-full bg-os-bg px-4 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-os-nav"
                : cn(os.actionBtnPrimary, "px-4 py-2")
            }
          >
            {banner.ctaLabel}
            <ArrowUpRight className="h-4 w-4" />
          </a>
        </div>
      )}
    </div>
  );

  const media = (aspect: string) =>
    banner.mediaUrl ? (
      <img src={banner.mediaUrl} alt={banner.headline || banner.name} className={cn("h-full w-full object-cover", aspect)} />
    ) : (
      <div className={cn("flex h-full w-full flex-col items-center justify-center gap-2 bg-os-well text-sm text-os-muted", aspect)}>
        <ImageIcon className="h-6 w-6" />
        Add an image
      </div>
    );

  if (banner.kind === "Text") {
    return <div className={cn("px-8 py-12 md:px-14 md:py-16", TONE_SURFACE[banner.tone])}>{text}</div>;
  }
  if (banner.kind === "Poster") {
    return (
      <div className="grid bg-os-card md:grid-cols-[minmax(0,0.85fr)_minmax(0,1fr)]">
        <div className="max-h-[70vh] bg-os-well">{media("aspect-[3/4]")}</div>
        {text && <div className="flex flex-col justify-center p-8 md:p-10">{text}</div>}
      </div>
    );
  }
  if (banner.kind === "Video") {
    return (
      <div className="bg-os-card">
        {banner.videoUrl ? (
          <video
            key={banner.videoUrl}
            src={banner.videoUrl}
            poster={banner.mediaUrl || undefined}
            controls={!inert}
            autoPlay={!inert}
            muted
            playsInline
            className="aspect-video w-full bg-black object-cover"
          />
        ) : (
          media("aspect-video")
        )}
        {text && <div className="p-8">{text}</div>}
      </div>
    );
  }
  return (
    <div className="bg-os-card">
      <div className="max-h-[50vh] overflow-hidden">{media("aspect-[16/9]")}</div>
      {text && <div className="p-8">{text}</div>}
    </div>
  );
}

/** The footer under the content: the snooze checkbox (when offered) or who it's from, and Close. */
export function BannerFooter({
  banner,
  snooze,
  onSnoozeChange,
  onClose,
}: {
  banner: BannerView;
  snooze?: boolean;
  onSnoozeChange?: (v: boolean) => void;
  onClose?: () => void;
}) {
  const os = useOsChrome();
  return (
    <div className="flex items-center justify-between gap-4 border-t border-os-container/70 bg-os-card px-6 py-4">
      {snoozeOffered(banner) ? (
        <Checkbox
          tone="os"
          checked={snooze ?? false}
          onChange={(e) => onSnoozeChange?.(e.target.checked)}
          disabled={!onSnoozeChange}
          label={<span className="text-sm text-os-grey">Don't show again today</span>}
        />
      ) : (
        <span className="text-xs text-os-muted">From {banner.author}</span>
      )}
      <button type="button" className={os.actionBtn()} onClick={onClose} tabIndex={onClose ? undefined : -1}>
        Close
      </button>
    </div>
  );
}

/** The full-screen banner over DALI OS. In preview it says so and records nothing. */
export function BannerOverlay({
  banner,
  preview = false,
  onClose,
  onCta,
}: {
  banner: BannerView;
  preview?: boolean;
  onClose: (snoozeToday: boolean) => void;
  onCta?: () => void;
}) {
  const titleId = useId();
  const [snooze, setSnooze] = useState(false);
  return (
    <Modal
      open
      onClose={() => onClose(false)}
      labelledBy={titleId}
      className="fixed inset-0 z-[60] flex items-center justify-center overflow-y-auto bg-black/70 p-4 md:p-8"
      containerClassName="relative my-auto w-full max-w-[880px] overflow-hidden rounded-os-card border border-os-container bg-os-card shadow-[0_32px_80px_rgba(0,0,0,0.6)]"
    >
      <span id={titleId} className="sr-only">
        {banner.headline || banner.name}
      </span>
      <button
        type="button"
        onClick={() => onClose(snooze)}
        aria-label="Close banner"
        className="absolute right-4 top-4 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-black/50 text-white transition-colors hover:bg-black/70"
      >
        <X className="h-4 w-4" />
      </button>
      {preview && (
        <span className="absolute left-4 top-4 z-10 rounded-full bg-black/60 px-3 py-1 text-xs font-semibold text-white">
          Preview. This is what viewers see
        </span>
      )}
      <BannerContent banner={banner} onCta={onCta} />
      <BannerFooter banner={banner} snooze={snooze} onSnoozeChange={setSnooze} onClose={() => onClose(snooze)} />
    </Modal>
  );
}
