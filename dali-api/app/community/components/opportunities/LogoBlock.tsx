import { blockBase, blockShades, letterInk } from "~/community/lib/block-color";

type LogoBlockProps = {
  name: string;
  logoUrl?: string | null;
  color?: string | null;
  size?: number;
  drop?: boolean;
};

export function LogoBlock({ name, logoUrl, color, size = 64, drop = false }: LogoBlockProps) {
  const base = blockBase(name, color);
  const shades = blockShades(base);
  const letter = name.trim().charAt(0).toUpperCase();
  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      className={drop ? "opp-block-drop" : undefined}
      data-testid="logo-block"
      role={logoUrl ? "img" : "presentation"}
      aria-label={logoUrl ? `${name} logo` : undefined}
      aria-hidden={logoUrl ? undefined : true}
    >
      <path d="M0 64V0H64L55 9H9V55Z" fill={shades.light} />
      <path d="M64 0V64H0L9 55H55V9Z" fill={shades.dark} />
      <rect x="9" y="9" width="46" height="46" fill={shades.face} />
      {logoUrl ? (
        <>
          <rect x="16" y="16" width="32" height="32" rx="3" fill="white" />
          <image
            href={logoUrl}
            x="18"
            y="18"
            width="28"
            height="28"
            preserveAspectRatio="xMidYMid meet"
          />
        </>
      ) : (
        <text x="32" y="33" textAnchor="middle" dominantBaseline="central" fontSize="26" fontWeight="700" fill={letterInk(base)}>
          {letter}
        </text>
      )}
    </svg>
  );
}
