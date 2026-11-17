import { Link } from "react-router";
import { ArrowLeft } from "lucide-react";
import { CoverTile, cardColorHex, coverGround, parseCover } from "~/components/cover/CoverPattern";
import { GeneratedArt } from "~/components/cover/GeneratedArt";
import { PANE_BLEED_TOP_CLASS } from "~/components/shell/pane-gutter";
import { cn } from "~/lib/cn";

export function HubHeader({
  title,
  domainName,
  coverUrl,
  published,
}: {
  title: string;
  domainName: string | null;
  coverUrl: string | null;
  published: boolean;
}) {
  const parsed = parseCover(coverUrl);
  return (
    <header
      data-testid="hub-band"
      style={parsed ? { backgroundColor: cardColorHex(parsed.card) } : undefined}
      className={cn("flex min-h-[176px] gap-6 bg-os-band p-6 text-os-on-band", PANE_BLEED_TOP_CLASS)}
    >
      <div className="flex min-w-0 flex-1 flex-col justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <Link
            to="/resource-hub"
            className="inline-flex w-fit items-center gap-1.5 rounded-full border border-os-band-line bg-os-band-chip px-2.5 py-1 text-xs font-medium text-os-on-band"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
            Resource Hub
          </Link>
          <h1 className="font-heading text-[32px] font-semibold tracking-[-0.02em] text-os-on-band [overflow-wrap:anywhere]">{title}</h1>
          {domainName && <p className="text-sm text-os-on-band-meta">{domainName}</p>}
        </div>
        {!published && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex h-[26px] items-center rounded-full border border-os-band-line bg-os-band-chip px-2.5 text-xs font-semibold text-os-on-band">
              Draft
            </span>
          </div>
        )}
      </div>
      <div className="hidden h-[128px] w-[342px] shrink-0 overflow-hidden rounded-xl md:block">
        {parsed ? (
          <div className="h-full w-full" style={{ backgroundColor: coverGround(coverUrl!) }}>
            <CoverTile url={coverUrl!} />
          </div>
        ) : coverUrl ? (
          <img src={coverUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <GeneratedArt />
        )}
      </div>
    </header>
  );
}
