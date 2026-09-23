// The /portal/education mirror of a member-shell education path, or null when
// there is none. The member layout's non-member gate maps a Dartmouth account
// with no DALIMember row onto this twin so a deep link (a public apply link, a
// bookmark, an internal nav) keeps its offering instead of dropping the student
// on the bare portal home. Every member education browsing surface has a 1:1
// portal route:
//   /education                                → /portal/education
//   /education/:id[/apply|/hub|/page/:p|/assignments/:a]
//                                             → /portal/education/…
// Returns null for /education/manage and /education/offerings (external
// instructors stay in the shell) and for /education/compliance (Core-only)
// and /education/check-in/:id (no portal route) — the caller decides
// stay-vs-/portal for those.
//
// Kept in a client-safe file (no Prisma), like feature-flags.ts, so its test
// needs no database. The gate lives in routes/layout.tsx, which runs in parallel
// with — and whose redirect wins over — each education route's own
// redirectDartmouthToPortal, so this mapping has to be applied there too.
export function educationPortalTwin(pathname: string): string | null {
  if (pathname.startsWith("/education/manage")) return null;
  if (pathname === "/education") return "/portal/education";
  const offeringTwin =
    /^\/education\/(?!compliance$|offerings$|check-in\/)[^/]+(?:\/(?:apply|hub|page\/[^/]+|assignments\/[^/]+))?$/;
  return offeringTwin.test(pathname)
    ? pathname.replace(/^\/education/, "/portal/education")
    : null;
}
