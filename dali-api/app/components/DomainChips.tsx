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
const OS_ROLE_CHIPS = {
  amber: "bg-[#3d3a26] text-[#e8dd9a]",
  teal: "bg-[#1f3a37] text-[#8fd6cb]",
  violet: "bg-[#31284a] text-[#c3aef2]",
  pink: "bg-[#3f2530] text-[#f2a8bd]",
  blue: "bg-[#1e3348] text-[#a2d2fd]",
  green: "bg-[#263a29] text-[#a6dda6]",
  orange: "bg-[#43301f] text-[#f0b98a]",
  magenta: "bg-[#3d2440] text-[#e2a6ee]",
  slate: "bg-[#2b3340] text-[#aec4de]",
  cyan: "bg-[#193a3f] text-[#8fd4e0]",
  red: "bg-[#3f2424] text-[#f0a5a5]",
  lime: "bg-[#333d1f] text-[#cfe08a]",
  indigo: "bg-[#2a2c4d] text-[#b0b4f0]",
  sand: "bg-[#3a3128] text-[#ddc3a3]",
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
