import { redirect, useLoaderData, useSearchParams, type ShouldRevalidateFunctionArgs } from "react-router";
import { ClipboardList, ListOrdered, Mic } from "lucide-react";
import type { Route } from "./+types/hiring";
import { requireAuth } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { getMyWorkData, hasHiringAccess } from "~/hiring/lib/my-work.server";
import { useOsChrome } from "~/components/os-chrome";
import { SegmentedTabButtons } from "~/components/AreaPillNav";
import { ConfidentialityGate } from "~/hiring/components/ConfidentialityGate";
import { ReviewsView } from "~/hiring/components/my-work/ReviewsView";
import { DelibsView } from "~/hiring/components/my-work/DelibsView";
import { InterviewsView } from "~/hiring/components/my-work/InterviewsView";
import { cn } from "~/lib/cn";

export const meta: Route.MetaFunction = () => [{ title: "My work · Hiring · DALI OS" }];

// Hiring's landing page: the viewer's own reviews, interviews, and the live
// delibs mirror on one page, switched by ?view=. Reviews and delibs span every
// cycle the viewer is on; interviews pick a cycle. Replaced the old hub and the
// separate /hiring/reviewer and /hiring/interviews pages (both redirect here).

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  if (auth.user.type === "dartmouth") return redirect("/portal");
  if (!(await hasHiringAccess(auth.user.sub))) return redirect("/");
  return getMyWorkData(auth.user.sub, request);
}

// Switching tabs only changes ?view=, which the loader doesn't read, so skip
// the refetch for that alone. Anything else (the delibs mirror's polling, a
// cycle switch, a form post) revalidates as usual.
export function shouldRevalidate({
  currentUrl,
  nextUrl,
  formMethod,
  defaultShouldRevalidate,
}: ShouldRevalidateFunctionArgs) {
  const view = (u: URL) => u.searchParams.get("view");
  const rest = (u: URL) => {
    const p = new URLSearchParams(u.search);
    p.delete("view");
    return u.pathname + "?" + p.toString();
  };
  const onlyViewChanged =
    !formMethod && view(currentUrl) !== view(nextUrl) && rest(currentUrl) === rest(nextUrl);
  return onlyViewChanged ? false : defaultShouldRevalidate;
}

const VIEWS = {
  reviews: { label: "Reviews", icon: ClipboardList },
  interviews: { label: "Interviews", icon: Mic },
  delibs: { label: "Delibs", icon: ListOrdered },
} as const;
type View = keyof typeof VIEWS;

export default function MyWork() {
  const data = useLoaderData<typeof loader>();
  const { pageTitle, panel, bodyText } = useOsChrome();
  const [searchParams, setSearchParams] = useSearchParams();

  const title = <h1 className={pageTitle}>My work</h1>;

  if (!data.hasWork) {
    return (
      <div className="flex flex-col gap-6">
        {title}
        <div className={cn(panel, "p-10 text-center")}>
          <p className="font-heading font-semibold text-foreground">Nothing assigned to you</p>
          <p className={cn(bodyText, "mt-1")}>
            Reviews and interviews on a live cycle show up here.
          </p>
        </div>
      </div>
    );
  }

  const { reviews, interviews } = data;
  const available: View[] = [
    ...(reviews ? (["reviews"] as const) : []),
    ...(interviews ? (["interviews"] as const) : []),
    ...(reviews && reviews.delibsSessions.length > 0 ? (["delibs"] as const) : []),
  ];
  const requested = searchParams.get("view") as View | null;
  const view = requested && available.includes(requested) ? requested : available[0];
  const setView = (next: View) =>
    setSearchParams(
      (prev) => {
        prev.set("view", next);
        return prev;
      },
      // Same page, different tab: keep the scroll position where it is.
      { replace: true, preventScrollReset: true },
    );

  return (
    <div className="flex flex-col gap-6">
      {title}

      {available.length > 1 && (
        <SegmentedTabButtons
          label="My work"
          items={available.map((v) => ({
            label: VIEWS[v].label,
            icon: VIEWS[v].icon,
            active: v === view,
            onClick: () => setView(v),
          }))}
        />
      )}

      {view === "reviews" && reviews && (
        <>
          {reviews.blocked.map((b) => (
            <ConfidentialityGate
              key={b.cycleId}
              cycleId={b.cycleId}
              cycleName={reviews.multiCycle ? b.cycleName : undefined}
              reason={b.reason}
              next="/hiring?view=reviews"
            />
          ))}
          {(reviews.myReviews.length > 0 || reviews.blocked.length === 0) && (
            <ReviewsView reviews={reviews.myReviews} showCycle={reviews.multiCycle} />
          )}
        </>
      )}
      {view === "delibs" && reviews && (
        <DelibsView
          delibsSessions={reviews.delibsSessions}
          delibsApplications={reviews.delibsApplications}
          showCycle={reviews.multiCycle}
        />
      )}
      {view === "interviews" && interviews && (
        <InterviewsView
          key={interviews.cycle.id}
          cycles={interviews.cycles}
          cycleId={interviews.cycle.id}
          needsCalendar={interviews.needsCalendar}
          // Interviewing isn't gated on the agreement, but it still has to be
          // signed before working with applications.
          unsignedAgreement={interviews.confidentialityRequired === "unsigned"}
        />
      )}
    </div>
  );
}
