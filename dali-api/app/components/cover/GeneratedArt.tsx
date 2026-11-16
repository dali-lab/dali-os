export function GeneratedArt({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 342 128"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden
      data-testid="generated-art"
      className={className}
      style={{ display: "block", width: "100%", height: "100%", background: "var(--art-ground-sky)" }}
    >
      <rect x="0" y="0" width="64" height="64" fill="var(--art-teal)" />
      <circle cx="32" cy="32" r="20" fill="var(--art-butter)" />
      <path d="M64 64A64 64 0 0 1 128 0V64Z" fill="var(--art-navy)" />
      <rect x="0" y="64" width="64" height="64" fill="var(--art-sage)" />
      <path d="M0 128A64 64 0 0 1 64 64V128Z" fill="var(--art-navy)" />
      <circle cx="171" cy="64" r="22" fill="var(--art-apricot)" />
      <circle cx="225" cy="64" r="22" fill="var(--art-mist)" />
      <rect x="278" y="0" width="64" height="64" fill="var(--art-navy)" />
      <circle cx="310" cy="32" r="20" fill="var(--art-teal)" />
      <rect x="278" y="64" width="64" height="64" fill="var(--art-apricot)" />
      <path d="M214 128A64 64 0 0 0 278 64V128Z" fill="var(--art-sage)" />
    </svg>
  );
}
