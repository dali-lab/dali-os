import { redirect, useLoaderData, Link } from "react-router";
import type { Route } from "./+types/hiring";
import { requireAuth } from "~/lib/auth";
import { getHiringHubData } from "~/hiring/lib/hub.server";
import { getPipelineData } from "~/hiring/lib/pipeline.server";
import { hiringPills } from "~/hiring/components/hiringPills";
import { AreaPillNav } from "~/components/AreaPillNav";
import { PipelinePanel } from "~/hiring/components/analytics/PipelinePanel";
import { PageHeader } from "~/hiring/components/PageHeader";
import { EmptyState } from "~/hiring/components/EmptyState";
import { CycleStatusPill } from "~/hiring/components/Pill";
import { buttonClasses } from "~/components/ui/Button";
import { formatInterviewDate, formatInterviewTimeRange } from "~/hiring/lib/interview-time";
import {
  CheckCircle2,
  ClipboardList,
  Mic,
  Users,
  Send,
  Activity,
  ShieldCheck,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

export const handle = { areaPills: true };

export const meta: Route.MetaFunction = () => [{ title: "Hiring · DALI OS" }];

// The hiring hub. Personal cards carry the viewer's actual work items —
// specific reviews, interviews, delibs boards — and the pipeline section
// (formerly the standalone /hiring/analytics page) gives Core/DomainLead the
// cycle overview. Cards never just relink a page the pill row already
// reaches; they deep-link to items or hold info that lives nowhere else.

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");
  if (auth.user.type === "dartmouth") return redirect("/portal");

  const hub = await getHiringHubData(auth.user.sub);
  if (!hub) return redirect("/");
  const pipeline =
    hub.roles.isCore || hub.roles.isDomainLead
      ? await getPipelineData(auth.user.sub, request)
      : null;
  return { ...hub, pipeline };
}

function Card({
  title,
  icon: Icon,
  count,
  children,
  cta,
}: {
  title: string;
  icon?: LucideIcon;
  count?: number;
  children: React.ReactNode;
  cta?: { label: string; to: string };
}) {
  return (
    <section className="bg-card border border-border rounded-lg p-5 flex flex-col gap-3 transition-colors hover:border-accent-coral/40">
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-heading font-semibold text-foreground">
          {Icon && (
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-brand-tint text-navy">
              <Icon className="h-4 w-4" aria-hidden />
            </span>
          )}
          {title}
        </h2>
        {count != null && count > 0 && (
          <span className="inline-flex min-w-6 items-center justify-center rounded-full bg-accent-coral/12 px-2 py-0.5 text-xs font-bold text-accent-coral">
            {count}
          </span>
        )}
      </div>
      <div className="flex-1 text-sm text-foreground">{children}</div>
      {cta && (
        <Link to={cta.to} className={buttonClasses("secondary", "sm") + " self-start"}>
          {cta.label}
        </Link>
      )}
    </section>
  );
}

// A "work remaining" line in the cycle-health card: bold count + what it is.
function HealthRow({ count, label, detail }: { count: number; label: string; detail?: string }) {
  return (
    <li className="flex items-baseline gap-2">
      <span className="font-heading text-lg font-bold text-foreground">{count}</span>
      <span>
        {label}
        {detail && <span className="text-muted-foreground"> — {detail}</span>}
      </span>
    </li>
  );
}

export default function HiringHub() {
  const hub = useLoaderData<typeof loader>();
  // The confidentiality card serves reviewers/interviewers; Core/DomainLead
  // get the same prompt in-place from the pipeline section's gate.
  const showConfidentialityCard =
    hub.needsConfidentialitySignature !== null && hub.pipeline === null;
  const hasCards =
    showConfidentialityCard ||
    hub.pendingReviews.count > 0 ||
    hub.upcomingInterviews.length > 0 ||
    hub.delibs.length > 0 ||
    hub.core !== null;

  return (
    <div>
      <AreaPillNav items={hiringPills({ ...hub.roles, active: "hub" })} />

      <div className="flex flex-col gap-5">
      <PageHeader
        title="Hiring"
        chip={hub.cycle ? <CycleStatusPill status={hub.cycle.status} /> : undefined}
        subtitle={
          hub.cycle ? (
            <>
              {hub.cycle.name}
              {hub.cycle.closeDate && hub.cycle.status === "Open" && (
                <>
                  {" · closes "}
                  {new Date(hub.cycle.closeDate).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                  })}
                </>
              )}
            </>
          ) : (
            "No cycle is open right now."
          )
        }
      />

      {hasCards && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {showConfidentialityCard && hub.cycle && (
            <Card
              title="Confidentiality agreement"
              icon={ShieldCheck}
              cta={{
                label: "Read & sign",
                to: `/hiring/cycles/${hub.needsConfidentialitySignature}/confidentiality`,
              }}
            >
              <p>
                Sign the {hub.cycle.name} agreement before working with
                applications.
              </p>
            </Card>
          )}

          {hub.pendingReviews.count > 0 && (
            <Card title="My reviews" icon={ClipboardList} count={hub.pendingReviews.count}>
              <ul className="flex flex-col gap-2">
                {hub.pendingReviews.items.map((item) => (
                  <li key={item.reviewId}>
                    <Link
                      to={`/hiring/reviewer/application/${item.applicationId}`}
                      className="text-sm text-foreground hover:text-accent-coral"
                    >
                      {item.applicantName}
                      <span className="text-muted-foreground"> · {item.domainName}</span>
                    </Link>
                  </li>
                ))}
                {hub.pendingReviews.count > hub.pendingReviews.items.length && (
                  <li>
                    <Link
                      to="/hiring/reviewer"
                      className="text-sm text-muted-foreground hover:text-foreground"
                    >
                      +{hub.pendingReviews.count - hub.pendingReviews.items.length} more →
                    </Link>
                  </li>
                )}
              </ul>
            </Card>
          )}

          {hub.upcomingInterviews.length > 0 && (
            <Card title="My interviews" icon={Mic} count={hub.upcomingInterviews.length}>
              <ul className="flex flex-col gap-2">
                {hub.upcomingInterviews.map((iv) => (
                  <li key={iv.id}>
                    <Link
                      to={`/hiring/interviews/${iv.id}`}
                      className="text-sm text-foreground hover:text-accent-coral"
                    >
                      {iv.applicantName}
                      <span className="text-muted-foreground">
                        {" "}
                        · {formatInterviewDate(new Date(iv.startTime))} ·{" "}
                        {formatInterviewTimeRange(
                          new Date(iv.startTime),
                          new Date(iv.endTime),
                        )}
                        {iv.location ? ` · ${iv.location}` : ""}
                      </span>
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
              icon={Users}
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
              icon={Send}
              count={hub.core.releaseQueue}
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

          {hub.core && (
            <Card title="Cycle health" icon={Activity}>
              <ul className="flex flex-col gap-1.5">
                <HealthRow
                  count={hub.core.health.submitted}
                  label={`application${hub.core.health.submitted === 1 ? "" : "s"} submitted`}
                />
                {hub.core.health.unreviewedApps > 0 && (
                  <HealthRow
                    count={hub.core.health.unreviewedApps}
                    label="awaiting a first review"
                  />
                )}
                {hub.core.health.reviewsOutstanding > 0 && (
                  <HealthRow
                    count={hub.core.health.reviewsOutstanding}
                    label="assigned reviews outstanding"
                    detail={hub.core.health.outstandingByDomain
                      .slice(0, 3)
                      .map((d) => `${d.domainName} ${d.count}`)
                      .join(" · ")}
                  />
                )}
                {hub.core.health.activeDelibs > 0 && (
                  <HealthRow
                    count={hub.core.health.activeDelibs}
                    label={`delibs board${hub.core.health.activeDelibs === 1 ? "" : "s"} active`}
                  />
                )}
                {hub.core.waitlisted > 0 && (
                  <HealthRow
                    count={hub.core.waitlisted}
                    label="on active waitlists"
                  />
                )}
              </ul>
            </Card>
          )}
        </div>
      )}

      {hub.pipeline && <PipelinePanel data={hub.pipeline} />}

      {!hasCards && !hub.pipeline && (
        <EmptyState
          icon={CheckCircle2}
          title="You're all caught up"
          description="Reviews and interviews you're assigned to will show up here as cycles get underway."
        />
      )}
      </div>
    </div>
  );
}
