export const DOMAIN_COLORS = [
  { border: "border-l-accent-pink", text: "text-accent-pink", bg: "bg-accent-pink", pillText: "text-white", cardBg: "bg-[hsl(350_70%_93%)]" },
  { border: "border-l-accent-teal", text: "text-accent-teal", bg: "bg-accent-teal", pillText: "text-white", cardBg: "bg-accent-teal/20" },
  { border: "border-l-accent-yellow", text: "text-yellow-700", bg: "bg-accent-yellow", pillText: "text-dark-blue", cardBg: "bg-accent-yellow/30" },
  { border: "border-l-accent-coral", text: "text-accent-coral", bg: "bg-accent-coral", pillText: "text-white", cardBg: "bg-accent-coral/20" },
  { border: "border-l-accent-green", text: "text-green-700", bg: "bg-accent-green", pillText: "text-dark-blue", cardBg: "bg-accent-green/30" },
];

export function getDomainColor(index: number) {
  return DOMAIN_COLORS[index % DOMAIN_COLORS.length];
}
