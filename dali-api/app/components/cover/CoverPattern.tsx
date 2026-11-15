import { useId, type ReactNode } from "react";

// Built-in pattern covers on a 10-unit cell grid. A cover stored as `pattern:<id>`
// renders one of these; anything else is an uploaded image URL.

const C = {
  coral: "var(--art-coral)",
  peach: "var(--color-accent-coral-light)",
  apricot: "var(--art-apricot)",
  butter: "var(--art-butter)",
  sage: "var(--art-sage)",
  teal: "var(--art-teal)",
  aqua: "var(--color-accent-teal-light)",
  navy: "var(--color-navy)",
  orchid: "var(--art-orchid)",
  pink: "var(--color-accent-pink)",
  mist: "var(--art-mist)",
};

const U = 10;
const sq = (c: number, r: number, fill: string) => (
  <rect key={`s${c}-${r}`} x={c * U} y={r * U} width={U} height={U} fill={fill} />
);
const dot = (c: number, r: number, fill: string, rad = 3.6) => (
  <circle key={`d${c}-${r}-${fill}`} cx={c * U + U / 2} cy={r * U + U / 2} r={rad} fill={fill} />
);
// Quarter disc filling the cell, its center at the given corner.
const quarter = (c: number, r: number, fill: string, corner: "tl" | "tr" | "br" | "bl") => {
  const rot = { tl: 0, tr: 90, br: 180, bl: 270 }[corner];
  const x = c * U;
  const y = r * U;
  return (
    <path
      key={`q${c}-${r}`}
      d={`M${x} ${y}H${x + U}A${U} ${U} 0 0 1 ${x} ${y + U}Z`}
      fill={fill}
      transform={`rotate(${rot} ${x + U / 2} ${y + U / 2})`}
    />
  );
};
const semi = (c: number, r: number, fill: string) => (
  <path key={`h${c}-${r}`} d={`M${c * U} ${(r + 1) * U}A${U / 2} ${U / 2} 0 0 1 ${(c + 1) * U} ${(r + 1) * U}Z`} fill={fill} />
);
const flower = (c: number, r: number, fill: string) => {
  const cx = c * U + U / 2;
  const cy = r * U + U / 2;
  return (
    <g key={`f${c}-${r}`} fill={fill}>
      {[0, 90, 180, 270].map((a) => (
        <ellipse key={a} cx={cx} cy={cy - 2.6} rx={1.7} ry={3} transform={`rotate(${a + 45} ${cx} ${cy})`} />
      ))}
      <circle cx={cx} cy={cy} r={1} fill="var(--os-on-art-ink)" />
    </g>
  );
};
const star = (c: number, r: number, fill: string) => {
  const cx = c * U + U / 2;
  const cy = r * U + U / 2;
  return (
    <g key={`*${c}-${r}`} stroke={fill} strokeWidth={1.2} strokeLinecap="butt">
      {[0, 45, 90, 135].map((a) => (
        <line key={a} x1={cx} y1={cy - 4} x2={cx} y2={cy + 4} transform={`rotate(${a} ${cx} ${cy})`} />
      ))}
    </g>
  );
};

type TitleBox = { left: number; top: number; width: number; height: number; align?: "left" | "center" };
type Pattern = { id: string; name: string; ground: string; title: TitleBox; shapes: ReactNode };

const quietDots: ReactNode[] = [];
for (let c = 1; c < 16; c += 2) for (let r = 0; r < 5; r += 2) quietDots.push(<circle key={`g${c}-${r}`} cx={c * U} cy={r * U + U / 2} r={0.7} fill={C.mist} />);

export const COVER_PATTERNS: Pattern[] = [
  {
    id: "quiet-grid",
    name: "Quiet grid",
    ground: "var(--art-ground-lilac)",
    title: { left: 6, top: 14, width: 58, height: 72 },
    shapes: [...quietDots, sq(14, 0, C.butter), sq(15, 1, C.mist), dot(14, 1, C.peach, 2.4), dot(15, 1, C.navy, 2.4)],
  },
  {
    id: "corner-tiles",
    name: "Corner tiles",
    ground: "var(--art-ground-mint)",
    title: { left: 6, top: 14, width: 62, height: 72 },
    shapes: [
      sq(12, 0, C.apricot), dot(12, 0, C.orchid), sq(13, 0, C.butter), flower(13, 0, C.teal), dot(15, 0, C.aqua),
      star(12, 1, C.apricot), sq(13, 1, C.sage), dot(13, 1, C.peach), sq(14, 1, C.navy), dot(14, 1, C.orchid),
      sq(12, 2, C.pink), dot(12, 2, C.navy),
    ],
  },
  {
    id: "petal-ledger",
    name: "Petal ledger",
    ground: "var(--art-ground-blush)",
    title: { left: 6, top: 6, width: 88, height: 54 },
    shapes: [
      sq(0, 4, C.aqua), dot(0, 4, C.navy), quarter(1, 4, C.coral, "bl"), sq(2, 4, C.butter), dot(2, 4, C.peach),
      semi(3, 4, C.sage), sq(4, 4, C.apricot), flower(4, 4, C.teal), dot(5, 4, C.pink), sq(6, 4, C.navy), dot(6, 4, C.orchid),
      quarter(7, 4, C.teal, "tr"), sq(8, 4, C.aqua), dot(8, 4, C.navy), quarter(9, 4, C.coral, "bl"), sq(10, 4, C.butter),
      dot(10, 4, C.peach), semi(11, 4, C.sage), sq(12, 4, C.apricot), flower(12, 4, C.teal), dot(13, 4, C.pink),
      sq(14, 4, C.navy), dot(14, 4, C.orchid), quarter(15, 4, C.teal, "tr"),
    ],
  },
  {
    id: "block-party",
    name: "Block party",
    ground: "var(--art-ground-sky)",
    title: { left: 6, top: 14, width: 40, height: 72 },
    shapes: [
      sq(8, 0, C.apricot), dot(8, 0, C.orchid), sq(9, 0, C.butter), flower(9, 0, C.teal), dot(11, 0, C.aqua), sq(12, 0, C.pink), dot(12, 0, C.navy),
      star(8, 1, C.apricot), sq(9, 1, C.sage), dot(9, 1, C.peach), sq(10, 1, C.navy), dot(10, 1, C.orchid), quarter(12, 1, C.coral, "bl"), sq(13, 1, C.butter), dot(13, 1, C.peach),
      sq(9, 2, C.pink), dot(9, 2, C.navy), sq(11, 2, C.aqua), dot(11, 2, C.navy), semi(12, 2, C.sage), sq(14, 2, C.apricot), dot(14, 2, C.teal),
      dot(8, 3, C.coral), sq(10, 3, C.butter), dot(10, 3, C.peach), quarter(11, 3, C.coral, "tl"), sq(13, 3, C.sage), flower(13, 3, C.butter), dot(15, 3, C.pink),
    ],
  },
  {
    id: "orbit-field",
    name: "Orbit field",
    ground: "var(--art-ground-peach)",
    title: { left: 17, top: 14, width: 66, height: 72, align: "center" },
    shapes: [
      dot(0, 1, C.pink, 4), dot(1, 3, C.navy, 2.6), quarter(0, 4, C.apricot, "tr"), dot(2, 0, C.orchid, 2.6), dot(3, 4, C.aqua, 3.6),
      dot(15, 0, C.teal, 3.6), dot(14, 2, C.coral, 4), sq(15, 3, C.butter), dot(15, 3, C.orchid, 2.6), dot(13, 4, C.pink, 3), dot(12, 0, C.aqua, 3),
      quarter(14, 4, C.sage, "tl"), dot(1, 2, C.mist, 2),
    ],
  },
  {
    id: "poster",
    name: "Poster",
    ground: "var(--art-ground-sage)",
    title: { left: 29, top: 10, width: 62, height: 48 },
    shapes: [
      sq(0, 0, C.apricot), dot(0, 0, C.orchid), sq(1, 0, C.butter), flower(1, 0, C.teal), dot(3, 0, C.coral),
      sq(1, 1, C.sage), dot(1, 1, C.peach), sq(2, 1, C.navy), dot(2, 1, C.orchid), star(0, 1, C.apricot),
      sq(0, 2, C.pink), dot(0, 2, C.navy),
      dot(9, 4, C.pink), sq(10, 3, C.aqua), dot(10, 3, C.navy), quarter(11, 3, C.coral, "tl"), dot(13, 3, C.peach),
      sq(11, 4, C.butter), dot(11, 4, C.peach), semi(12, 3, C.sage), sq(12, 4, C.apricot), dot(12, 4, C.teal), sq(14, 4, C.sage), flower(14, 4, C.butter),
    ],
  },
];


// Tall-tile versions of the cover patterns (5 x 6 cells): same shapes and palette, composed to fill a card tile.
const quietTileDots: ReactNode[] = [];
for (let c = 1; c < 5; c++) for (let r = 1; r < 6; r++) quietTileDots.push(<circle key={`t${c}-${r}`} cx={c * U} cy={r * U} r={0.7} fill={C.mist} />);
const TILE_SHAPES: Record<string, ReactNode[]> = {
  "quiet-grid": [...quietTileDots, sq(3, 3, C.butter), sq(4, 4, C.mist), dot(3, 4, C.peach, 2.4), dot(4, 4, C.navy, 2.4), sq(0, 0, C.mist), dot(1, 0, C.peach, 2.4), sq(1, 5, C.aqua), dot(1, 5, C.navy, 2.4)],
  "corner-tiles": [
    sq(3, 0, C.apricot), dot(3, 0, C.orchid), sq(4, 0, C.butter), flower(4, 0, C.teal), star(3, 1, C.apricot), sq(4, 1, C.sage), dot(4, 1, C.peach), sq(3, 2, C.pink), dot(3, 2, C.navy), dot(4, 2, C.aqua),
    sq(0, 3, C.pink), dot(0, 3, C.navy), dot(1, 4, C.aqua), sq(0, 4, C.navy), dot(0, 4, C.orchid), sq(1, 5, C.sage), flower(1, 5, C.butter), sq(0, 5, C.apricot), dot(0, 5, C.orchid),
  ],
  "petal-ledger": [
    sq(0, 5, C.aqua), dot(0, 5, C.navy), quarter(1, 5, C.coral, "bl"), sq(2, 5, C.butter), dot(2, 5, C.peach), semi(3, 5, C.sage), sq(4, 5, C.apricot), flower(4, 5, C.teal),
    dot(0, 4, C.pink), sq(1, 4, C.navy), dot(1, 4, C.orchid), quarter(2, 4, C.teal, "tr"), sq(3, 4, C.aqua), dot(3, 4, C.navy), quarter(4, 4, C.coral, "bl"),
    sq(0, 3, C.butter), dot(0, 3, C.peach), semi(1, 3, C.sage), sq(3, 3, C.apricot), flower(3, 3, C.teal), dot(4, 3, C.pink), sq(2, 0, C.navy), dot(2, 0, C.orchid), quarter(3, 0, C.teal, "tr"),
  ],
  "block-party": [
    sq(0, 0, C.apricot), dot(0, 0, C.orchid), sq(1, 0, C.butter), flower(1, 0, C.teal), dot(3, 0, C.aqua), sq(4, 0, C.pink), dot(4, 0, C.navy),
    star(0, 1, C.apricot), sq(1, 1, C.sage), dot(1, 1, C.peach), sq(2, 1, C.navy), dot(2, 1, C.orchid), quarter(4, 1, C.coral, "bl"),
    sq(1, 2, C.pink), dot(1, 2, C.navy), sq(3, 2, C.aqua), dot(3, 2, C.navy), semi(4, 2, C.sage), dot(0, 3, C.coral), sq(2, 3, C.butter), dot(2, 3, C.peach), quarter(3, 3, C.coral, "tl"), flower(0, 4, C.butter), sq(0, 4, C.sage),
    sq(1, 4, C.apricot), dot(1, 4, C.teal), quarter(3, 4, C.teal, "tr"), sq(4, 4, C.butter), dot(4, 4, C.peach), dot(2, 5, C.pink), sq(3, 5, C.navy), dot(3, 5, C.orchid), semi(4, 5, C.sage),
  ],
  "orbit-field": [
    dot(0, 0, C.pink, 4), dot(2, 1, C.navy, 2.6), quarter(0, 2, C.apricot, "tr"), dot(3, 0, C.orchid, 2.6), dot(4, 1, C.aqua, 3.6),
    dot(1, 3, C.teal, 3.6), dot(3, 3, C.coral, 4), sq(4, 3, C.butter), dot(4, 3, C.orchid, 2.6), dot(2, 4, C.pink, 3), dot(0, 4, C.aqua, 3),
    quarter(4, 5, C.sage, "tl"), dot(1, 5, C.peach, 2.6), dot(3, 5, C.mist, 2), dot(2, 2, C.mist, 2),
  ],
  poster: [
    sq(0, 0, C.apricot), dot(0, 0, C.orchid), sq(1, 0, C.butter), flower(1, 0, C.teal), dot(3, 0, C.coral), sq(1, 1, C.sage), dot(1, 1, C.peach), sq(2, 1, C.navy), dot(2, 1, C.orchid), star(0, 1, C.apricot), sq(0, 2, C.pink), dot(0, 2, C.navy),
    dot(1, 4, C.pink), sq(2, 3, C.aqua), dot(2, 3, C.navy), quarter(3, 3, C.coral, "tl"), dot(4, 3, C.peach), sq(3, 4, C.butter), dot(3, 4, C.peach), semi(4, 4, C.sage), sq(2, 5, C.apricot), dot(2, 5, C.teal), sq(4, 5, C.sage), flower(4, 5, C.butter),
  ],
};

/** A pattern composed for a tall tile, for list cards. */
export function CoverTile({ url, className }: { url: string; className?: string }) {
  const parsed = parseCover(url);
  const p = parsed && COVER_PATTERNS.find((x) => x.id === parsed.id);
  const id = useId().replace(/:/g, "");
  if (!p) return null;
  const shapes = TILE_SHAPES[p.id];
  // Zoomed out: the 5 x 6 composition repeats, mirrored so the seams match, and fills a tile of any proportion.
  const mirrors = [
    { x: 0, y: 0, sx: 1, sy: 1 },
    { x: 100, y: 0, sx: -1, sy: 1 },
    { x: 0, y: 120, sx: 1, sy: -1 },
    { x: 100, y: 120, sx: -1, sy: -1 },
  ];
  return (
    <svg viewBox="0 0 100 60" preserveAspectRatio="xMidYMid slice" aria-hidden className={className} style={{ display: "block", width: "100%", height: "100%", background: p.ground }}>
      <defs>
        <pattern id={`tile-${id}`} width="200" height="240" patternUnits="userSpaceOnUse">
          {mirrors.map((m, i) => (
            <g key={i} transform={`translate(${m.x} ${m.y}) scale(${m.sx} ${m.sy})`}>
              {shapes}
            </g>
          ))}
        </pattern>
      </defs>
      <rect x="-400" y="-400" width="1200" height="1200" fill={`url(#tile-${id})`} />
    </svg>
  );
}

const PREFIX = "pattern:";
export const PATTERN_IDS = COVER_PATTERNS.map((p) => p.id);

const INK = "var(--art-ink)";
export const CARD_COLORS = [
  { id: "ink", name: "Ink", hex: INK },
  { id: "charcoal", name: "Charcoal", hex: "var(--art-charcoal)" },
  { id: "plum", name: "Plum", hex: "var(--art-plum)" },
  { id: "forest", name: "Forest", hex: "var(--art-forest)" },
  { id: "wine", name: "Wine", hex: "var(--art-wine)" },
  { id: "slate", name: "Slate", hex: "var(--art-slate)" },
] as const;
export const cardColorHex = (id: string | null | undefined) => (CARD_COLORS.find((c) => c.id === id) ?? CARD_COLORS[0]).hex;

export type ParsedCover = { id: string; card: string };

/** `pattern:<id>` or `pattern:<id>?c=plum`. Null for anything else (an uploaded image URL). */
export function parseCover(url: string | null | undefined): ParsedCover | null {
  if (!url || !url.startsWith(PREFIX)) return null;
  const [id, query = ""] = url.slice(PREFIX.length).split("?");
  if (!id || !PATTERN_IDS.includes(id)) return null;
  const card = new URLSearchParams(query).get("c") ?? "";
  return { id, card: CARD_COLORS.some((c) => c.id === card) ? card : CARD_COLORS[0].id };
}
export const buildCoverUrl = (id: string, card?: string) =>
  `${PREFIX}${id}${card && card !== CARD_COLORS[0].id ? `?c=${card}` : ""}`;
export const patternCoverUrl = (id: string) => buildCoverUrl(id);
export const isPatternCover = (url: string | null | undefined): url is `pattern:${string}` => parseCover(url) !== null;
export const coverGround = (url: string) => COVER_PATTERNS.find((x) => x.id === parseCover(url)?.id)?.ground ?? "var(--os-on-art-ink)";
