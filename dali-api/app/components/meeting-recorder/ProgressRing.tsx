const CIRCUMFERENCE = 2 * Math.PI * 7.5;

export function ProgressRing({ fraction, className }: { fraction: number; className?: string }) {
  const clamped = Math.max(0, Math.min(1, fraction));
  return (
    <svg viewBox="0 0 20 20" aria-hidden className={className} data-progress-ring={clamped}>
      <circle cx="10" cy="10" r="7.5" fill="none" strokeWidth="2.5" className="stroke-os-container" />
      <circle
        cx="10"
        cy="10"
        r="7.5"
        fill="none"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeDasharray={CIRCUMFERENCE}
        strokeDashoffset={CIRCUMFERENCE * (1 - clamped)}
        transform="rotate(-90 10 10)"
        className="stroke-os-accent transition-[stroke-dashoffset] duration-300 ease-[cubic-bezier(.2,.8,.2,1)] motion-reduce:transition-none"
      />
    </svg>
  );
}
