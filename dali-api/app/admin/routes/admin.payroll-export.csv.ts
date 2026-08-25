import type { Route } from "./+types/admin.payroll-export.csv";
import { prisma } from "~/lib/db";
import { requireAuth, forbidden } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { csvResponse } from "~/lib/csv";
import { isAdmin } from "~/lib/roles";
import { isLevel, type Level } from "~/lib/level";
import {
  buildCoreRows,
  buildInstructorRows,
  buildPayrollRows,
  pickDefaultTermId,
  rowsToCsv,
} from "~/admin/lib/payroll-export";

// Comma-separated user-id list → Set. Empty/null → empty set (= no rows).
function parseIdList(raw: string | null): Set<string> {
  if (!raw) return new Set();
  return new Set(raw.split(",").map((s) => s.trim()).filter(Boolean));
}

// Comma-separated value list → trimmed, deduped string array.
function parseCsvParam(raw: string | null): string[] {
  if (!raw) return [];
  return [...new Set(raw.split(",").map((s) => s.trim()).filter(Boolean))];
}

// Only accept the three real Level values; anything else is dropped.
function parseLevels(raw: string | null): Level[] {
  return parseCsvParam(raw).filter(isLevel);
}

// Resource route — no default export, no layout wrapping. Returning a Response
// from a route that's nested under the app layout would have the layout shell
// rendered around it (i.e. an HTML page wrapping a CSV body). Splitting the
// download into its own resource route under a non-layout path keeps it as a
// pure byte stream.

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  if (!(await isAdmin(auth.user.sub))) {
    return forbidden(request);
  }

  const url = new URL(request.url);
  const requestedTermId = url.searchParams.get("termId");

  const terms = await prisma.term.findMany({
    orderBy: { sortKey: "desc" },
    select: { id: true, code: true, startDate: true, endDate: true },
  });

  const selectedTermId =
    (requestedTermId && terms.some((t) => t.id === requestedTermId)
      ? requestedTermId
      : pickDefaultTermId(terms));
  const selectedTerm = terms.find((t) => t.id === selectedTermId);
  if (!selectedTerm) {
    return new Response("No terms available", { status: 404 });
  }

  // Optional role filter on the project section (?domain= / ?level=). When
  // either is active the admin is slicing out one domain/level group (e.g. PMs
  // ahead of the rest), so Core + Instructor rows — which carry no domain or
  // level — are excluded to keep the slice clean.
  const domainIds = parseCsvParam(url.searchParams.get("domain"));
  const levels = parseLevels(url.searchParams.get("level"));
  const roleFilterActive = domainIds.length > 0 || levels.length > 0;

  // Project rows always included; Core + Instructor rows only for the
  // user-ids the admin checked on the page (passed via ?core= / ?instructor=),
  // and only when no role filter is narrowing the export.
  const coreIds = roleFilterActive
    ? new Set<string>()
    : parseIdList(url.searchParams.get("core"));
  const instructorIds = roleFilterActive
    ? new Set<string>()
    : parseIdList(url.searchParams.get("instructor"));

  const [projectRows, coreRows, instructorRows] = await Promise.all([
    buildPayrollRows(selectedTerm.id, { domainIds, levels }),
    buildCoreRows(selectedTerm.id, coreIds),
    buildInstructorRows(selectedTerm.id, instructorIds),
  ]);
  const csv = rowsToCsv([...projectRows, ...coreRows, ...instructorRows]);
  // Sortable ISO date stamp for the filename (distinct from the MMDDYY hire
  // dates inside the CSV).
  const fileStamp = new Date().toISOString().slice(0, 10);
  const filename = `payroll-${selectedTerm.code}-${fileStamp}.csv`;

  return csvResponse(csv, filename, {
    status: 200,
    headers: { "Cache-Control": "no-store" },
  });
}
