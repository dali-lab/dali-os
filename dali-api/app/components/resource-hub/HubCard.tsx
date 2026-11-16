import type { ReactNode } from "react";
import { CoverTile, cardColorHex, coverGround, parseCover } from "~/components/cover/CoverPattern";

export function HubCard({ cover, title }: { cover: string; title: ReactNode }) {
  const parsed = parseCover(cover);
  if (!parsed) return null;
  return (
    <div
      style={{ backgroundColor: cardColorHex(parsed.card) }}
      className="flex gap-4 overflow-hidden rounded-os-card p-3 text-[var(--os-on-art-ink)]"
    >
      <p className="min-w-0 flex-1 font-heading text-xl font-semibold leading-tight [overflow-wrap:anywhere]">{title}</p>
      <div className="aspect-[8/3] w-1/2 shrink-0 overflow-hidden rounded-xl" style={{ background: coverGround(cover) }}>
        <CoverTile url={cover} />
      </div>
    </div>
  );
}
