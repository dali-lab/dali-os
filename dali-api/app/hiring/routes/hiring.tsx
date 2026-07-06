import { redirect, useLoaderData, Link } from "react-router";
import type { Route } from "./+types/hiring";
import { requireAuth } from "~/lib/auth";
import { getHiringHubData } from "~/hiring/lib/hub.server";
import { hiringPills } from "~/hiring/components/hiringPills";
import { AreaPillNav } from "~/components/AreaPillNav";
import { buttonClasses } from "~/components/ui/Button";
import { formatInterviewDate, formatInterviewTimeRange } from "~/hiring/lib/interview-time";
import { cn } from "~/lib/cn";

export const meta: Route.MetaFunction = () => [{ title: "Hiring · DALI OS" }];

// The hiring hub: role-aware "what needs me right now" cards. Lateral
// navigation to the tools lives in the pill row (the sidebar carries a
// single Hiring entry that lands here).

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");
  if (auth.user.type === "dartmouth") return redirect("/portal");

  const hub = await getHiringHubData(auth.user.sub);
  if (!hub) return redirect("/");
  return hub;
}

const STAGE_STYLES: Record<string, string> = {
  Open: "bg-green-100 text-green-800",
  UnderReview: "bg-amber-100 text-amber-800",
  Draft: "bg-muted text-muted-foreground",
};

function Card({
  title,
  children,
  cta,
}: {
  title: string;
  children: React.ReactNode;
  cta?: { label: string; to: string };
}) {
  return (
    <section className="bg-card border border-border rounded-lg p-5 flex flex-col gap-3">
      <h2 className="font-heading font-semibold text-foreground">{title}</h2>
      <div className="flex-1 text-sm text-foreground">{children}</div>
      {cta && (
        <Link to={cta.to} className={buttonClasses("secondary", "sm") + " self-start"}>
          {cta.label}
        </Link>
      )}
    </section>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div>
      <p className="font-heading text-2xl font-bold text-foreground">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

export default function HiringHub() {
  const hub = useLoaderData<typeof loader>();

  return (
    <div className="flex flex-col gap-5">
      <AreaPillNav items={hiringPills({ ...hub.roles, active: "hub" })} />

      <header>
        <h1 className="font-heading text-2xl font-bold text-foreground">Hiring</h1>
        {hub.cycle ? (
          <p className="text-sm text-muted-foreground mt-1 flex items-center gap-2">
            {hub.cycle.name}
            <span
              className={cn(
                "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold",
                STAGE_STYLES[hub.cycle.status] ?? "bg-muted text-muted-foreground",
              )}
            >
              {hub.cycle.status === "UnderReview" ? "Under review" : hub.cycle.status}
            </span>
            {hub.cycle.closeDate && hub.cycle.status === "Open" && (
              <span>
                closes{" "}
                {new Date(hub.cycle.closeDate).toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                })}
              </span>
            )}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground mt-1">
            No active application cycle.
          </p>
        )}
      </header>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {hub.pendingReviews > 0 && (
          <Card
            title="My reviews"
            cta={{ label: "Go to reviews", to: "/hiring/reviewer" }}
          >
            <p>
              <span className="font-heading text-2xl font-bold">
                {hub.pendingReviews}
              </span>{" "}
              review{hub.pendingReviews === 1 ? "" : "s"} waiting on you.
            </p>
          </Card>
        )}

        {hub.upcomingInterviews.length > 0 && (
          <Card title="My interviews">
            <ul className="flex flex-col gap-2">
              {hub.upcomingInterviews.map((iv) => (
                <li key={iv.id}>
                  <Link
                    to={`/hiring/interviewer/interview/${iv.id}`}
                    className="text-sm text-foreground hover:text-accent-coral"
                  >
                    {formatInterviewDate(new Date(iv.startTime))} ·{" "}
                    {formatInterviewTimeRange(
                      new Date(iv.startTime),
                      new Date(iv.endTime),
                    )}
                    {iv.location ? ` · ${iv.location}` : ""}
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        )}

        {hub.delibs.map((session) => (
          <Card
            key={session.id}
            title={`${session.domainName} delibs`}
            cta={{
              label: "Open board",
              to: `/hiring/domain-lead/delibs/${session.id}`,
            }}
          >
            <p>{session.type} delibs are active for your domain.</p>
          </Card>
        ))}

        {hub.core && hub.core.releaseQueue > 0 && (
          <Card
            title="Release queue"
            cta={{
              label: "Manage cycle",
              to: hub.cycle ? `/hiring/lead/cycle/${hub.cycle.id}` : "/hiring/lead",
            }}
          >
            <p>
              <span className="font-heading text-2xl font-bold">
                {hub.core.releaseQueue}
              </span>{" "}
              finalized decision{hub.core.releaseQueue === 1 ? "" : "s"} waiting to
              be released.
            </p>
          </Card>
        )}

        {hub.core && hub.core.waitlisted > 0 && (
          <Card
            title="Waitlists"
            cta={{ label: "View waitlists", to: "/hiring/lead/waitlists" }}
          >
            <p>
              <span className="font-heading text-2xl font-bold">
                {hub.core.waitlisted}
              </span>{" "}
              candidate{hub.core.waitlisted === 1 ? "" : "s"} on active waitlists.
            </p>
          </Card>
        )}

        {hub.core && hub.cycle && (
          <Card
            title="Cycle funnel"
            cta={{ label: "All applications", to: "/hiring/applications" }}
          >
            <div className="flex gap-6">
              <Stat value={hub.core.funnel.submitted} label="submitted" />
              <Stat value={hub.core.funnel.reviewsSubmitted} label="reviews in" />
              <Stat value={hub.core.funnel.interviews} label="interviews" />
            </div>
          </Card>
        )}
      </div>

      {hub.pendingReviews === 0 &&
        hub.upcomingInterviews.length === 0 &&
        hub.delibs.length === 0 &&
        !hub.core && (
          <div className="bg-card border border-border rounded-lg p-8 text-center">
            <p className="font-heading font-semibold text-foreground">
              Nothing needs you right now
            </p>
            <p className="text-sm text-muted-foreground mt-1">
              Reviews and interviews you're assigned to will show up here.
            </p>
          </div>
        )}
    </div>
  );
}
