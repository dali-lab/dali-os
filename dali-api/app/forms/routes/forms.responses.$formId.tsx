import { useMemo, useState } from "react";
import { Link, redirect, useLoaderData, useSearchParams } from "react-router";
import { redirectToLogin } from "~/lib/login-next";
import { Download, Search } from "lucide-react";
import { Tooltip } from "~/components/ui/floating";
import { Select } from "~/components/ui/floating";
import type { Route } from "./+types/forms.responses.$formId";
import { requireAuth, redirectApplicantToPortal } from "~/lib/auth";
import { isCore } from "~/lib/roles";
import { prisma } from "~/lib/db";
import { recordRouteVisit } from "~/lib/user-pages.server";
import { buildResponseGrid } from "~/forms/lib/answer-rows.server";
import { Modal, ModalHeader } from "~/components/Modal";
import type { Question } from "~/types";

export const meta: Route.MetaFunction = ({ data }) => [
  {
    title: `Responses · ${(data as { formName?: string } | undefined)?.formName ?? "Form"} · DALI OS`,
  },
];

// Expands the id segment into the form's real location — folder ancestry,
// the form name (linked to the editor), then a "Responses" leaf. The literal
// "responses" URL segment is dropped by Breadcrumbs' DROPPED_SEGMENTS.
export const handle = {
  breadcrumb: (data: unknown) => {
    const d = data as
      | { formId?: string; formName?: string }
      | undefined;
    if (!d?.formName) return null;
    return [
      { label: d.formName, to: `/forms/edit/${d.formId}` },
      { label: "Responses" },
    ];
  },
};

// Show the newest N submissions inline; the CSV export covers the full set.
const MAX_RESPONSES = 200;

type ResponseRow = {
  id: string;
  createdAt: string;
  versionNumber: number;
  name: string;
  email: string | null;
  slot: string | null;
  // Only anonymous (Public-audience) fills carry an IP.
  submitterIp: string | null;
  partnerApplication: { id: string; title: string } | null;
  rows: { key: string; label: string; value: string }[];
};

export async function loader({ request, params }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  const portalRedirect = redirectApplicantToPortal(auth);
  if (portalRedirect) return portalRedirect;
  if (!(await isCore(auth.user.sub))) return redirect("/");

  const form = await prisma.form.findUnique({
    where: { id: params.formId },
    select: {
      id: true,
      name: true,
      _count: { select: { submissions: true } },
    },
  });
  if (!form) return redirect("/drive?type=form");
  // After the Core gate — the responses view the viewer can open lands in recents.
  recordRouteVisit(auth.user.sub, `/forms/responses/${form.id}`, `${form.name} responses`, request);

  // When this form is the bound partner application form, the applications
  // board is the canonical review surface — this page is just the raw view.
  const partnerBinding = await prisma.partnerApplicationFormBinding.findFirst({
    where: { formId: form.id },
    select: { id: true },
  });

  const submissions = await prisma.formSubmission.findMany({
    where: { formId: form.id },
    orderBy: { createdAt: "desc" },
    take: MAX_RESPONSES,
    select: {
      id: true,
      createdAt: true,
      answers: true,
      submitterName: true,
      submitterEmail: true,
      submitterIp: true,
      slot: true,
      user: {
        select: {
          firstName: true,
          lastName: true,
          daliEmail: true,
          personalEmail: true,
        },
      },
      formVersion: { select: { versionNumber: true, questions: true } },
      partnerApplication: { select: { id: true, title: true } },
    },
  });

  const grid = await buildResponseGrid(
    submissions.map((s) => ({
      formVersion: {
        versionNumber: s.formVersion.versionNumber,
        questions: (s.formVersion.questions as unknown as Question[]) ?? [],
      },
      answers: (s.answers as Record<string, unknown>) ?? {},
    })),
  );

  const responses: ResponseRow[] = submissions.map((s, i) => ({
    id: s.id,
    createdAt: s.createdAt.toISOString(),
    versionNumber: s.formVersion.versionNumber,
    name:
      [s.user?.firstName, s.user?.lastName].filter(Boolean).join(" ") ||
      s.submitterName ||
      "Anonymous",
    email:
      s.user?.daliEmail || s.user?.personalEmail || s.submitterEmail || null,
    slot: s.slot,
    submitterIp: s.submitterIp,
    partnerApplication: s.partnerApplication,
    rows: grid.rowsBySubmission[i],
  }));

  const versionOptions = [
    ...new Set(responses.map((r) => r.versionNumber)),
  ].sort((a, b) => b - a);
  const slotOptions = [
    ...new Set(responses.flatMap((r) => (r.slot ? [r.slot] : []))),
  ].sort();

  return {
    formId: form.id,
    formName: form.name,
    isPartnerApplicationForm: partnerBinding !== null,
    totalCount: form._count.submissions,
    columns: grid.columns,
    versionOptions,
    slotOptions,
    responses,
  };
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function ResponseDetailBody({ response }: { response: ResponseRow }) {
  return (
    <div className="space-y-4">
      {response.partnerApplication && (
        <Link
          to={`/partners/applications/${response.partnerApplication.id}`}
          className="inline-block text-xs font-medium text-accent-teal hover:underline"
        >
          Partner application: {response.partnerApplication.title} →
        </Link>
      )}
      <dl className="flex flex-col gap-3">
        {response.rows.map((row) => (
          <div key={row.key}>
            <dt className="text-xs font-medium text-muted-foreground mb-0.5">
              {row.label}
            </dt>
            <dd className="text-sm text-foreground whitespace-pre-wrap">
              {row.value || "—"}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export default function FormResponses() {
  const {
    formId,
    formName,
    isPartnerApplicationForm,
    totalCount,
    columns,
    versionOptions,
    slotOptions,
    responses,
  } = useLoaderData<typeof loader>();

  // Preselect the version filter when arriving from a version card's
  // "Responses" link (?version=N); still user-adjustable afterward.
  const [searchParams] = useSearchParams();
  const [query, setQuery] = useState("");
  const [version, setVersion] = useState(searchParams.get("version") ?? "");
  const [slot, setSlot] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

  const rows = useMemo(
    () =>
      responses.map((r) => ({
        ...r,
        values: new Map(r.rows.map((row) => [row.key, row.value])),
      })),
    [responses],
  );

  const filteredRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (version && String(r.versionNumber) !== version) return false;
      if (slot && r.slot !== slot) return false;
      if (q && !`${r.name} ${r.email ?? ""}`.toLowerCase().includes(q))
        return false;
      return true;
    });
  }, [rows, query, version, slot]);

  const selected = responses.find((r) => r.id === openId) ?? null;
  const hasSlotColumn = slotOptions.length > 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">
          {formName} · Responses
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {totalCount} {totalCount === 1 ? "response" : "responses"}
          {totalCount > responses.length &&
            ` · showing the ${responses.length} most recent`}
        </p>
      </div>

      {isPartnerApplicationForm && (
        <Link
          to="/partners/applications"
          className="block bg-accent-teal/10 border border-accent-teal/30 rounded-lg px-4 py-3 text-sm text-accent-teal font-medium hover:bg-accent-teal/15 transition"
        >
          These responses are partner applications — review them on the
          Partner Applications board →
        </Link>
      )}

      {totalCount === 0 ? (
        <div className="text-center py-12 bg-card rounded-xl border border-border border-dashed">
          <p className="text-sm text-muted-foreground">No responses yet.</p>
        </div>
      ) : (
        <>
          <div className="flex flex-col sm:flex-row sm:items-center gap-2">
            {versionOptions.length > 1 && (
              <Select
                ariaLabel="Filter by version"
                value={version}
                onChange={(v) => setVersion(v)}
                placeholder="All versions"
                options={[
                  { value: "", label: "All versions" },
                  ...versionOptions.map((v) => ({ value: String(v), label: `v${v}` })),
                ]}
                buttonClassName="px-3 py-1.5 text-sm border border-border rounded-md bg-background text-foreground sm:w-40 inline-flex items-center justify-between gap-1 transition-colors hover:bg-muted/40"
              />
            )}
            {hasSlotColumn && (
              <Select
                ariaLabel="Filter by slot"
                value={slot}
                onChange={(v) => setSlot(v)}
                placeholder="All slots"
                options={[
                  { value: "", label: "All slots" },
                  ...slotOptions.map((s) => ({ value: s, label: s })),
                ]}
                buttonClassName="px-3 py-1.5 text-sm border border-border rounded-md bg-background text-foreground sm:w-48 inline-flex items-center justify-between gap-1 transition-colors hover:bg-muted/40"
              />
            )}
            <div className="relative w-full sm:ml-auto sm:w-64 min-w-[12rem]">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/70 pointer-events-none" />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search by name or email"
                aria-label="Search responses by name or email"
                className="w-full pl-8 pr-3 py-1.5 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-accent-coral/30"
              />
            </div>
            <Tooltip content="Export CSV — exports all responses, ignoring current filters">
              <a
                href={`/forms/responses/${formId}/export.csv`}
                download
                aria-label="Export CSV"
                className="inline-flex items-center justify-center p-1.5 text-sm font-medium rounded-md border border-border text-foreground hover:bg-muted/50 transition-colors whitespace-nowrap"
              >
                <Download className="w-4 h-4" />
              </a>
            </Tooltip>
          </div>

          <div className="bg-card border border-border shadow-brand-1 rounded-lg overflow-hidden">
            {filteredRows.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                No responses match the current filters.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[640px]">
                  <thead className="bg-muted/30 text-muted-foreground text-xs uppercase tracking-wide">
                    <tr>
                      <th className="text-left font-medium px-4 py-2">
                        Respondent ({filteredRows.length}
                        {filteredRows.length === rows.length
                          ? ""
                          : ` of ${rows.length}`}
                        )
                      </th>
                      <th className="text-left font-medium px-4 py-2">Email</th>
                      <th className="text-left font-medium px-4 py-2">
                        Submitted
                      </th>
                      <th className="text-left font-medium px-4 py-2">
                        Version
                      </th>
                      {hasSlotColumn && (
                        <th className="text-left font-medium px-4 py-2">
                          Slot
                        </th>
                      )}
                      {columns.map((c) => (
                        <th
                          key={c.key}
                          className="text-left font-medium px-4 py-2"
                        >
                          <div className="max-w-[16rem] truncate" title={c.label}>
                            {c.label}
                          </div>
                        </th>
                      ))}
                      {isPartnerApplicationForm && (
                        <th className="text-left font-medium px-4 py-2">
                          Partner app
                        </th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRows.map((r) => (
                      <tr
                        key={r.id}
                        onClick={() => setOpenId(r.id)}
                        className="border-t border-border hover:bg-muted/20 cursor-pointer"
                      >
                        <td className="px-4 py-2 text-foreground font-medium whitespace-nowrap">
                          {r.name}
                        </td>
                        <td className="px-4 py-2 text-muted-foreground">
                          {r.email ?? "—"}
                        </td>
                        <td className="px-4 py-2 text-muted-foreground whitespace-nowrap">
                          {formatDate(r.createdAt)}
                        </td>
                        <td className="px-4 py-2 text-muted-foreground">
                          v{r.versionNumber}
                        </td>
                        {hasSlotColumn && (
                          <td className="px-4 py-2 text-muted-foreground">
                            {r.slot ?? "—"}
                          </td>
                        )}
                        {columns.map((c) => {
                          const value = r.values.get(c.key) ?? "";
                          return (
                            <td key={c.key} className="px-4 py-2 text-foreground">
                              <div
                                className="max-w-[16rem] truncate"
                                title={value || undefined}
                              >
                                {value || "—"}
                              </div>
                            </td>
                          );
                        })}
                        {isPartnerApplicationForm && (
                          <td className="px-4 py-2">
                            {r.partnerApplication ? (
                              <Link
                                to={`/partners/applications/${r.partnerApplication.id}`}
                                onClick={(e) => e.stopPropagation()}
                                className="text-xs font-medium text-accent-teal hover:underline whitespace-nowrap"
                              >
                                {r.partnerApplication.title} →
                              </Link>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      <Modal
        open={selected !== null}
        onClose={() => setOpenId(null)}
        labelledBy="response-detail-title"
        containerClassName="bg-card rounded-2xl shadow-brand-2 max-w-2xl w-full p-5 sm:p-6 my-auto max-h-[85vh] overflow-y-auto"
      >
        {selected && (
          <>
            <ModalHeader
              titleId="response-detail-title"
              title={selected.name}
              subtitle={[
                selected.email,
                formatTimestamp(selected.createdAt),
                `v${selected.versionNumber}`,
                selected.slot,
                selected.submitterIp && `IP ${selected.submitterIp}`,
              ]
                .filter(Boolean)
                .join(" · ")}
              onClose={() => setOpenId(null)}
            />
            <ResponseDetailBody response={selected} />
          </>
        )}
      </Modal>
    </div>
  );
}
