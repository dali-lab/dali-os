import { CoverTile, cardColorHex, coverGround, parseCover } from "./CoverPattern";

export function CoverThumb({ url, className }: { url: string; className?: string }) {
  const parsed = parseCover(url);
  if (!parsed) return null;
  return (
    <div
      data-testid="cover-thumb"
      className={className}
      style={{ backgroundColor: cardColorHex(parsed.card), overflow: "hidden" }}
    >
      <div className="h-full w-full" style={{ backgroundColor: coverGround(url) }}>
        <CoverTile url={url} />
      </div>
    </div>
  );
}
