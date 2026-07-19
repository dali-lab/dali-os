/** Multi-color illustrated stickers for the Lab Processes roadmap.
 *  Flat Lucide icons read too thin on the yellow field — these are chunky
 *  die-cut style illustrations in DALI brand colors. */

import type { CSSProperties, ReactNode } from "react";

const NAVY = "#1E5779";
const PINK = "#E68FBE";
const CORAL = "#FF8B81";
const TEAL = "#00ADAB";
const YELLOW = "#FFD461";
const MINT = "#A2D483";
const WHITE = "#FFFFFF";

function StickerShell({
  size,
  children,
  viewBox = "0 0 80 80",
}: {
  size: number;
  children: ReactNode;
  viewBox?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox={viewBox}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
      style={{ overflow: "visible" } as CSSProperties}
    >
      {children}
    </svg>
  );
}

/** White outline + soft shadow underlay for die-cut sticker feel. */
function Outline({ d, fill }: { d: string; fill: string }) {
  return (
    <>
      <path d={d} fill="#082330" opacity="0.12" transform="translate(1.5 2)" />
      <path d={d} fill={WHITE} stroke={WHITE} strokeWidth="5" strokeLinejoin="round" />
      <path d={d} fill={fill} />
    </>
  );
}

export function RocketSticker({ size = 72 }: { size?: number }) {
  return (
    <StickerShell size={size}>
      {/* Flame */}
      <path
        d="M36 62c-2 6 0 12 4 14 4-2 6-8 4-14-1-3-3-5-4-5s-3 2-4 5Z"
        fill={WHITE}
        stroke={WHITE}
        strokeWidth="4"
        strokeLinejoin="round"
      />
      <path
        d="M36 62c-2 6 0 12 4 14 4-2 6-8 4-14-1-3-3-5-4-5s-3 2-4 5Z"
        fill={CORAL}
      />
      <path d="M38 64c0 4 1 8 2 10 1-2 2-6 2-10-0.5-2-1.5-3-2-3s-1.5 1-2 3Z" fill={YELLOW} />
      {/* Fins */}
      <path
        d="M28 48 L18 58 L28 54 Z"
        fill={WHITE}
        stroke={WHITE}
        strokeWidth="4"
        strokeLinejoin="round"
      />
      <path d="M28 48 L18 58 L28 54 Z" fill={PINK} />
      <path
        d="M52 48 L62 58 L52 54 Z"
        fill={WHITE}
        stroke={WHITE}
        strokeWidth="4"
        strokeLinejoin="round"
      />
      <path d="M52 48 L62 58 L52 54 Z" fill={PINK} />
      {/* Body */}
      <path
        d="M40 8 C28 22 26 40 28 56 L52 56 C54 40 52 22 40 8 Z"
        fill={WHITE}
        stroke={WHITE}
        strokeWidth="5"
        strokeLinejoin="round"
      />
      <path d="M40 8 C28 22 26 40 28 56 L52 56 C54 40 52 22 40 8 Z" fill={TEAL} />
      <path d="M40 14 C34 24 32 36 33 50 L47 50 C48 36 46 24 40 14 Z" fill={WHITE} opacity="0.35" />
      {/* Window */}
      <circle cx="40" cy="32" r="8" fill={WHITE} />
      <circle cx="40" cy="32" r="5.5" fill={NAVY} />
      <circle cx="38" cy="30" r="2" fill={WHITE} opacity="0.7" />
    </StickerShell>
  );
}

export function StarBurstSticker({ size = 56 }: { size?: number }) {
  const star =
    "M40 8 L45 28 L66 28 L49 40 L55 60 L40 48 L25 60 L31 40 L14 28 L35 28 Z";
  return (
    <StickerShell size={size}>
      <Outline d={star} fill={YELLOW} />
      <path d="M40 18 L42.5 28 L52 28 L44.5 34 L47 44 L40 38 L33 44 L35.5 34 L28 28 L37.5 28 Z" fill={CORAL} />
      {/* Spark rays */}
      <circle cx="14" cy="16" r="3" fill={TEAL} stroke={WHITE} strokeWidth="2" />
      <circle cx="68" cy="18" r="2.5" fill={PINK} stroke={WHITE} strokeWidth="2" />
      <circle cx="66" cy="58" r="3" fill={MINT} stroke={WHITE} strokeWidth="2" />
    </StickerShell>
  );
}

export function TrophySticker({ size = 58 }: { size?: number }) {
  return (
    <StickerShell size={size}>
      {/* Cup */}
      <path
        d="M26 18 H54 V28 C54 40 48 48 40 50 C32 48 26 40 26 28 Z"
        fill={WHITE}
        stroke={WHITE}
        strokeWidth="5"
        strokeLinejoin="round"
      />
      <path d="M26 18 H54 V28 C54 40 48 48 40 50 C32 48 26 40 26 28 Z" fill={YELLOW} />
      {/* Handles */}
      <path
        d="M26 22 C16 22 14 34 22 36"
        stroke={WHITE}
        strokeWidth="7"
        strokeLinecap="round"
        fill="none"
      />
      <path
        d="M26 22 C16 22 14 34 22 36"
        stroke={CORAL}
        strokeWidth="4"
        strokeLinecap="round"
        fill="none"
      />
      <path
        d="M54 22 C64 22 66 34 58 36"
        stroke={WHITE}
        strokeWidth="7"
        strokeLinecap="round"
        fill="none"
      />
      <path
        d="M54 22 C64 22 66 34 58 36"
        stroke={CORAL}
        strokeWidth="4"
        strokeLinecap="round"
        fill="none"
      />
      {/* Stem + base */}
      <rect x="36" y="50" width="8" height="8" rx="1" fill={WHITE} />
      <rect x="36" y="50" width="8" height="8" rx="1" fill={TEAL} />
      <rect x="28" y="58" width="24" height="6" rx="2" fill={WHITE} />
      <rect x="28" y="58" width="24" height="6" rx="2" fill={NAVY} />
      {/* Shine */}
      <path d="M32 24 C34 30 36 34 38 36" stroke={WHITE} strokeWidth="2.5" strokeLinecap="round" opacity="0.7" />
      <circle cx="40" cy="30" r="3" fill={CORAL} />
    </StickerShell>
  );
}

export function PartyPopperSticker({ size = 60 }: { size?: number }) {
  return (
    <StickerShell size={size}>
      {/* Cone */}
      <path
        d="M18 62 L38 42 L48 52 Z"
        fill={WHITE}
        stroke={WHITE}
        strokeWidth="5"
        strokeLinejoin="round"
      />
      <path d="M18 62 L38 42 L48 52 Z" fill={PINK} />
      <path d="M24 56 L38 44 L44 50 Z" fill={CORAL} />
      {/* Burst lines + dots */}
      <path d="M44 34 L58 18" stroke={WHITE} strokeWidth="5" strokeLinecap="round" />
      <path d="M44 34 L58 18" stroke={TEAL} strokeWidth="3" strokeLinecap="round" />
      <path d="M48 40 L68 36" stroke={WHITE} strokeWidth="5" strokeLinecap="round" />
      <path d="M48 40 L68 36" stroke={YELLOW} strokeWidth="3" strokeLinecap="round" />
      <path d="M42 30 L48 12" stroke={WHITE} strokeWidth="5" strokeLinecap="round" />
      <path d="M42 30 L48 12" stroke={CORAL} strokeWidth="3" strokeLinecap="round" />
      <circle cx="60" cy="16" r="4" fill={WHITE} />
      <circle cx="60" cy="16" r="3" fill={YELLOW} />
      <circle cx="70" cy="34" r="3.5" fill={WHITE} />
      <circle cx="70" cy="34" r="2.5" fill={MINT} />
      <circle cx="50" cy="10" r="3" fill={WHITE} />
      <circle cx="50" cy="10" r="2" fill={PINK} />
      <rect x="54" y="24" width="5" height="5" rx="1" fill={CORAL} transform="rotate(20 56.5 26.5)" />
      <rect x="62" y="22" width="4" height="4" rx="1" fill={NAVY} transform="rotate(-15 64 24)" />
    </StickerShell>
  );
}

export function HeartSticker({ size = 48 }: { size?: number }) {
  const heart =
    "M40 66 C40 66 12 48 12 30 C12 20 20 14 28 14 C34 14 38 18 40 22 C42 18 46 14 52 14 C60 14 68 20 68 30 C68 48 40 66 40 66 Z";
  return (
    <StickerShell size={size}>
      <Outline d={heart} fill={CORAL} />
      <path
        d="M28 24 C24 24 20 28 20 32 C20 36 28 44 32 48"
        stroke={WHITE}
        strokeWidth="3"
        strokeLinecap="round"
        fill="none"
        opacity="0.75"
      />
      <circle cx="50" cy="28" r="3" fill={PINK} />
    </StickerShell>
  );
}

export function LightningSticker({ size = 50 }: { size?: number }) {
  const bolt = "M46 8 L28 38 H40 L34 72 L58 36 H44 Z";
  return (
    <StickerShell size={size}>
      <Outline d={bolt} fill={YELLOW} />
      <path d="M44 14 L32 36 H42 L38 58 L52 34 H42 Z" fill={CORAL} opacity="0.85" />
    </StickerShell>
  );
}

export function CameraSticker({ size = 52 }: { size?: number }) {
  return (
    <StickerShell size={size}>
      <rect
        x="12"
        y="24"
        width="56"
        height="40"
        rx="8"
        fill={WHITE}
        stroke={WHITE}
        strokeWidth="5"
      />
      <rect x="12" y="24" width="56" height="40" rx="8" fill={NAVY} />
      <rect x="28" y="16" width="24" height="12" rx="3" fill={WHITE} />
      <rect x="28" y="16" width="24" height="12" rx="3" fill={TEAL} />
      <circle cx="40" cy="44" r="14" fill={WHITE} />
      <circle cx="40" cy="44" r="10" fill={CORAL} />
      <circle cx="40" cy="44" r="5" fill={NAVY} />
      <circle cx="58" cy="34" r="3" fill={YELLOW} />
    </StickerShell>
  );
}

export function FlagSticker({ size = 50 }: { size?: number }) {
  return (
    <StickerShell size={size}>
      <rect x="18" y="12" width="6" height="56" rx="2" fill={WHITE} />
      <rect x="18" y="12" width="6" height="56" rx="2" fill={NAVY} />
      <path
        d="M24 14 H62 L52 28 L62 42 H24 Z"
        fill={WHITE}
        stroke={WHITE}
        strokeWidth="5"
        strokeLinejoin="round"
      />
      <path d="M24 14 H62 L52 28 L62 42 H24 Z" fill={PINK} />
      <circle cx="36" cy="28" r="5" fill={YELLOW} />
    </StickerShell>
  );
}

export function PlanetSticker({ size = 54 }: { size?: number }) {
  return (
    <StickerShell size={size}>
      <ellipse
        cx="40"
        cy="42"
        rx="30"
        ry="10"
        fill={WHITE}
        stroke={WHITE}
        strokeWidth="4"
        transform="rotate(-18 40 42)"
      />
      <ellipse
        cx="40"
        cy="42"
        rx="30"
        ry="10"
        fill={TEAL}
        opacity="0.55"
        transform="rotate(-18 40 42)"
      />
      <circle cx="40" cy="40" r="18" fill={WHITE} stroke={WHITE} strokeWidth="5" />
      <circle cx="40" cy="40" r="18" fill={CORAL} />
      <circle cx="34" cy="34" r="5" fill={PINK} opacity="0.8" />
      <circle cx="46" cy="44" r="4" fill={YELLOW} />
      <circle cx="32" cy="46" r="3" fill={NAVY} opacity="0.5" />
    </StickerShell>
  );
}

export type LabStickerId =
  | "rocket"
  | "starburst"
  | "trophy"
  | "party"
  | "heart"
  | "lightning"
  | "camera"
  | "flag"
  | "planet"
  | "heart-2"
  | "lightning-2"
  | "starburst-2";

const STICKER_MAP: Record<
  LabStickerId,
  (props: { size?: number }) => ReactNode
> = {
  rocket: RocketSticker,
  starburst: StarBurstSticker,
  trophy: TrophySticker,
  party: PartyPopperSticker,
  heart: HeartSticker,
  lightning: LightningSticker,
  camera: CameraSticker,
  flag: FlagSticker,
  planet: PlanetSticker,
  "heart-2": HeartSticker,
  "lightning-2": LightningSticker,
  "starburst-2": StarBurstSticker,
};

export function LabSticker({
  id,
  size,
}: {
  id: LabStickerId;
  size: number;
}) {
  const Comp = STICKER_MAP[id];
  return <>{Comp({ size })}</>;
}
