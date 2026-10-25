import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";
import { Eye, Plus } from "lucide-react";
import { SegmentedTabButtons } from "~/components/AreaPillNav";
import { IconButton } from "~/components/ui/IconButton";
import { useOsChrome } from "~/components/os-chrome";
import { BannerOverlay } from "~/components/banners/BannerContent";
import { Pill } from "~/hiring/components/cycle-setup/SetupCard";
import { cn } from "~/lib/cn";
import {
  BANNER_ROLE_LABELS,
  FREQUENCY_LABEL,
  STATUS_DOT,
  STATUS_LABEL,
  bannerStatus,
  pageLabel,
  type BannerStatus,
} from "~/core/lib/banners";
import type { BannerDTO, BannerStats } from "~/core/lib/banners.server";

type Row = BannerDTO & { stats: BannerStats };
type Filter = "all" | BannerStatus;

const KIND_TEXT: Record<BannerDTO["kind"], string> = { Image: "Image", Poster: "Poster", Video: "Video", Text: "Text" };
const DAY: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };

export function audienceLabel(b: Pick<BannerDTO, "everyone" | "roles" | "groupIds">, groupName: (id: string) => string) {
  if (b.everyone) return "Everyone";
  const labels = [...b.roles.map((r) => BANNER_ROLE_LABELS[r]), ...b.groupIds.map(groupName)];
  if (labels.length === 0) return "No one yet";
  return labels.length > 2 ? `${labels.slice(0, 2).join(", ")} +${labels.length - 2}` : labels.join(", ");
}

export function BannersList({
  data,
}: {
  data: { banners: Row[]; groups: { id: string; name: string }[]; now: string };
}) {
  const os = useOsChrome();
  const navigate = useNavigate();
  const [filter, setFilter] = useState<Filter>("all");
  const [preview, setPreview] = useState<Row | null>(null);
  const now = useMemo(() => new Date(data.now), [data.now]);
  const groupName = (id: string) => data.groups.find((g) => g.id === id)?.name ?? "A group";

  const withStatus = useMemo(() => data.banners.map((b) => ({ ...b, status: bannerStatus(b, now) })), [data.banners, now]);
  const count = (s: BannerStatus) => withStatus.filter((b) => b.status === s).length;
  const visible = filter === "all" ? withStatus : withStatus.filter((b) => b.status === filter);
  const filters: { value: Filter; label: string; count: number }[] = [
    { value: "all", label: "All", count: withStatus.length },
    { value: "live", label: "Live", count: count("live") },
    { value: "scheduled", label: "Scheduled", count: count("scheduled") },
    { value: "draft", label: "Drafts", count: count("draft") },
    { value: "ended", label: "Ended", count: count("ended") },
  ];

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SegmentedTabButtons
          label="Banner status"
          items={filters.map((f) => ({ label: f.label, count: f.count, active: filter === f.value, onClick: () => setFilter(f.value) }))}
        />
        <button type="button" className="os-add-btn" onClick={() => navigate("/core/communications/banners/new")}>
          <Plus className="h-4 w-4" strokeWidth={3} /> New banner
        </button>
      </div>

      <p className={os.bodyText}>
        Banners take over the screen when people open DALI OS or visit a page. They can close it, and can choose to hide
        it for the rest of the day.
      </p>

      <ul className={cn(os.panel, "overflow-hidden")}>
        {visible.map((b, i) => (
          <li
            key={b.id}
            className={cn("flex items-center gap-2 pr-4 transition-colors hover:bg-os-card-hover", i > 0 && "border-t border-os-container/70")}
          >
            <Link to={`/core/communications/banners/${b.id}`} className="flex min-w-0 flex-1 items-center gap-5 py-4 pl-6">
              <Thumb banner={b} />
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="truncate font-semibold text-foreground">{b.name}</span>
                  <Pill dot={STATUS_DOT[b.status]}>{STATUS_LABEL[b.status]}</Pill>
                </span>
                <span className="mt-0.5 block truncate text-sm text-os-grey">
                  {KIND_TEXT[b.kind]} · {audienceLabel(b, groupName)} ·{" "}
                  {new Date(b.startsAt).toLocaleDateString("en-US", DAY)} to {new Date(b.endsAt).toLocaleDateString("en-US", DAY)}
                </span>
                <span className="mt-0.5 block truncate text-xs text-os-muted">
                  {b.trigger === "AppOpen" ? "On opening DALI OS" : `On visiting ${pageLabel(b.triggerPath)}`} ·{" "}
                  {FREQUENCY_LABEL[b.frequency]} · by {b.author}
                </span>
              </span>
              <span className="hidden w-48 shrink-0 grid-cols-3 gap-3 text-right lg:grid">
                <Stat label="Views" value={b.stats.views} />
                <Stat label="Clicks" value={b.stats.clicks} />
                <Stat label="Hid today" value={b.stats.snoozes} />
              </span>
            </Link>
            <IconButton label={`Preview ${b.name}`} icon={Eye} onClick={() => setPreview(b)} />
          </li>
        ))}
        {visible.length === 0 && (
          <li className="px-6 py-14 text-center text-sm text-os-muted">
            {withStatus.length === 0 ? "No banners yet." : "No banners here."}
          </li>
        )}
      </ul>

      {preview && <BannerOverlay banner={preview} preview onClose={() => setPreview(null)} />}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <span>
      <span className="block text-sm tabular-nums text-foreground">{value.toLocaleString()}</span>
      <span className="block whitespace-nowrap text-[11px] text-os-muted">{label}</span>
    </span>
  );
}

function Thumb({ banner }: { banner: BannerDTO }) {
  if (banner.kind === "Text" || !banner.mediaUrl) {
    const tone =
      banner.tone === "Accent" ? "bg-os-accent text-os-bg" : banner.tone === "Amber" ? "bg-os-amber text-os-bg" : "bg-os-well text-foreground";
    return (
      <span className={cn("flex h-[72px] w-28 shrink-0 items-center overflow-hidden rounded-lg p-2.5 font-heading text-[11px] font-semibold leading-tight", tone)}>
        <span className="line-clamp-3">{banner.headline || "Text banner"}</span>
      </span>
    );
  }
  return <img src={banner.mediaUrl} alt="" className="h-[72px] w-28 shrink-0 rounded-lg object-cover" />;
}
