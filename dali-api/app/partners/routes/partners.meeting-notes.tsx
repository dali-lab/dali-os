import { useState, useMemo } from "react";
import { redirect, useLoaderData, useNavigate, Form, useActionData } from "react-router";
import type { Route } from "./+types/partners.meeting-notes";
import { requireAuth } from "~/lib/auth";
import { prisma } from "~/lib/db";
import { canViewStaffing } from "~/lib/roles";

export const meta: Route.MetaFunction = () => [
  { title: "Meeting Notes · DALI OS" },
];

const CATEGORIES = ["Partner", "Student", "DALI", "Faculty", "Other"] as const;
type Category = (typeof CATEGORIES)[number];

type NoteRow = {
  id: string;
  title: string;
  meetingDate: string; // ISO string
  category: Category;
  attendees: string;
  partnerOrgId: string | null;
  partnerOrgName: string | null;
  hasDoc: boolean;
};

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");
  if (auth.user.type === "applicant") return redirect("/portal");
  if (!(await canViewStaffing(auth.user.sub))) return redirect("/");

  const [notes, partnerOrgs] = await Promise.all([
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma as any).partnerMeetingNote.findMany({
      orderBy: { meetingDate: "desc" },
      select: {
        id: true,
        title: true,
        meetingDate: true,
        category: true,
        attendees: true,
        contentDocId: true,
        partnerOrgId: true,
        partnerOrg: { select: { name: true } },
      },
    }),
    prisma.partnerOrg.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  const rows: NoteRow[] = notes.map(
    (n: {
      id: string;
      title: string;
      meetingDate: Date;
      category: string;
      attendees: string;
      contentDocId: string | null;
      partnerOrgId: string | null;
      partnerOrg: { name: string } | null;
    }) => ({
      id: n.id,
      title: n.title,
      meetingDate: n.meetingDate.toISOString(),
      category: n.category as Category,
      attendees: n.attendees,
      partnerOrgId: n.partnerOrgId,
      partnerOrgName: n.partnerOrg?.name ?? null,
      hasDoc: Boolean(n.contentDocId),
    }),
  );

  return { rows, partnerOrgs };
}

export async function action({ request }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");
  if (auth.user.type === "applicant") return redirect("/portal");
  if (!(await canViewStaffing(auth.user.sub))) {
    return { error: "You don't have permission to create meeting notes." };
  }

  const form = await request.formData();
  const title = (form.get("title") as string | null)?.trim() ?? "";
  const meetingDateRaw = (form.get("meetingDate") as string | null) ?? "";
  const category = (form.get("category") as string | null) ?? "";
  const partnerOrgId =
    (form.get("partnerOrgId") as string | null)?.trim() || null;

  if (!title) return { error: "Title is required." };
  if (!meetingDateRaw) return { error: "Meeting date is required." };
  if (!CATEGORIES.includes(category as Category))
    return { error: "Invalid category." };

  const meetingDate = new Date(meetingDateRaw);
  if (isNaN(meetingDate.getTime())) return { error: "Invalid date." };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const created = await (prisma as any).partnerMeetingNote.create({
    data: { title, meetingDate, category, partnerOrgId },
    select: { id: true },
  });

  return redirect(`/partners/meeting-notes/${created.id}`);
}

const CATEGORY_PILL: Record<Category, string> = {
  Partner: "bg-accent-coral/15 text-accent-coral",
  Student: "bg-accent-teal/15 text-accent-teal",
  DALI: "bg-accent-teal/25 text-accent-teal",
  Faculty: "bg-muted text-foreground",
  Other: "bg-muted/50 text-muted-foreground",
};

function CategoryPill({ category }: { category: Category }) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded ${CATEGORY_PILL[category]}`}
    >
      {category}
    </span>
  );
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function PartnersMeetingNotes() {
  const { rows, partnerOrgs } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigate = useNavigate();

  const [creating, setCreating] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState<Category | "all">("all");
  const [partnerFilter, setPartnerFilter] = useState<string>("all");
  const [sortBy, setSortBy] = useState<"date" | "category" | "partner">("date");
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows
      .filter((n) => {
        if (categoryFilter !== "all" && n.category !== categoryFilter)
          return false;
        if (partnerFilter !== "all" && n.partnerOrgId !== partnerFilter)
          return false;
        if (!q) return true;
        return (
          n.title.toLowerCase().includes(q) ||
          n.attendees.toLowerCase().includes(q) ||
          (n.partnerOrgName?.toLowerCase().includes(q) ?? false)
        );
      })
      .sort((a, b) => {
        if (sortBy === "date")
          return (
            new Date(b.meetingDate).getTime() -
            new Date(a.meetingDate).getTime()
          );
        if (sortBy === "category")
          return a.category.localeCompare(b.category);
        return (a.partnerOrgName ?? "").localeCompare(b.partnerOrgName ?? "");
      });
  }, [rows, categoryFilter, partnerFilter, sortBy, query]);

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="font-heading text-2xl font-bold text-foreground">
            Meeting Notes
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Notes from partner, student, DALI, faculty, and other meetings.
          </p>
        </div>
        {!creating && (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="px-3 py-1.5 text-sm font-medium rounded-md bg-accent-coral text-white hover:bg-accent-coral/90 transition-colors"
          >
            + New note
          </button>
        )}
      </header>

      {actionData?.error && (
        <div className="bg-destructive/10 border border-destructive/30 text-destructive text-sm rounded-md px-3 py-2">
          {actionData.error}
        </div>
      )}

      {creating && (
        <Form
          method="post"
          onSubmit={() => setCreating(false)}
          className="bg-card border border-border rounded-lg p-4 flex flex-col gap-3"
        >
          <h2 className="text-sm font-semibold text-foreground">New meeting note</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-xs sm:col-span-2">
              <span className="text-muted-foreground">Title</span>
              <input
                name="title"
                autoFocus
                required
                placeholder="e.g. Hood Museum — scope review"
                className="px-2 py-1.5 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-accent-coral/30"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs">
              <span className="text-muted-foreground">Meeting date</span>
              <input
                name="meetingDate"
                type="date"
                required
                defaultValue={new Date().toISOString().slice(0, 10)}
                className="px-2 py-1.5 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-accent-coral/30"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs">
              <span className="text-muted-foreground">Category</span>
              <select
                name="category"
                required
                defaultValue="Partner"
                className="px-2 py-1.5 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-accent-coral/30"
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs sm:col-span-2">
              <span className="text-muted-foreground">
                Partner org{" "}
                <span className="text-muted-foreground/60">(optional)</span>
              </span>
              <select
                name="partnerOrgId"
                defaultValue=""
                className="px-2 py-1.5 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-accent-coral/30"
              >
                <option value="">None</option>
                {partnerOrgs.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setCreating(false)}
              className="px-3 py-1.5 text-xs font-medium rounded-md border border-border hover:bg-muted transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-3 py-1.5 text-xs font-medium rounded-md bg-accent-coral text-white hover:bg-accent-coral/90 transition-colors"
            >
              Create &amp; open
            </button>
          </div>
        </Form>
      )}

      {/* Filter / sort bar */}
      <div className="flex items-center gap-3 flex-wrap">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by title, attendees, or partner"
          className="flex-1 min-w-[200px] max-w-sm px-3 py-2 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-accent-coral/30"
        />
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value as Category | "all")}
          aria-label="Filter by category"
          className="px-2 py-2 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-accent-coral/30"
        >
          <option value="all">All categories</option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <select
          value={partnerFilter}
          onChange={(e) => setPartnerFilter(e.target.value)}
          aria-label="Filter by partner"
          className="px-2 py-2 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-accent-coral/30"
        >
          <option value="all">All partners</option>
          {partnerOrgs.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
          aria-label="Sort by"
          className="px-2 py-2 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-accent-coral/30"
        >
          <option value="date">Sort: Date</option>
          <option value="category">Sort: Category</option>
          <option value="partner">Sort: Partner</option>
        </select>
      </div>

      {/* Notion-style DB table */}
      <div className="bg-card border border-border rounded-lg overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h2 className="text-sm font-medium text-foreground">Notes</h2>
          <span className="text-xs text-muted-foreground">
            {filtered.length}{" "}
            {filtered.length === 1 ? "note" : "notes"}
            {filtered.length !== rows.length ? ` of ${rows.length}` : ""}
          </span>
        </div>

        {filtered.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">
            {rows.length === 0
              ? "No meeting notes yet. Create one to get started."
              : "No notes match these filters."}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[640px]">
              <thead className="bg-muted/30 text-muted-foreground text-xs uppercase tracking-wide">
                <tr>
                  <th className="text-left font-medium px-4 py-2">Title</th>
                  <th className="text-left font-medium px-4 py-2">Date</th>
                  <th className="text-left font-medium px-4 py-2">Category</th>
                  <th className="text-left font-medium px-4 py-2">Partner</th>
                  <th className="text-left font-medium px-4 py-2">Attendees</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((n) => (
                  <tr
                    key={n.id}
                    onClick={() => navigate(`/partners/meeting-notes/${n.id}`)}
                    className="border-t border-border hover:bg-muted/20 cursor-pointer"
                  >
                    <td className="px-4 py-2.5 text-foreground font-medium">
                      <span className="flex items-center gap-2">
                        {n.title}
                        {!n.hasDoc && (
                          <span className="text-[10px] text-muted-foreground/60 font-normal">
                            draft
                          </span>
                        )}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground whitespace-nowrap">
                      {formatDate(n.meetingDate)}
                    </td>
                    <td className="px-4 py-2.5">
                      <CategoryPill category={n.category} />
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">
                      {n.partnerOrgName ?? "—"}
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground max-w-xs truncate">
                      {n.attendees
                        ? n.attendees
                            .split(/[\n,]/)
                            .map((s) => s.trim())
                            .filter(Boolean)
                            .join(", ")
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
