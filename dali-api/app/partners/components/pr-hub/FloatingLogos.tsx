import type { CSSProperties } from "react";

// Scatter positions sit in the margins around the title. Zones:
//   • top band    — above the wordmark
//   • right strip — beside/right of the wordmark
//   • bottom band — below the wordmark
const SLOTS: { top: string; left: string; rotate: number; size: number; delay: number }[] = [
  // top band
  { top: "-2%", left: "6%",  rotate: -8,  size: 50, delay: 0 },
  { top: "6%",  left: "32%", rotate: 6,   size: 56, delay: 1.1 },
  { top: "0%",  left: "58%", rotate: -4,  size: 48, delay: 2.0 },
  // right strip
  { top: "12%", left: "80%", rotate: 10,  size: 60, delay: 0.4 },
  { top: "44%", left: "82%", rotate: -6,  size: 70, delay: 1.6 },
  { top: "72%", left: "76%", rotate: 8,   size: 54, delay: 2.3 },
  // bottom band
  { top: "80%", left: "10%", rotate: 12,  size: 50, delay: 0.7 },
  { top: "84%", left: "34%", rotate: -10, size: 58, delay: 1.9 },
  { top: "82%", left: "60%", rotate: 4,   size: 52, delay: 0.3 },
];

// Dead-simple scatter. The route hands us a list of image URLs from the
// `public/partners/` folder (first N files, no DB lookup, no slug matching)
// and we render each one in a scatter slot. Any image dropped into that
// folder appears here automatically.
export function FloatingLogos({ urls }: { urls: string[] }) {
  if (urls.length === 0) return null;
  const picks = urls.slice(0, SLOTS.length);
  return (
    <div className="hub-logo-scatter" aria-hidden>
      {picks.map((url, i) => {
        const slot = SLOTS[i];
        const style: CSSProperties = {
          top: slot.top,
          left: slot.left,
          width: `${slot.size}px`,
          height: `${slot.size}px`,
          transform: `rotate(${slot.rotate}deg)`,
          animationDelay: `${slot.delay}s`,
        };
        return (
          <div key={url} className="hub-logo-chip" style={style}>
            <img src={url} alt="" loading="lazy" />
          </div>
        );
      })}
    </div>
  );
}
