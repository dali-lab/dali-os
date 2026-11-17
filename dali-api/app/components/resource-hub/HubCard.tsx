import type { ReactNode } from "react";
import { Link } from "react-router";
import { ArrowRight } from "lucide-react";
import { CoverTile, cardColorHex, coverGround, isPatternCover, parseCover } from "~/components/cover/CoverPattern";

function CoverArt({ cover }: { cover: string | null }) {
  if (isPatternCover(cover)) {
    return (
      <div className="w-[44%] shrink-0 self-stretch overflow-hidden rounded-xl" style={{ background: coverGround(cover) }}>
        <CoverTile url={cover} />
      </div>
    );
  }
  return (
    <div className="w-[44%] shrink-0 self-stretch overflow-hidden rounded-xl">
      <div
        className="h-full min-h-[8rem] w-full bg-os-hover bg-cover bg-center"
        style={{ backgroundImage: cover ? `url(${cover})` : undefined }}
        aria-hidden
      />
    </div>
  );
}

export function HubCard({
  cover,
  title,
  href,
  draft,
}: {
  cover: string | null;
  title: ReactNode;
  href?: string;
  draft?: boolean;
}) {
  if (href) {
    return (
      <Link
        to={href}
        style={{ backgroundColor: cardColorHex(parseCover(cover)?.card) }}
        className="group flex h-full min-h-[13rem] gap-4 overflow-hidden rounded-os-card p-4 text-[var(--os-on-art-ink)] outline-none transition-[filter,transform] duration-150 ease-out hover:brightness-110 active:scale-[0.99] focus-visible:ring-2 focus-visible:ring-os-accent/70 focus-visible:ring-offset-2 focus-visible:ring-offset-os-card"
      >
        <div className="flex min-w-0 flex-1 flex-col justify-between gap-4">
          <div className="min-w-0">
            <h2 className="font-heading text-xl font-semibold leading-tight [overflow-wrap:anywhere]">{title}</h2>
            {draft && <p className="mt-1 text-xs opacity-60">Draft</p>}
          </div>
          <span
            aria-hidden
            className="grid h-9 w-9 place-items-center rounded-full border border-current/50 transition-colors duration-150 group-hover:bg-current/10"
          >
            <ArrowRight className="h-4 w-4 transition-transform duration-150 ease-out group-hover:translate-x-0.5" />
          </span>
        </div>
        <CoverArt cover={cover} />
      </Link>
    );
  }
  const parsed = parseCover(cover ?? "");
  if (!parsed) return null;
  return (
    <div
      style={{ backgroundColor: cardColorHex(parsed.card) }}
      className="flex gap-4 overflow-hidden rounded-os-card p-3 text-[var(--os-on-art-ink)]"
    >
      <p className="min-w-0 flex-1 font-heading text-xl font-semibold leading-tight [overflow-wrap:anywhere]">{title}</p>
      <div className="aspect-[8/3] w-1/2 shrink-0 overflow-hidden rounded-xl" style={{ background: coverGround(cover!) }}>
        <CoverTile url={cover!} />
      </div>
    </div>
  );
}
