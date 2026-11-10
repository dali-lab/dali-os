import { redirect, useLoaderData } from "react-router";
import type { Route } from "./+types/core.hub";
import { requireAuth } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { getUserRoles, isCore } from "~/lib/roles";
import { isFeatureEnabled } from "~/lib/feature-flags.server";
import { OsPageHeader } from "~/components/os-section";
import { getOpenCycles } from "~/hiring/lib/cycles";
import { isCoreCycleEligible } from "~/hiring/lib/core-hiring.server";
import { loadCoreTaskboard } from "~/core/lib/taskboard.server";
import { CoreTaskBoard } from "~/core/components/taskboard/CoreTaskBoard";

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  if (!(await isCore(auth.user.sub, request))) {
    // Non-Core members don't get the Core area. If a Lab members (Core) cycle
    // is open and they're eligible to apply, send them to the application (the
    // invite email links here at /core) instead of bouncing them home. The
    // portal offers a choice when several are open.
    const openCore = await getOpenCycles({ applicants: "LabMembers" });
    if (openCore.length > 0 && (await isCoreCycleEligible(auth.user.sub))) {
      return redirect("/core/apply");
    }
    return redirect("/");
  }

  const roles = await getUserRoles(auth.user.sub, request);
  if (!(await isFeatureEnabled("core-taskboard", auth.user.sub, roles, request))) {
    const embed = new URL(request.url).searchParams.has("embed");
    return redirect(embed ? "/core/staffing?embed=1" : "/core/staffing");
  }

  const board = await loadCoreTaskboard(auth.user.sub, request);
  const currentUserName =
    [auth.user.firstName, auth.user.lastName].filter(Boolean).join(" ") || auth.user.email;
  return { ...board, currentUserId: auth.user.sub, currentUserName };
}

// Filters and the open task live in the query string; none of them need the board refetched.
export function shouldRevalidate({
  currentUrl,
  nextUrl,
  formMethod,
  defaultShouldRevalidate,
}: {
  currentUrl: URL;
  nextUrl: URL;
  formMethod?: string;
  defaultShouldRevalidate: boolean;
}) {
  if (!formMethod && currentUrl.pathname === nextUrl.pathname && currentUrl.search !== nextUrl.search) {
    return false;
  }
  return defaultShouldRevalidate;
}

export default function CoreTaskboardPage() {
  const { projectId, tasks, options, currentUserId, currentUserName } = useLoaderData<typeof loader>();
  return (
    <div className="flex flex-col gap-6">
      <OsPageHeader title="Taskboard" />
      <CoreTaskBoard
        projectId={projectId}
        initialTasks={tasks}
        options={options}
        currentUserId={currentUserId}
        currentUserName={currentUserName}
      />
    </div>
  );
}
