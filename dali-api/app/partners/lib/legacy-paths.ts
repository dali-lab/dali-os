// Pure path mapping for the pre-regroup /partners URLs, now that the internal
// partner surface lives under /core/partners (Partner CRM). One redirect
// route module (partners.legacy-redirect.ts) is registered under all four old
// paths, so this looks at the actual requested pathname rather than trusting
// which registration matched. The external portal at /partner/* (singular)
// is a different surface and has no entry here.
export function mapLegacyPartnerPath(pathname: string, search = ""): string {
  const APPLICATIONS_ID_PREFIX = "/partners/applications/";
  const ORG_PREFIX = "/partners/";

  let to: string;
  if (pathname === "/partners") {
    to = "/core/partners/directory";
  } else if (pathname === "/partners/applications") {
    to = "/core/partners";
  } else if (pathname.startsWith(APPLICATIONS_ID_PREFIX)) {
    to = `/core/partners/applications/${pathname.slice(APPLICATIONS_ID_PREFIX.length)}`;
  } else if (pathname.startsWith(ORG_PREFIX)) {
    to = `/core/partners/orgs/${pathname.slice(ORG_PREFIX.length)}`;
  } else {
    to = "/core/partners";
  }
  return search ? `${to}${search}` : to;
}
