import { useEffect, useRef } from "react";
import { Link } from "react-router";
import { initialsFromName } from "~/lib/display";
import { CONFETTI_LIFE_S, claimConfetti, seedConfetti, separatorBefore, stepConfetti } from "./birthday-line";

export type BirthdayPerson = {
  id: string;
  name: string;
  photoUrl: string | null;
};

const MAX_AVATARS = 3;

export function BirthdayLine({ people }: { people: BirthdayPerson[] }) {
  const lineRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    const line = lineRef.current;
    if (!line || people.length === 0) return;
    if (typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let storage: Storage | null = null;
    try {
      storage = window.localStorage;
    } catch {
      return;
    }
    if (!claimConfetti(storage, new Date())) return;
    return burst(line);
  }, [people]);

  if (people.length === 0) return null;
  const shown = people.slice(0, MAX_AVATARS);

  return (
    <p ref={lineRef} className="landing-birthday landing-glass" data-testid="birthday-line">
        <span className="landing-birthday-avatars" aria-hidden="true">
          {shown.map((person, i) => (
            <span key={person.id} className="landing-birthday-avatar">
              {i === 0 && <PartyHat />}
              {person.photoUrl ? <img src={person.photoUrl} alt="" /> : initialsFromName(person.name)}
            </span>
          ))}
        </span>
        <span>
          Happy birthday,{" "}
          {people.map((person, i) => (
            <span key={person.id}>
              {separatorBefore(i, people.length)}
              <Link to={`/members/${person.id}`} title={person.name}>
                {person.name.split(" ")[0]}
              </Link>
            </span>
          ))}
        </span>
    </p>
  );
}

function burst(line: HTMLElement): () => void {
  const canvas = document.createElement("canvas");
  canvas.className = "landing-confetti";
  canvas.setAttribute("aria-hidden", "true");
  const ctx = canvas.getContext("2d");
  if (!ctx) return () => {};
  document.body.appendChild(canvas);
  const box = { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
  const from = line.getBoundingClientRect();
  const ratio = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = box.width * ratio;
  canvas.height = box.height * ratio;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  const scale = Math.max(0.6, Math.min(1.4, box.width / 900));
  const bits = seedConfetti(
    { x: from.left - box.left + from.height * 0.6, y: from.top - box.top + from.height / 2 },
    scale,
  );
  let raf = 0;
  let last = performance.now();
  const tick = (now: number) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const alive = stepConfetti(bits, dt, scale);
    ctx.clearRect(0, 0, box.width, box.height);
    for (const b of bits) {
      const alpha = 1 - b.age / CONFETTI_LIFE_S;
      if (alpha <= 0) continue;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(b.x, b.y);
      ctx.rotate(b.spin);
      ctx.fillStyle = b.color;
      ctx.fillRect(-b.size / 2, -b.size * 0.3, b.size, b.size * 0.6);
      ctx.restore();
    }
    if (alive > 0) raf = requestAnimationFrame(tick);
    else canvas.remove();
  };
  const start = window.setTimeout(() => {
    last = performance.now();
    raf = requestAnimationFrame(tick);
  }, 900);
  return () => {
    window.clearTimeout(start);
    cancelAnimationFrame(raf);
    canvas.remove();
  };
}

/* Decorative art, like the landing backgrounds: literal colors so the hat stays a party hat in both themes. */
function PartyHat() {
  return (
    <svg viewBox="0 0 40 44" aria-hidden className="landing-birthday-hat">
      <path d="M20 4 L34 40 L6 40 Z" fill="#f59e0b" />
      <path d="M12.9 22.3 L27.1 22.3 L29.8 29.3 L10.2 29.3 Z" fill="#6366f1" />
      <path d="M8.7 33.2 L31.3 33.2 L34 40 L6 40 Z" fill="#ec4899" />
      <circle cx="20" cy="4" r="3.6" fill="#fde047" />
    </svg>
  );
}
