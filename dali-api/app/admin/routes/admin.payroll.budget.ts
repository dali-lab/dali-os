import type { Route } from "./+types/admin.payroll.budget";
import { redirect } from "react-router";
import { z } from "zod";
import { requireAuth, forbidden } from "~/lib/auth";
import { isAdmin } from "~/lib/roles";
import { resolveTermFilter } from "~/lib/terms";
import {
  getBudgetData,
  upsertRevenue,
  deleteEntry,
  updateChartString,
  upsertNote,
  updateProjectType,
} from "~/admin/lib/budget";
// PROJECT_TYPES comes from the client-safe shared module (not budget.ts) so
// tests can fully mock budget.ts without the zod schema losing the real list.
import {
  PROJECT_TYPES,
  type BudgetData,
} from "~/admin/lib/budget.shared";

// Resource route (GET + action) for the Budget tab. Loaded lazily by the page
// via useFetcher().load('/admin/payroll/budget?term=…') on first tab
// activation. Same admin gate as the page — on BOTH loader and action.

export type BudgetLoaderData =
  | { ok: true; budget: BudgetData; termId: string }
  | { ok: false; error: string };

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");
  if (!(await isAdmin(auth.user.sub))) return forbidden(request);

  const { termId } = await resolveTermFilter(request);
  if (!termId) {
    return Response.json({ ok: false, error: "No term selected" } satisfies BudgetLoaderData, {
      status: 400,
    });
  }

  const budget = await getBudgetData(termId);
  return Response.json({ ok: true, budget, termId } satisfies BudgetLoaderData);
}

// ─── action ──────────────────────────────────────────────────────────────────

const nullableProjectId = z
  .string()
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .transform((v) => v ?? null);

const keyFields = {
  projectId: nullableProjectId,
  chartString: z.string().min(1),
  termId: z.string().min(1),
};

const upsertRevenueSchema = z.object({
  intent: z.literal("upsert-revenue"),
  ...keyFields,
  revenue: z.coerce.number().finite(),
});

const deleteEntrySchema = z.object({
  intent: z.literal("delete-entry"),
  entryId: z.string().min(1),
});

const updateChartStringSchema = z.object({
  intent: z.literal("update-chartstring"),
  ...keyFields,
  newChartString: z.string().min(1),
});

const upsertNoteSchema = z.object({
  intent: z.literal("upsert-note"),
  ...keyFields,
  note: z.string(),
});

const updateProjectTypeSchema = z.object({
  intent: z.literal("update-project-type"),
  ...keyFields,
  projectType: z
    .string()
    .transform((v) => v.trim())
    .refine((v) => v === "" || (PROJECT_TYPES as readonly string[]).includes(v), {
      message: "Invalid project type",
    })
    .transform((v) => (v === "" ? null : v)),
});

function jsonError(message: string, status: number): Response {
  return Response.json({ ok: false, error: message }, { status });
}

export async function action({ request }: Route.ActionArgs): Promise<Response> {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  if (!(await isAdmin(auth.user.sub))) return forbidden(request);

  const form = Object.fromEntries(await request.formData());
  const intent = form.intent;

  try {
    switch (intent) {
      case "upsert-revenue": {
        const p = upsertRevenueSchema.parse(form);
        await upsertRevenue(
          { projectId: p.projectId, chartString: p.chartString, termId: p.termId },
          p.revenue,
        );
        return Response.json({ ok: true });
      }
      case "delete-entry": {
        const p = deleteEntrySchema.parse(form);
        await deleteEntry(p.entryId);
        return Response.json({ ok: true });
      }
      case "update-chartstring": {
        const p = updateChartStringSchema.parse(form);
        await updateChartString(
          { projectId: p.projectId, chartString: p.chartString, termId: p.termId },
          p.newChartString,
        );
        return Response.json({ ok: true });
      }
      case "upsert-note": {
        const p = upsertNoteSchema.parse(form);
        await upsertNote(
          { projectId: p.projectId, chartString: p.chartString, termId: p.termId },
          p.note,
        );
        return Response.json({ ok: true });
      }
      case "update-project-type": {
        const p = updateProjectTypeSchema.parse(form);
        await updateProjectType(
          { projectId: p.projectId, chartString: p.chartString, termId: p.termId },
          p.projectType,
        );
        return Response.json({ ok: true });
      }
      default:
        return jsonError("Unknown intent", 400);
    }
  } catch (e) {
    if (e instanceof z.ZodError) {
      return jsonError(e.issues[0]?.message ?? "Invalid input", 400);
    }
    return jsonError(e instanceof Error ? e.message : "Budget update failed", 400);
  }
}
