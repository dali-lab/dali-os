// Single source of truth for the Drive's top-level space list. Mirrors
// `nav-areas.ts` in the same way `nav-areas.ts` mirrors the sidebar: one
// declared space per document-owning nav area, each with a backing strategy
// that Wave 1 will use to drive `loadDriveScopes`. Client-safe module — no
// Prisma, no *.server imports — so its unit test needs no client (same rule
// as `feature-flags.ts`).

import {
  Briefcase,
  FolderKanban,
  GraduationCap,
  HardDrive,
  Heart,
  Shield,
  type LucideIcon,
} from "lucide-react";
import type { RoleFlags } from "~/lib/nav-areas";

// ── Backing strategies ────────────────────────────────────────────────────────

/**
 * How the loader (Wave 1) will materialise items for this space:
 *
 * - `member`           — viewer's private drive (`workspaceType=Member`, `workspaceId=user`).
 * - `lab-open`         — lab-wide pages/files, top-level, no scoped-root carve-outs.
 * - `workspace-multi`  — one sub-space per workspace the viewer can access
 *                        (Projects / Education offerings).
 * - `process-root`      — the contents of a real root folder (`rootKey`), found
 *                        by process type and id. Visible to whoever can view
 *                        the root; the loader decides, not a role gate.
 * - `virtual-filter`   — a view over existing items, no physical root.
 *                        Partners (deferred): pages where `partnerVisible=true`.
 */
export type DriveSpaceBacking =
  | "member"
  | "lab-open"
  | "workspace-multi"
  | "process-root"
  | "virtual-filter";

export type DriveRootKey = "core" | "hiring" | "mentorship";

// ── Space definition ──────────────────────────────────────────────────────────

/**
 * A declared Drive space. One per document-owning nav area.
 *
 * `gate` mirrors the same `RoleFlags` predicates `nav-areas.ts` uses so the
 * Drive space selector stays in sync with the sidebar by construction.
 */
export type DriveSpaceDef = {
  /** Stable identifier, used as the `id` of the resulting `DriveTreeScope`. */
  key: string;
  label: string;
  icon: LucideIcon;
  backing: DriveSpaceBacking;
  /**
   * Optional visibility gate. Absent means always visible to any signed-in
   * member — mirrors the `gate?` on `NavArea`.
   */
  gate?: (r: RoleFlags) => boolean;
  /**
   * For `virtual-filter` spaces: the group slug/query naming the scoping group
   * (e.g. `"core"`). Documents which group's scoped folders the space filters to.
   */
  groupQuery?: string;
  /** For `process-root` spaces: which root folder backs the space. */
  rootKey?: DriveRootKey;
};

// ── Registry ──────────────────────────────────────────────────────────────────

/**
 * Ordered list of Drive spaces. The order here is the display order in the
 * space selector. Gates use the same `RoleFlags` predicates as `nav-areas.ts`.
 *
 * Partners: virtual-filter, deferred to Wave 4.
 */
export const DRIVE_SPACES: DriveSpaceDef[] = [
  {
    key: "mine",
    label: "My Drive",
    icon: HardDrive,
    backing: "member",
    // Always visible — every signed-in member has a private drive.
  },
  {
    key: "lab",
    label: "General",
    icon: FolderKanban,
    backing: "lab-open",
    // Always visible — the lab-wide space is open to all members.
  },
  {
    key: "projects",
    label: "Projects",
    icon: FolderKanban,
    backing: "workspace-multi",
    // Visible to anyone who can be staffed on a project (all members for now;
    // Wave 1 will filter to the viewer's actual project workspaces).
  },
  {
    key: "education",
    label: "Education",
    icon: GraduationCap,
    backing: "workspace-multi",
    // Visible to enrolled students, instructors, and Core (Wave 1 filters per
    // offering). No gate here: the sub-spaces are filtered at load time.
  },
  {
    key: "core",
    label: "Core",
    icon: Shield,
    backing: "process-root",
    rootKey: "core",
  },
  {
    key: "hiring",
    label: "Hiring",
    icon: Briefcase,
    backing: "process-root",
    rootKey: "hiring",
  },
  {
    key: "mentorship",
    label: "Mentorship",
    icon: Heart,
    backing: "process-root",
    rootKey: "mentorship",
  },
];

// ── Public helpers ─────────────────────────────────────────────────────────────

/**
 * The spaces visible to one viewer: every space whose `gate` passes for the
 * given `RoleFlags`. Mirrors `visibleAreas()` in `nav-areas.ts`.
 */
export function visibleDriveSpaces(r: RoleFlags): DriveSpaceDef[] {
  return DRIVE_SPACES.filter((s) => !s.gate || s.gate(r));
}

/** Whether a Drive scope id names a process-root space (Core, Hiring, Mentorship). */
export function isProcessRootSpace(scopeId: string): boolean {
  return DRIVE_SPACES.some((s) => s.key === scopeId && s.backing === "process-root");
}
