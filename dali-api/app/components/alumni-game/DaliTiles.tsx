// DALI's signature tile illustration (see the DALI design system's
// TilePattern): flush square tiles in high-contrast brand pairs, each with one
// abstract motif, clustered organically with a few loose dots. Pure CSS
// animation; decorative only.

type Motif = "circle" | "ring" | "flower" | "quarter" | "solid" | "asterisk";

type Tile = { x: number; y: number; bg: string; fg: string; m: Motif };
type Dot = { x: number; y: number; color: string };

const TEAL = "#24B1B1";
const NAVY = "#0C4876";
const DARK_NAVY = "#083858";
const CORAL = "#E45768";
const YELLOW = "#FFCF88";
const PALE_BLUE = "#D4EDFF";
const PALE_TEAL = "#8CE0D6";
const LIGHT_YELLOW = "#FFF3B5";

const CLUSTERS: Record<"tr" | "bl", { tiles: Tile[]; dots: Dot[] }> = {
  tr: {
    tiles: [
      { x: 2, y: 0, bg: TEAL, fg: "#ffffff", m: "flower" },
      { x: 3, y: 0, bg: LIGHT_YELLOW, fg: CORAL, m: "circle" },
      { x: 4, y: 0, bg: NAVY, fg: "#ffffff", m: "ring" },
      { x: 1, y: 1, bg: PALE_BLUE, fg: NAVY, m: "asterisk" },
      { x: 2, y: 1, bg: CORAL, fg: "#ffffff", m: "quarter" },
      { x: 3, y: 1, bg: PALE_TEAL, fg: DARK_NAVY, m: "circle" },
      { x: 4, y: 1, bg: YELLOW, fg: DARK_NAVY, m: "flower" },
      { x: 3, y: 2, bg: NAVY, fg: "#ffffff", m: "solid" },
      { x: 4, y: 2, bg: LIGHT_YELLOW, fg: TEAL, m: "ring" },
    ],
    dots: [
      { x: 0.4, y: 0.5, color: CORAL },
      { x: 1.5, y: 2.4, color: TEAL },
      { x: 2.5, y: 2.6, color: YELLOW },
    ],
  },
  bl: {
    tiles: [
      { x: 0, y: 0, bg: PALE_TEAL, fg: DARK_NAVY, m: "ring" },
      { x: 1, y: 0, bg: CORAL, fg: "#ffffff", m: "flower" },
      { x: 0, y: 1, bg: NAVY, fg: "#ffffff", m: "quarter" },
      { x: 1, y: 1, bg: LIGHT_YELLOW, fg: NAVY, m: "asterisk" },
      { x: 2, y: 1, bg: TEAL, fg: "#ffffff", m: "circle" },
      { x: 0, y: 2, bg: YELLOW, fg: DARK_NAVY, m: "circle" },
      { x: 1, y: 2, bg: PALE_BLUE, fg: CORAL, m: "flower" },
      { x: 2, y: 2, bg: NAVY, fg: "#ffffff", m: "ring" },
      { x: 3, y: 2, bg: LIGHT_YELLOW, fg: TEAL, m: "solid" },
    ],
    dots: [
      { x: 3.5, y: 1.4, color: CORAL },
      { x: 2.6, y: 0.4, color: NAVY },
      { x: 4.2, y: 2.5, color: TEAL },
    ],
  },
};

function MotifShape({ m, fg }: { m: Motif; fg: string }) {
  switch (m) {
    case "circle":
      return <circle cx="20" cy="20" r="11" fill={fg} />;
    case "ring":
      return <circle cx="20" cy="20" r="10" fill="none" stroke={fg} strokeWidth="6" />;
    case "flower":
      return (
        <g fill={fg}>
          <circle cx="20" cy="11.5" r="6.5" />
          <circle cx="20" cy="28.5" r="6.5" />
          <circle cx="11.5" cy="20" r="6.5" />
          <circle cx="28.5" cy="20" r="6.5" />
        </g>
      );
    case "quarter":
      return <path d="M8 32 L8 8 A24 24 0 0 1 32 32 Z" fill={fg} />;
    case "solid":
      return <rect x="10" y="10" width="20" height="20" fill={fg} />;
    case "asterisk":
      return (
        <g stroke={fg} strokeWidth="5" strokeLinecap="round">
          <line x1="20" y1="7" x2="20" y2="33" />
          <line x1="8.7" y1="13.5" x2="31.3" y2="26.5" />
          <line x1="8.7" y1="26.5" x2="31.3" y2="13.5" />
        </g>
      );
  }
}

export function DaliTiles({ corner }: { corner: "tr" | "bl" }) {
  const { tiles, dots } = CLUSTERS[corner];
  const size = 44;
  return (
    <div className={`ag-tiles ag-tiles--${corner}`} aria-hidden>
      {tiles.map((t, i) => (
        <div
          key={`t${i}`}
          className="ag-tile"
          style={{
            left: t.x * size,
            top: t.y * size,
            width: size,
            height: size,
            background: t.bg,
            ["--i" as never]: i,
          }}
        >
          <svg viewBox="0 0 40 40" width={size - 8} height={size - 8}>
            <MotifShape m={t.m} fg={t.fg} />
          </svg>
        </div>
      ))}
      {dots.map((d, i) => (
        <span
          key={`d${i}`}
          className="ag-tile-dot"
          style={{
            left: d.x * size,
            top: d.y * size,
            background: d.color,
            ["--i" as never]: tiles.length + i,
          }}
        />
      ))}
    </div>
  );
}
