import type { ReactNode } from "react";
import { Link } from "react-router";
import { ArrowLeft } from "lucide-react";
import { CoverTile, cardColorHex, coverGround, parseCover } from "./CoverPattern";

/** The hub's title beside its art. "band" sits inside the full-bleed header; "preview" is a standalone card. */
export function HubCard({
  cover,
  title,
  draft = false,
  action,
  size = "band",
  inset = false,
}: {
  cover: string;
  title: ReactNode;
  draft?: boolean;
  action?: ReactNode;
  size?: "band" | "preview";
  /** Start at the document column (past the editor's side-menu gutter) so the title lines up with the page text. */
  inset?: boolean;
}) {
  const parsed = parseCover(cover);
  if (!parsed) return null;
  const band = size === "band";
  const Title = band ? "h1" : "p";
  return (
    <div
      style={band ? undefined : { backgroundColor: cardColorHex(parsed.card) }}
      className={`flex gap-4 text-white ${band ? (inset ? "pb-8 pl-9 pr-6 pt-2 sm:pl-[94px] sm:pr-10" : "px-6 pb-8 pt-2 sm:px-10") : "overflow-hidden rounded-os-card p-3"}`}
    >
      <div className="flex min-w-0 flex-1 flex-col justify-between gap-4">
        <div className="min-w-0">
          <Title className={`font-heading font-semibold leading-tight [overflow-wrap:anywhere] ${band ? "text-4xl md:text-5xl" : "text-xl"}`}>{title}</Title>
          {draft && <p className="mt-1 text-xs text-white/60">Draft</p>}
        </div>
        {action}
      </div>
      <div className="aspect-[8/3] w-2/5 shrink-0 overflow-hidden rounded-xl sm:w-1/2" style={{ background: coverGround(cover) }}>
        <CoverTile url={cover} />
      </div>
    </div>
  );
}

/** The hub's header on the tabs that don't edit it, so it stays put as the tab changes. */
export function HubBand({ cover, title, published }: { cover: string | null; title: string; published: boolean }) {
  const parsed = parseCover(cover);
  const back = (dark: boolean) => (
    <Link
      to="/resource-hub"
      className={`inline-flex items-center gap-1.5 text-sm ${dark ? "rounded-full bg-white/10 px-2.5 py-1 text-white hover:bg-white/15" : "text-os-grey hover:text-foreground"}`}
    >
      <ArrowLeft className="h-4 w-4" aria-hidden />
      Resource Hub
    </Link>
  );
  if (parsed) {
    return (
      <div className="-mx-6 text-white sm:-mx-10" style={{ backgroundColor: cardColorHex(parsed.card) }}>
        <div className="flex min-h-[68px] items-center gap-3 px-6 sm:px-10">{back(true)}</div>
        <HubCard cover={cover as string} title={title} draft={!published} />
      </div>
    );
  }
  return (
    <>
      <div className="-mx-6 flex items-center gap-3 border-b border-os-container px-6 py-3 sm:-mx-10 sm:px-10">{back(false)}</div>
      {cover && <img src={cover} alt="" className="-mx-6 mt-0 aspect-[16/5] w-[calc(100%+3rem)] max-w-none object-cover sm:-mx-10 sm:w-[calc(100%+5rem)]" />}
      <h1 className="pt-6 font-heading text-4xl font-semibold text-foreground md:text-5xl [overflow-wrap:anywhere]">{title}</h1>
    </>
  );
}
