import { useEffect, useRef } from "react";
import { initialsFromName } from "~/lib/display";
import { advanceBounce, seedBounce, type BounceState } from "./birthday-bounce";

export type BirthdayPerson = {
  id: string;
  name: string;
  photoUrl: string | null;
};

const MAX_FRAME_MS = 48;

/** Overlay for the home hero: each member whose birthday is today gets their
 *  avatar, wearing a party hat, bouncing around the screen DVD-logo style.
 *  Decorative only — it never takes pointer events, and it holds still for
 *  viewers who prefer reduced motion. */
export function BirthdayBounce({ people }: { people: BirthdayPerson[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const nodesRef = useRef(new Map<string, HTMLDivElement>());

  useEffect(() => {
    const container = containerRef.current;
    if (!container || people.length === 0) return;
    if (
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    )
      return;

    const states = new Map<string, BounceState>();
    let raf = 0;
    let last = performance.now();

    const tick = (now: number) => {
      const dt = Math.min(now - last, MAX_FRAME_MS);
      last = now;
      const bounds = { width: container.clientWidth, height: container.clientHeight };
      people.forEach((person, i) => {
        const node = nodesRef.current.get(person.id);
        if (!node) return;
        const size = { width: node.offsetWidth, height: node.offsetHeight };
        const state = advanceBounce(
          states.get(person.id) ?? seedBounce(i, bounds, size),
          dt,
          bounds,
          size,
        );
        states.set(person.id, state);
        node.style.transform = `translate3d(${state.x}px, ${state.y}px, 0)`;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [people]);

  if (people.length === 0) return null;

  return (
    <div
      ref={containerRef}
      className="home-birthday-bounce pointer-events-none absolute inset-0 z-10 overflow-hidden transition-opacity duration-300"
    >
      {people.map((person, i) => (
        <div
          key={person.id}
          ref={(node) => {
            if (node) nodesRef.current.set(person.id, node);
            else nodesRef.current.delete(person.id);
          }}
          data-testid="birthday-bouncer"
          className="absolute left-0 top-0 flex w-28 flex-col items-center gap-1.5 will-change-transform"
          style={{ transform: `translate3d(${12 + i * 32}px, ${12 + i * 32}px, 0)` }}
        >
          <div className="relative">
            <PartyHat />
            {person.photoUrl ? (
              <img
                src={person.photoUrl}
                alt=""
                className="h-20 w-20 rounded-full border-2 border-white/80 object-cover shadow-lg"
              />
            ) : (
              <span className="flex h-20 w-20 items-center justify-center rounded-full border-2 border-white/80 bg-white/15 text-xl font-semibold text-white shadow-lg backdrop-blur-sm">
                {initialsFromName(person.name)}
              </span>
            )}
          </div>
          <span className="max-w-full truncate rounded-full bg-black/55 px-2.5 py-0.5 text-xs font-medium text-white backdrop-blur-sm">
            🎉 Happy birthday, {person.name.split(" ")[0]}!
          </span>
        </div>
      ))}
    </div>
  );
}

/* Decorative art, like the landing backgrounds — literal colors, not tokens,
   so the hat stays a party hat in both themes. */
function PartyHat() {
  return (
    <svg
      viewBox="0 0 40 44"
      aria-hidden
      className="absolute -top-7 left-1/2 z-[1] h-10 w-9 -translate-x-1/3 rotate-[18deg]"
    >
      <path d="M20 4 L34 40 L6 40 Z" fill="#f59e0b" />
      <path d="M12.9 22.3 L27.1 22.3 L29.8 29.3 L10.2 29.3 Z" fill="#6366f1" />
      <path d="M8.7 33.2 L31.3 33.2 L34 40 L6 40 Z" fill="#ec4899" />
      <circle cx="20" cy="4" r="3.6" fill="#fde047" />
    </svg>
  );
}
