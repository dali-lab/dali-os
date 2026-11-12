import { matchPath } from "react-router";

type Params = Record<string, string | undefined>;

export type LegacyRedirect = {
  path: string;
  to: string | ((args: { params: Params; search: URLSearchParams }) => string);
  status: 301 | 302;
  query: "keep" | "drop";
};

const seg = (value: string | undefined) => encodeURIComponent(value ?? "");

const adminMoves: Array<[string, string]> = [
  ["system", "/admin"],
  ["payroll-export", "/admin/payroll/hire-setup"],
  ["site-users", "/admin/accounts/users"],
  ["security", "/admin/accounts/security"],
  ["outbound-messages", "/admin/messaging/outbox"],
  ["email-senders", "/admin/messaging/senders"],
  ["analytics", "/admin/insights/analytics"],
  ["ai-usage", "/admin/insights/ai-usage"],
  ["activity", "/admin/insights/audit-log"],
  ["jobs", "/admin/platform/jobs"],
  ["infrastructure", "/admin/platform/infrastructure"],
  ["feature-flags", "/admin/platform/flags"],
  ["activities", "/admin/onboarding"],
];

const hiringHome = (view: string) => (search: URLSearchParams) => {
  const next = new URLSearchParams(search);
  next.set("view", view);
  return `/hiring?${next}`;
};

export const LEGACY_REDIRECTS: LegacyRedirect[] = [
  ...adminMoves.map(([from, to]): LegacyRedirect => ({ path: `admin/${from}`, to, status: 301, query: "keep" })),
  { path: "admin/activities/:id", to: ({ params }) => `/admin/onboarding/${seg(params.id)}`, status: 301, query: "keep" },
  { path: "core/rooms", to: "/admin/rooms", status: 301, query: "keep" },

  { path: "hiring/emails", to: "/core/communications/email", status: 302, query: "drop" },
  { path: "hiring/emails/:id", to: "/core/communications/email", status: 302, query: "drop" },
  { path: "admin/email-templates", to: "/core/communications/email", status: 302, query: "drop" },
  { path: "admin/email-templates/:id", to: "/core/communications/email", status: 302, query: "drop" },
  { path: "core/communications/email/:id", to: "/core/communications/email", status: 302, query: "drop" },

  { path: "partners", to: "/core/partners/directory", status: 302, query: "keep" },
  { path: "partners/applications", to: "/core/partners", status: 302, query: "keep" },
  { path: "partners/applications/:id", to: ({ params }) => `/core/partners/applications/${seg(params.id)}`, status: 302, query: "keep" },
  { path: "partners/:orgId", to: ({ params }) => `/core/partners/orgs/${seg(params.orgId)}`, status: 302, query: "keep" },

  {
    path: "connect/*",
    to: ({ params }) => `/community${params["*"] ? `/${params["*"].split("/").map(seg).join("/")}` : ""}`,
    status: 301,
    query: "keep",
  },
  { path: "intern-to-full", to: "/fellowship", status: 301, query: "drop" },
  { path: "help/:slug", to: ({ params }) => `/help/articles/${seg(params.slug)}`, status: 301, query: "drop" },

  { path: "internal-processes/level-up", to: "/core/level-up", status: 302, query: "keep" },
  { path: "core/access/roles", to: "/core/access", status: 302, query: "keep" },
  { path: "core/access/domains", to: "/core/access", status: 302, query: "keep" },
  { path: "core/communications/email-senders", to: "/admin/messaging/senders", status: 302, query: "drop" },
  { path: "admin/people", to: "/core/access", status: 302, query: "drop" },
  { path: "admin/communications", to: "/core/communications", status: 302, query: "drop" },
  { path: "education/manage", to: "/education/offerings", status: 302, query: "keep" },

  {
    path: "hiring/reviewer",
    to: ({ search }) => hiringHome(search.get("view") === "delibs" ? "delibs" : "reviews")(search),
    status: 302,
    query: "drop",
  },
  { path: "hiring/interviews", to: ({ search }) => hiringHome("interviews")(search), status: 302, query: "drop" },
  {
    path: "hiring/analytics",
    to: ({ search }) => {
      const cycleId = search.get("cycleId");
      return cycleId ? `/hiring/applications?cycle=${encodeURIComponent(cycleId)}` : "/hiring/applications";
    },
    status: 302,
    query: "drop",
  },
  { path: "hiring/lead/internal-cycle/:id", to: ({ params }) => `/hiring/lead/cycle/${seg(params.id)}`, status: 302, query: "keep" },
  {
    path: "forms/responses/:formId",
    to: ({ params, search }) => {
      const next = new URLSearchParams({ view: "results" });
      const version = search.get("version");
      if (version) next.set("version", version);
      return `/forms/edit/${seg(params.formId)}?${next}`;
    },
    status: 302,
    query: "drop",
  },

  { path: "projects/staffing", to: "/core/staffing", status: 302, query: "keep" },
  { path: "projects/intent-to-work", to: "/core/intent-to-work", status: 302, query: "keep" },
  { path: "projects/intent-to-work/:userId", to: ({ params }) => `/core/intent-to-work/${seg(params.userId)}`, status: 302, query: "keep" },
  { path: "projects/project-bids", to: "/core/project-bids", status: 302, query: "keep" },
  { path: "projects/project-bids/:userId", to: ({ params }) => `/core/project-bids/${seg(params.userId)}`, status: 302, query: "keep" },
  { path: "projects/level-up", to: "/core/level-up", status: 302, query: "keep" },
  { path: "projects/level-up/:userId", to: ({ params }) => `/core/level-up/${seg(params.userId)}`, status: 302, query: "keep" },
  { path: "admin/announcements", to: "/core/communications/announcements", status: 302, query: "keep" },
  { path: "admin/email", to: "/core/communications/email", status: 302, query: "keep" },
];

function withQuery(to: string, search: string): string {
  if (!search || search === "?") return to;
  const extra = search.replace(/^\?/, "");
  return to.includes("?") ? `${to}&${extra}` : `${to}?${extra}`;
}

export function resolveLegacyRedirect(
  pathname: string,
  search = "",
): { to: string; status: 301 | 302 } | null {
  for (const entry of LEGACY_REDIRECTS) {
    const match = matchPath({ path: entry.path, end: true }, pathname);
    if (!match) continue;
    const to =
      typeof entry.to === "string"
        ? entry.to
        : entry.to({ params: match.params, search: new URLSearchParams(search) });
    return { to: entry.query === "keep" ? withQuery(to, search) : to, status: entry.status };
  }
  return null;
}
