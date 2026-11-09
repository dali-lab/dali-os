import type { ReactNode } from "react";

// Built-in hub covers: geometric tile compositions on a 10-unit cell grid
// (16 x 5 cells, matching the 16:5 cover). A cover stored as `pattern:<id>`
// renders one of these; anything else is an uploaded image URL.

const C = {
  coral: "#D45F6A",
  peach: "#F4AB9F",
  apricot: "#F1C885",
  butter: "#FCF3C2",
  sage: "#7AB39A",
  teal: "#5FB8B4",
  aqua: "#9FDDD6",
  navy: "#214B76",
  orchid: "#BD64A8",
  pink: "#DA93C0",
  mist: "#D3DAE0",
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
      <circle cx={cx} cy={cy} r={1} fill="#fff" />
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

type Pattern = { id: string; name: string; ground: string; shapes: ReactNode };

const quietDots: ReactNode[] = [];
for (let c = 1; c < 16; c += 2) for (let r = 0; r < 5; r += 2) quietDots.push(<circle key={`g${c}-${r}`} cx={c * U} cy={r * U + U / 2} r={0.7} fill={C.mist} />);

export const COVER_PATTERNS: Pattern[] = [
  {
    id: "quiet-grid",
    name: "Quiet grid",
    ground: "#F3EFFA",
    shapes: [...quietDots, sq(14, 0, C.butter), sq(15, 1, C.mist), dot(14, 1, C.peach, 2.4), dot(15, 1, C.navy, 2.4)],
  },
  {
    id: "corner-tiles",
    name: "Corner tiles",
    ground: "#E8F4F1",
    shapes: [
      sq(12, 0, C.apricot), dot(12, 0, C.orchid), sq(13, 0, C.butter), flower(13, 0, C.teal), dot(15, 0, C.aqua),
      star(12, 1, C.apricot), sq(13, 1, C.sage), dot(13, 1, C.peach), sq(14, 1, C.navy), dot(14, 1, C.orchid),
      sq(12, 2, C.pink), dot(12, 2, C.navy),
    ],
  },
  {
    id: "petal-ledger",
    name: "Petal ledger",
    ground: "#FBEEF2",
    shapes: [
      sq(0, 2, C.aqua), dot(0, 2, C.navy), quarter(1, 2, C.coral, "bl"), sq(2, 2, C.butter), dot(2, 2, C.peach),
      semi(3, 2, C.sage), sq(4, 2, C.apricot), flower(4, 2, C.teal), dot(5, 2, C.pink), sq(6, 2, C.navy), dot(6, 2, C.orchid),
      quarter(7, 2, C.teal, "tr"), sq(8, 2, C.aqua), dot(8, 2, C.navy), quarter(9, 2, C.coral, "bl"), sq(10, 2, C.butter),
      dot(10, 2, C.peach), semi(11, 2, C.sage), sq(12, 2, C.apricot), flower(12, 2, C.teal), dot(13, 2, C.pink),
      sq(14, 2, C.navy), dot(14, 2, C.orchid), quarter(15, 2, C.teal, "tr"),
    ],
  },
  {
    id: "block-party",
    name: "Block party",
    ground: "#E9F2FB",
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
    ground: "#FFF1E6",
    shapes: [
      dot(1, 1, C.pink, 4), dot(3, 3, C.navy, 2.6), dot(5, 0, C.orchid, 3.4), dot(7, 4, C.aqua, 4.2), dot(10, 1, C.peach, 3), dot(12, 3, C.coral, 4),
      dot(14, 0, C.teal, 3.2), dot(15, 4, C.butter, 4), quarter(8, 2, C.sage, "tl"), quarter(2, 4, C.apricot, "tr"), dot(4, 1, C.mist, 2), dot(13, 1, C.navy, 2.2),
      sq(14, 2, C.butter), dot(14, 2, C.orchid, 2.6),
    ],
  },
  {
    id: "poster",
    name: "Poster",
    ground: "#EEF6EA",
    shapes: [
      sq(0, 0, C.apricot), dot(0, 0, C.orchid), sq(1, 0, C.butter), flower(1, 0, C.teal), dot(3, 0, C.coral),
      sq(1, 1, C.sage), dot(1, 1, C.peach), sq(2, 1, C.navy), dot(2, 1, C.orchid), star(0, 1, C.apricot),
      sq(0, 2, C.pink), dot(0, 2, C.navy),
      dot(9, 4, C.pink), sq(10, 3, C.aqua), dot(10, 3, C.navy), quarter(11, 3, C.coral, "tl"), dot(13, 3, C.peach),
      sq(11, 4, C.butter), dot(11, 4, C.peach), semi(12, 3, C.sage), sq(12, 4, C.apricot), dot(12, 4, C.teal), sq(14, 4, C.sage), flower(14, 4, C.butter),
    ],
  },
];

const PREFIX = "pattern:";
export const PATTERN_IDS = COVER_PATTERNS.map((p) => p.id);
export const patternCoverUrl = (id: string) => `${PREFIX}${id}`;
export const isPatternCover = (url: string | null | undefined): url is `pattern:${string}` =>
  !!url && url.startsWith(PREFIX) && PATTERN_IDS.includes(url.slice(PREFIX.length));

export function CoverPattern({ url, className }: { url: string; className?: string }) {
  const p = COVER_PATTERNS.find((x) => `${PREFIX}${x.id}` === url);
  if (!p) return null;
  return (
    <svg
      viewBox="0 0 160 50"
      preserveAspectRatio="xMidYMid slice"
      role="img"
      aria-label={`${p.name} pattern`}
      className={className}
      style={{ background: p.ground }}
    >
      {p.shapes}
    </svg>
  );
}
