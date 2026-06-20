import { useState } from "react";
import { Link, redirect, useLoaderData, useRevalidator } from "react-router";
import type { Route } from "./+types/education.manage.$id.applications";
import { requireAuth } from "~/lib/auth";
import { canManageOffering } from "~/education/lib/auth";
import { listApplicationsForOffering } from "~/education/lib/applications-data";
import { prisma } from "~/lib/db";
import { ApplicationsTable } from "~/education/components/ApplicationsTable";
import { WaitlistReorder } from "~/education/components/WaitlistReorder";
import { Button } from "~/components/ui/Button";

export const meta: Route.MetaFunction = () => [{ title: "Applications · Education" }];

export async function loader({ request, params }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");
  if (!(await canManageOffering(auth.user.sub, params.id))) {
    throw new Response("Forbidden", { status: 403 });
  }

  const offering = await prisma.educationOffering.findUnique({
    where: { id: params.id },
    select: { id: true, title: true, capacity: true },
  });
  if (!offering) throw new Response("Not found", { status: 404 });

  const apps = await listApplicationsForOffering(params.id);
  const counts = apps.reduce(
    (acc, a) => {
      acc[a.status] = (acc[a.status] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );

  return {
    offering,
    counts,
    applications: apps.map((a) => ({
      id: a.id,
      status: a.status,
      submittedAt: a.submittedAt.toISOString(),
      applicant: a.applicant,
      answers: a.answers.map((ans) => ({
        question: { prompt: ans.question.prompt, position: ans.question.position },
        content: ans.content,
      })),
    })),
  };
}

export default function ReviewApplications() {
  const data = useLoaderData<typeof loader>();
  const [tab, setTab] = useState<"submitted" | "approved" | "waitlisted" | "rejected">("submitted");
  const { revalidate } = useRevalidator();
  const [announcement, setAnnouncement] = useState("");
  const [posting, setPosting] = useState(false);
  const [posted, setPosted] = useState<string | null>(null);

  async function postAnnouncement() {
    setPosting(true);
    setPosted(null);
    const res = await fetch(`/api/education/offerings/${data.offering.id}/announcements`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: announcement }),
    });
    setPosting(false);
    if (res.ok) {
      const body = await res.json();
      setPosted(`Sent to ${body.fanout.recipients} enrolled student${body.fanout.recipients === 1 ? "" : "s"}.`);
      setAnnouncement("");
      revalidate();
    } else {
      const body = await res.json().catch(() => ({}));
      setPosted(body.error ?? "Failed to post");
    }
  }

  const filtered = data.applications.filter((a) => statusKey(a.status) === tab);
  const waitlistRows = data.applications.filter((a) => a.status === "Waitlisted");

  return (
    <div className="p-6 md:p-10 max-w-4xl mx-auto">
      <div className="mb-4 flex items-center gap-3">
        <Link to={`/education/manage/${data.offering.id}`} className="text-xs text-muted-foreground hover:underline">
          ← Back to offering
        </Link>
      </div>
      <h1 className="font-heading text-2xl font-bold text-dark-blue mb-1">{data.offering.title}</h1>
      <p className="text-sm text-muted-foreground mb-6">
        Capacity {data.offering.capacity} · {data.counts.Approved ?? 0} approved · {data.counts.Waitlisted ?? 0} waitlisted · {data.counts.Submitted ?? 0} pending review
      </p>

      <nav className="border-b border-border mb-5 flex gap-4">
        {(["submitted", "approved", "waitlisted", "rejected"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`pb-2 text-sm capitalize ${
              tab === t ? "text-dark-blue font-semibold border-b-2 border-accent-coral" : "text-muted-foreground hover:text-dark-blue"
            }`}
          >
            {t} ({data.counts[capitalize(t)] ?? 0})
          </button>
        ))}
      </nav>

      {tab === "waitlisted" ? (
        <WaitlistReorder
          offeringId={data.offering.id}
          rows={waitlistRows.map((r) => ({
            id: r.id,
            applicant: r.applicant,
            submittedAt: r.submittedAt,
          }))}
        />
      ) : (
        <ApplicationsTable rows={filtered as any} />
      )}

      <section className="mt-12 rounded-2xl border border-border bg-card p-5">
        <h2 className="font-heading text-sm font-bold uppercase tracking-wider text-dark-blue mb-3">
          Post announcement
        </h2>
        <textarea
          value={announcement}
          onChange={(e) => setAnnouncement(e.target.value)}
          rows={4}
          placeholder="Sent to all Approved enrollees via in-app notification + email."
          className="w-full rounded-lg border border-border bg-card p-3 text-sm focus:outline-none focus:ring-2 focus:ring-accent-teal"
        />
        <div className="mt-3 flex items-center gap-3">
          <Button variant="primary" disabled={posting || !announcement.trim()} onClick={postAnnouncement}>
            {posting ? "Posting..." : "Post"}
          </Button>
          {posted && <span className="text-xs text-muted-foreground">{posted}</span>}
        </div>
      </section>
    </div>
  );
}

function statusKey(s: string): "submitted" | "approved" | "waitlisted" | "rejected" {
  if (s === "Approved") return "approved";
  if (s === "Waitlisted") return "waitlisted";
  if (s === "Rejected" || s === "Withdrawn") return "rejected";
  return "submitted";
}
function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
