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
 * - `virtual-filter`   — a view over existing items, no physical root. Core:
 *                        Core-group-scoped Lab folders. Partners (deferred):
 *                        pages where `partnerVisible=true`.
 */
export type DriveSpaceBacking =
  | "member"
  | "lab-open"
  | "workspace-multi"
  | "virtual-filter";

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
    // A view over Core-group-scoped folders (ordinary folders shared with the
    // Core group), not a system-owned scoped root.
    backing: "virtual-filter",
    groupQuery: "core",
    gate: (r) => r.isCore,
  },
  {
    key: "hiring",
    label: "Hiring",
    icon: Briefcase,
    // A view over the Hiring singleton's bound folders (see FOLDER_SLOTS for
    // HiringCycle / HIRING_PROCESS_ID). Keyed off the BINDING, not the folder's
    // share scope, so re-sharing a folder never ejects it from this space. The
    // folders default to Core-group scope, so this space is Core-only.
    backing: "virtual-filter",
    gate: (r) => r.isCore,
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
