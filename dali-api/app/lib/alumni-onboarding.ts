import { AUTH_TILES, type AuthTile } from "~/components/auth/auth-tiles";

export type AlumniInvite = "choice" | "onboarding" | "game";

export const ONBOARDING_STEPS = 3;
export const WALL_SIZE = 18;
export const WALL_FILLED_BY_STEP = [8, 13, 18] as const;

const WALL_EXCLUDED = new Set(["t1", "t3", "t18"]);

export const WALL_TILES: AuthTile[] = AUTH_TILES.filter((t) => !WALL_EXCLUDED.has(t.id));

const WALL_ORDER = [
  "t4", "t11", "t8", "t14", "t5", "t15", "t2", "t9",
  "t16", "t6", "t12", "t13", "t17", "t7", "t10", "t19", "t20", "t21",
];

export const WALL_FILL_ORDER: AuthTile[] = WALL_ORDER.map((id) => WALL_TILES.find((t) => t.id === id)!);

export function wallFilledForStep(step: number): number {
  return WALL_FILLED_BY_STEP[Math.min(Math.max(step, 1), ONBOARDING_STEPS) - 1];
}

const BLOCK_CHOICES = AUTH_TILES.filter((t) => t.motif !== "solid" && t.motif !== "loose");

export function blockIdFor(userId: string): string {
  let h = 0;
  for (const ch of userId) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return BLOCK_CHOICES[h % BLOCK_CHOICES.length].id;
}

export function blockById(id: string): AuthTile {
  return AUTH_TILES.find((t) => t.id === id) ?? BLOCK_CHOICES[0];
}

export const ASK_ME_ABOUT_SUGGESTIONS = [
  "Breaking into tech",
  "Career changes",
  "Design portfolios",
  "Grad school",
  "Moving to a new city",
  "Startups",
  "Freelancing",
] as const;

export type OpenToChoices = {
  coffeeChats: boolean;
  resumeReviews: boolean;
  partnerReferrals: boolean;
  mentoring: boolean;
  speaking: boolean;
};

export const OPEN_TO_CHOICES = [
  { key: "coffeeChats", title: "Coffee chats", subtitle: "A 20 minute call with a student", bg: "#E68FBE", fg: "#FFF3B5", motif: "dot" },
  { key: "resumeReviews", title: "Resume reviews", subtitle: "Comments on a resume or portfolio", bg: "#FFCF88", fg: "#0C4876", motif: "ring" },
  { key: "partnerReferrals", title: "Partner referrals", subtitle: "Point a company or nonprofit our way", bg: "#8CE0D6", fg: "#0C4876", motif: "dot" },
  { key: "mentoring", title: "Mentor a project", subtitle: "An hour every other week for a term", bg: "#24B1B1", fg: "#FFFFFF", motif: "flower" },
  { key: "speaking", title: "Speak at a lab event", subtitle: "A talk or a panel, in person or remote", bg: "#0C4876", fg: "#FFF3B5", motif: "quarter" },
] as const satisfies readonly {
  key: keyof OpenToChoices;
  title: string;
  subtitle: string;
  bg: string;
  fg: string;
  motif: AuthTile["motif"];
}[];

export type DaliSummary = {
  projectCount: number;
  termCount: number;
  projectNames: string[];
  roles: string[];
};

type AssignmentRow = {
  project: { id: string; name: string };
  term: { id: string; sortKey: number };
  domain: { displayName: string };
};

export function summarizeDali(rows: readonly AssignmentRow[]): DaliSummary {
  const chronological = [...rows].sort((a, b) => a.term.sortKey - b.term.sortKey);
  const projects = new Map<string, string>();
  const terms = new Set<string>();
  const roles: string[] = [];
  for (const row of chronological) {
    projects.set(row.project.id, row.project.name);
    terms.add(row.term.id);
    if (!roles.includes(row.domain.displayName)) roles.push(row.domain.displayName);
  }
  return {
    projectCount: projects.size,
    termCount: terms.size,
    projectNames: [...projects.values()],
    roles,
  };
}

export function pluralize(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function joinRoles(roles: readonly string[]): string {
  return roles.map((r, i) => (i === 0 ? r : r.charAt(0).toLowerCase() + r.slice(1))).join(", then ");
}

type WorkRow = { id: string; company: string; position: string; location: string | null; endDate: Date | null };

export function splitWork<T extends WorkRow>(rows: readonly T[]): { now: T | null; before: T | null } {
  const now = rows.find((r) => r.endDate === null) ?? null;
  const before = rows.find((r) => r !== now) ?? null;
  return { now, before };
}

export function classTag(fullName: string, classYear: number | null): string {
  return classYear ? `${fullName} '${String(classYear).slice(-2)}` : fullName;
}

export function parseJsonList(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === "string") : [];
  } catch {
    return [];
  }
}
