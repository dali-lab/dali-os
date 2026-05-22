import {
  Form,
  Link,
  redirect,
  useActionData,
  useLoaderData,
  useRevalidator,
} from "react-router";
import { ChevronLeft } from "lucide-react";
import type { Route } from "./+types/partners.meeting-notes.$id";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { parseSessionCookie } from "~/lib/cookies";
import { canViewStaffing } from "~/lib/roles";
import { CollaborativeEditor } from "~/components/CollaborativeEditor";
import { PresenceProvider } from "~/components/collab/PresenceProvider";

export const meta: Route.MetaFunction = ({ data }) => {
  const title = (data as { note?: { title: string } } | undefined)?.note
    ?.title;
  return [
    {
      title: title
        ? `${title} · Meeting Notes · DALI OS`
        : "Meeting Note · DALI OS",
    },
  ];
};

const CATEGORIES = ["Partner", "Student", "DALI", "Faculty", "Other"] as const;
type Category = (typeof CATEGORIES)[number];

const CATEGORY_PILL: Record<Category, string> = {
  Partner: "bg-accent-coral/15 text-accent-coral",
  Student: "bg-accent-teal/15 text-accent-teal",
  DALI: "bg-accent-teal/25 text-accent-teal",
  Faculty: "bg-muted text-foreground",
  Other: "bg-muted/50 text-muted-foreground",
};

export async function loader({ request, params }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");
  if (auth.user.type === "applicant") return redirect("/portal");
  if (!(await canViewStaffing(auth.user.sub))) return redirect("/");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const note = await (prisma as any).partnerMeetingNote.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      title: true,
      meetingDate: true,
      category: true,
      attendees: true,
      contentDocId: true,
      partnerOrgId: true,
      partnerOrg: { select: { id: true, name: true } },
    },
  });
  if (!note) throw new Response("Not found", { status: 404 });

  const partnerOrgs = await prisma.partnerOrg.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

  // Ensure the collab doc row exists on first open. The template is seeded
  // server-side by persistence.ts (partner-note entity branch) on first
  // Hocuspocus connection — no CollabDocument state pre-seeding needed here.
  const docName = `partner-note:${note.id}:body`;
  if (!note.contentDocId) {
    const existing = await prisma.collabDocument.findUnique({
      where: { name: docName },
      select: { name: true },
    });
    if (!existing) {
      await prisma.collabDocument.create({
        data: { name: docName, state: Buffer.alloc(0) },
      });
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (prisma as any).partnerMeetingNote.update({
      where: { id: note.id },
      data: { contentDocId: docName },
    });
    note.contentDocId = docName;
  }

  const collabToken = parseSessionCookie(request);
  const userName =
    [auth.user.firstName, auth.user.lastName].filter(Boolean).join(" ") ||
    auth.user.email;

  return {
    note: {
      id: note.id as string,
      title: note.title as string,
      meetingDate: (note.meetingDate as Date).toISOString(),
      category: note.category as Category,
      attendees: note.attendees as string,
      contentDocId: note.contentDocId as string,
      partnerOrgId: note.partnerOrgId as string | null,
      partnerOrgName: (note.partnerOrg?.name ?? null) as string | null,
    },
    partnerOrgs,
    collabToken,
    userName,
  };
}

export async function action({ request, params }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");
  if (auth.user.type === "applicant") return redirect("/portal");
  if (!(await canViewStaffing(auth.user.sub))) {
    return { error: "You don't have permission to edit this note." };
  }

  const form = await request.formData();
  const intent = (form.get("intent") as string | null) ?? "metadata";

  if (intent === "delete") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const note = await (prisma as any).partnerMeetingNote.findUnique({
      where: { id: params.id },
      select: { contentDocId: true },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (prisma as any).partnerMeetingNote.delete({ where: { id: params.id } });
    if (note?.contentDocId) {
      await prisma.collabDocument.deleteMany({
        where: { name: note.contentDocId },
      });
    }
    return redirect("/partners/meeting-notes");
  }

  // intent === "metadata"
  const title = (form.get("title") as string | null)?.trim() ?? "";
  const meetingDateRaw = (form.get("meetingDate") as string | null) ?? "";
  const category = (form.get("category") as string | null) ?? "";
  const attendees = (form.get("attendees") as string | null) ?? "";
  const partnerOrgId =
    (form.get("partnerOrgId") as string | null)?.trim() || null;

  if (!title) return { error: "Title is required." };
  if (!meetingDateRaw) return { error: "Meeting date is required." };
  if (!CATEGORIES.includes(category as Category))
    return { error: "Invalid category." };

  const meetingDate = new Date(meetingDateRaw);
  if (isNaN(meetingDate.getTime())) return { error: "Invalid date." };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (prisma as any).partnerMeetingNote.update({
    where: { id: params.id },
    data: { title, meetingDate, category, attendees, partnerOrgId },
  });

  return { ok: true };
}

function formatDateInput(iso: string) {
  return iso.slice(0, 10);
}

export default function MeetingNoteDetail() {
  const { note, partnerOrgs, collabToken, userName } =
    useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const { revalidate } = useRevalidator();

  const documentName = note.contentDocId;
  const fieldClass =
    "px-2 py-1.5 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-accent-coral/30 w-full";

  return (
    <div className="flex flex-col gap-3 max-w-6xl">
      <Link
        to="/partners/meeting-notes"
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors w-fit"
      >
        <ChevronLeft className="w-3.5 h-3.5" />
        Meeting Notes
      </Link>

      {actionData && "error" in actionData && (
        <div className="bg-destructive/10 border border-destructive/30 text-destructive text-sm rounded-md px-3 py-2">
          {actionData.error}
        </div>
      )}

      <div className="flex gap-4 items-start">
        {/* Metadata sidebar — always visible, always editable */}
        <Form
          method="post"
          onSubmit={() => revalidate()}
          className="bg-card border border-border rounded-lg p-4 flex flex-col gap-3 w-64 shrink-0"
        >
          <input type="hidden" name="intent" value="metadata" />

          <label className="flex flex-col gap-1 text-xs">
            <span className="text-muted-foreground font-medium">Title</span>
            <input
              name="title"
              required
              defaultValue={note.title}
              className={fieldClass}
            />
          </label>

          <label className="flex flex-col gap-1 text-xs">
            <span className="text-muted-foreground font-medium">Date</span>
            <input
              name="meetingDate"
              type="date"
              required
              defaultValue={formatDateInput(note.meetingDate)}
              className={fieldClass}
            />
          </label>

          <label className="flex flex-col gap-1 text-xs">
            <span className="text-muted-foreground font-medium">Category</span>
            <select name="category" defaultValue={note.category} className={fieldClass}>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-xs">
            <span className="text-muted-foreground font-medium">Partner org</span>
            <select
              name="partnerOrgId"
              defaultValue={note.partnerOrgId ?? ""}
              className={fieldClass}
            >
              <option value="">None</option>
              {partnerOrgs.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-xs">
            <span className="text-muted-foreground font-medium">Attendees</span>
            <textarea
              name="attendees"
              rows={4}
              defaultValue={note.attendees}
              placeholder={"Alejandro\nPartner name\n..."}
              className={`${fieldClass} resize-y`}
            />
          </label>

          <div className="flex items-center justify-between gap-2 pt-1">
            <Form
              method="post"
              onSubmit={(e) => {
                if (!window.confirm("Permanently delete this note? This cannot be undone.")) {
                  e.preventDefault();
                }
              }}
            >
              <input type="hidden" name="intent" value="delete" />
              <button
                type="submit"
                className="text-xs text-destructive hover:underline"
              >
                Delete
              </button>
            </Form>
            <button
              type="submit"
              className="px-3 py-1.5 text-xs font-medium rounded-md bg-accent-coral text-white hover:bg-accent-coral/90 transition-colors"
            >
              Save
            </button>
          </div>
        </Form>

        {/* Note body */}
        <div className="flex-1 min-w-0 bg-card border border-border rounded-lg p-4 flex flex-col gap-2">
          <h1 className="font-heading text-xl font-bold text-foreground leading-snug">
            {note.title}
          </h1>
          <div className="flex items-center gap-2 mb-2">
            <span
              className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded ${CATEGORY_PILL[note.category]}`}
            >
              {note.category}
            </span>
            <span className="text-xs text-muted-foreground">
              {new Date(note.meetingDate).toLocaleDateString("en-US", {
                month: "long",
                day: "numeric",
                year: "numeric",
              })}
            </span>
            {note.partnerOrgName && (
              <span className="text-xs text-muted-foreground">· {note.partnerOrgName}</span>
            )}
          </div>
          {collabToken ? (
            <PresenceProvider
              pageId={`partner-note:${note.id}`}
              token={collabToken}
              userName={userName}
            >
              <CollaborativeEditor
                editorId={documentName}
                documentName={documentName}
                token={collabToken}
                userName={userName}
                disabled={false}
                placeholder="Start writing your meeting notes…"
                className="border border-border rounded-md"
              />
            </PresenceProvider>
          ) : (
            <p className="text-xs text-muted-foreground italic">
              Sign in again to edit the note.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
