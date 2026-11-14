import type { CSSProperties, ReactNode } from "react";

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

type TitleBox = { left: number; top: number; width: number; height: number; align?: "left" | "center" };
type Pattern = { id: string; name: string; ground: string; title: TitleBox; shapes: ReactNode };

const quietDots: ReactNode[] = [];
for (let c = 1; c < 16; c += 2) for (let r = 0; r < 5; r += 2) quietDots.push(<circle key={`g${c}-${r}`} cx={c * U} cy={r * U + U / 2} r={0.7} fill={C.mist} />);

export const COVER_PATTERNS: Pattern[] = [
  {
    id: "quiet-grid",
    name: "Quiet grid",
    ground: "#F3EFFA",
    title: { left: 6, top: 14, width: 58, height: 72 },
    shapes: [...quietDots, sq(14, 0, C.butter), sq(15, 1, C.mist), dot(14, 1, C.peach, 2.4), dot(15, 1, C.navy, 2.4)],
  },
  {
    id: "corner-tiles",
    name: "Corner tiles",
    ground: "#E8F4F1",
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
    ground: "#FBEEF2",
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
    ground: "#E9F2FB",
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
    ground: "#FFF1E6",
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
    ground: "#EEF6EA",
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

const PREFIX = "pattern:";
export const PATTERN_IDS = COVER_PATTERNS.map((p) => p.id);

export const COVER_DECOR = [
  { id: "frame", name: "Frame" },
  { id: "stitch", name: "Stitch" },
  { id: "corner", name: "Corner" },
  { id: "seal", name: "Seal" },
  { id: "underline", name: "Underline" },
] as const;
export type DecorId = (typeof COVER_DECOR)[number]["id"];

export type ParsedCover = { id: string; decor: DecorId[] };

/** `pattern:<id>` or `pattern:<id>?d=frame,seal`. Null for anything else (an uploaded image URL). */
export function parseCover(url: string | null | undefined): ParsedCover | null {
  if (!url || !url.startsWith(PREFIX)) return null;
  const [id, query = ""] = url.slice(PREFIX.length).split("?");
  if (!id || !PATTERN_IDS.includes(id)) return null;
  const wanted = new URLSearchParams(query).get("d")?.split(",") ?? [];
  const decor = COVER_DECOR.map((d) => d.id).filter((d) => wanted.includes(d));
  return { id, decor };
}
export const buildCoverUrl = (id: string, decor: readonly DecorId[] = []) =>
  `${PREFIX}${id}${decor.length ? `?d=${decor.join(",")}` : ""}`;
export const patternCoverUrl = (id: string) => buildCoverUrl(id);
export const isPatternCover = (url: string | null | undefined): url is `pattern:${string}` => parseCover(url) !== null;
export const coverGround = (url: string) => COVER_PATTERNS.find((x) => x.id === parseCover(url)?.id)?.ground ?? "#fff";

const INK = "#1b2a47";

function titleSize(title: string) {
  const n = title.length;
  if (n <= 12) return "8.5cqw";
  if (n <= 24) return "6.6cqw";
  if (n <= 40) return "5.2cqw";
  return "4.2cqw";
}

/** Text edited where it is displayed: no input box, just the text with an underline cue. */
export function InlineTitle({
  value,
  onChange,
  onCommit,
  style,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  onCommit: (v: string) => void;
  style?: CSSProperties;
  className?: string;
}) {
  return (
    <span style={{ position: "relative", display: "inline-block", maxWidth: "100%" }}>
      <span
        role="textbox"
        aria-label="Title"
        contentEditable
        suppressContentEditableWarning
        spellCheck={false}
        ref={(el) => {
          if (el && document.activeElement !== el && el.textContent !== value) el.textContent = value;
        }}
        onInput={(e) => onChange(e.currentTarget.textContent ?? "")}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            e.currentTarget.blur();
          }
        }}
        onPaste={(e) => {
          e.preventDefault();
          document.execCommand("insertText", false, e.clipboardData.getData("text/plain").replace(/\s+/g, " "));
        }}
        onBlur={(e) => onCommit((e.currentTarget.textContent ?? "").replace(/\s+/g, " ").trim())}
        className={`cursor-text outline-none transition-shadow duration-150 hover:shadow-[0_2px_0_rgba(27,42,71,0.18)] focus:shadow-[0_2px_0_rgba(27,42,71,0.4)] ${className ?? ""}`}
        style={{ display: "inline-block", minWidth: "2ch", maxWidth: "100%", ...style }}
      />
      {!value.trim() && (
        <span aria-hidden style={{ position: "absolute", left: 0, top: 0, opacity: 0.35, pointerEvents: "none", ...style }}>
          Add a title
        </span>
      )}
    </span>
  );
}

/** A composed cover: tile pattern, the page title in its reserved area, and optional decor. Sizes are
 *  container-relative, so the same markup works as a thumbnail and as the full-width cover. */
export function CoverPattern({
  url,
  title,
  className,
  onTitleChange,
  onTitleCommit,
}: {
  url: string;
  title?: string;
  className?: string;
  onTitleChange?: (v: string) => void;
  onTitleCommit?: (v: string) => void;
}) {
  const parsed = parseCover(url);
  const p = parsed && COVER_PATTERNS.find((x) => x.id === parsed.id);
  if (!parsed || !p) return null;
  const has = (d: DecorId) => parsed.decor.includes(d);
  const text = (title ?? "").trim();
  const t = p.title;
  return (
    <div
      className={className}
      role="img"
      aria-label={`${p.name} cover${text ? `: ${text}` : ""}`}
      style={{ position: "relative", width: "100%", aspectRatio: "16 / 5", overflow: "hidden", containerType: "inline-size", background: p.ground }}
    >
      <svg viewBox="0 0 160 50" preserveAspectRatio="xMidYMid slice" aria-hidden style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
        {p.shapes}
      </svg>
      {(text || onTitleChange) && (
        <div
          style={{
            position: "absolute", left: `${t.left}%`, top: `${t.top}%`, width: `${t.width}%`, height: `${t.height}%`,
            display: "flex", alignItems: "center", justifyContent: t.align === "center" ? "center" : "flex-start",
            textAlign: t.align === "center" ? "center" : "left",
          }}
        >
          {(() => {
            const titleStyle: CSSProperties = {
              display: "-webkit-box", WebkitBoxOrient: "vertical", WebkitLineClamp: 3, overflow: "hidden", overflowWrap: "anywhere",
              fontFamily: "var(--font-heading, inherit)", fontWeight: 700, lineHeight: 1.08, letterSpacing: "-0.01em",
              // overflow:hidden (for the line clamp) clips descenders at this
              // line height; pad them back in and cancel it so layout is unchanged.
              paddingBottom: "0.15em", marginBottom: "-0.15em",
              fontSize: titleSize(text), color: INK, textWrap: "balance",
              ...(has("underline")
                ? { textDecoration: "underline wavy", textDecorationColor: C.coral, textDecorationThickness: "max(1px, 0.4cqw)", textUnderlineOffset: "0.9cqw" }
                : null),
            };
            return onTitleChange ? (
              <InlineTitle
                value={title ?? ""}
                onChange={onTitleChange}
                onCommit={onTitleCommit ?? (() => undefined)}
                style={{ ...titleStyle, display: "inline-block", WebkitLineClamp: undefined, overflow: "visible" }}
              />
            ) : (
              <span style={titleStyle}>{text}</span>
            );
          })()}
        </div>
      )}
      {has("frame") && <div aria-hidden style={{ position: "absolute", inset: "2.2cqw", border: "max(1px, 0.22cqw) solid rgba(27,42,71,0.3)", borderRadius: "2cqw", pointerEvents: "none" }} />}
      {has("stitch") && <div aria-hidden style={{ position: "absolute", inset: "3.6cqw", border: `max(1px, 0.28cqw) dashed ${C.coral}`, opacity: 0.7, borderRadius: "1.4cqw", pointerEvents: "none" }} />}
      {has("corner") && <div aria-hidden style={{ position: "absolute", left: 0, bottom: 0, width: "6.5cqw", height: "6.5cqw", background: C.coral, borderTopRightRadius: "100%", pointerEvents: "none" }} />}
      {has("seal") && (
        <svg aria-hidden viewBox="0 0 20 20" style={{ position: "absolute", right: "1.6cqw", bottom: "1.6cqw", width: "6.6cqw", height: "6.6cqw", pointerEvents: "none" }}>
          <circle cx="10" cy="10" r="10" fill={C.apricot} />
          <circle cx="10" cy="10" r="8" fill="none" stroke="#fff" strokeWidth="0.8" strokeDasharray="1.4 1.4" />
          <g stroke={C.navy} strokeWidth="1.3">{[0, 45, 90, 135].map((a) => <line key={a} x1="10" y1="5" x2="10" y2="15" transform={`rotate(${a} 10 10)`} />)}</g>
        </svg>
      )}
    </div>
  );
}
