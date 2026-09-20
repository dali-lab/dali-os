import { cn } from "~/lib/cn";

// The dali.os role chip, shared by every surface that prints a domain name:
// the project hero, its team cards, and a member's profile header. One table
// so a role reads identically wherever it appears.

// The design gives each role its own tinted chip. The four hues it drew were
// matched by name against a handful of short keys and everything else fell to
// a hash across those same four — so with the real catalog (17 domains, whose
// labels are "Fullstack Dev", "UI/UX Design", "Product Management"…) every
// lookup missed and three unrelated domains routinely came out the same
// colour. Each catalog domain now names its own hue, so a role reads
// identically on the header, the team cards, and anywhere else it appears.
//
// The colours themselves are in app.css, stated once per mode like every other
// os plate: a chip drawn against the dark shell is a deep ground under pale
// ink, and on paper it flips to a pale wash under deep ink.
const OS_ROLE_CHIPS = {
  amber: "bg-[var(--os-role-amber-fill)] text-[var(--os-role-amber-ink)]",
  teal: "bg-[var(--os-role-teal-fill)] text-[var(--os-role-teal-ink)]",
  violet: "bg-[var(--os-role-violet-fill)] text-[var(--os-role-violet-ink)]",
  pink: "bg-[var(--os-role-pink-fill)] text-[var(--os-role-pink-ink)]",
  blue: "bg-[var(--os-role-blue-fill)] text-[var(--os-role-blue-ink)]",
  green: "bg-[var(--os-role-green-fill)] text-[var(--os-role-green-ink)]",
  orange: "bg-[var(--os-role-orange-fill)] text-[var(--os-role-orange-ink)]",
  magenta: "bg-[var(--os-role-magenta-fill)] text-[var(--os-role-magenta-ink)]",
  slate: "bg-[var(--os-role-slate-fill)] text-[var(--os-role-slate-ink)]",
  cyan: "bg-[var(--os-role-cyan-fill)] text-[var(--os-role-cyan-ink)]",
  red: "bg-[var(--os-role-red-fill)] text-[var(--os-role-red-ink)]",
  lime: "bg-[var(--os-role-lime-fill)] text-[var(--os-role-lime-ink)]",
  indigo: "bg-[var(--os-role-indigo-fill)] text-[var(--os-role-indigo-ink)]",
  sand: "bg-[var(--os-role-sand-fill)] text-[var(--os-role-sand-ink)]",
} as const;

// Matched as a prefix of the domain's normalised name, so a domain's catalog
// label, its legacy name and its code all land on one hue — the header reads
// `displayName` ("Fullstack Dev") while a team card reads `name`
// ("Fullstack"), and the two have to agree. Longest first: "production" would
// otherwise be swallowed by "product".
const OS_ROLE_STEMS: [string, keyof typeof OS_ROLE_CHIPS][] = [
  ["threedmodeling", "green"],
  ["3dmodeling", "green"],
  ["videography", "cyan"],
  ["photography", "red"],
  ["digitalarts", "sand"],
  ["engineering", "slate"],
  ["production", "lime"],
  ["fullstack", "teal"],
  ["animation", "orange"],
  ["graphics", "magenta"],
  ["product", "violet"],
  ["writing", "indigo"],
  ["design", "pink"],
  ["arvr", "blue"],
  ["uiux", "pink"],
  ["data", "amber"],
  ["dev", "teal"],
  ["pm", "violet"],
  ["ux", "pink"],
];

// An unlisted domain still gets a stable colour without anyone editing the
// table above — off the whole ring now, not off four slots.
const OS_ROLE_CHIP_RING = Object.values(OS_ROLE_CHIPS);

export function osRoleChipClass(name: string): string {
  const key = name.toLowerCase().replace(/[^a-z0-9]/g, "");
  for (const [stem, hue] of OS_ROLE_STEMS) {
    if (key.startsWith(stem)) return OS_ROLE_CHIPS[hue];
  }
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) % 997;
  return OS_ROLE_CHIP_RING[hash % OS_ROLE_CHIP_RING.length];
}

export function DomainChips({
  items,
  muted = false,
}: {
  items: { id: string; name: string }[];
  muted?: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((d) => (
        <span
          key={d.id}
          className={cn(
            "inline-flex items-center rounded-full px-3.5 py-[5px] text-[13px] font-semibold",
            muted ? "bg-os-container text-os-grey" : osRoleChipClass(d.name),
          )}
        >
          {d.name}
        </span>
      ))}
    </div>
  );
}
