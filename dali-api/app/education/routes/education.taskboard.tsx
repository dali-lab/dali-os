import { redirect, useLoaderData } from "react-router";
import type { Route } from "./+types/education.taskboard";
import { requireAuth } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { getUserRoles } from "~/lib/roles";
import { APPLICATION_TZ } from "~/lib/timezone";
import { isFeatureEnabled } from "~/lib/feature-flags.server";
import { redirectDartmouthToPortal } from "~/education/lib/access.server";
import { loadBoard } from "~/education/lib/taskboard/taskboard.server";
import { handleTaskboardAction, resultId } from "~/education/lib/taskboard/actions.server";
import { resolveViewed } from "~/education/lib/taskboard/view";
import { currentPosition, ymdFromDate } from "~/education/lib/taskboard/weeks";
import { TaskboardPage } from "~/education/components/taskboard/TaskboardPage";

export const meta: Route.MetaFunction = () => [{ title: "Taskboard · DALI OS" }];

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  const portalRedirect = redirectDartmouthToPortal(auth);
  if (portalRedirect) return portalRedirect;
  const roles = await getUserRoles(auth.user.sub, request);
  if (!roles.isCore) return redirect("/education");
  if (!(await isFeatureEnabled("education-taskboard", auth.user.sub, roles, request))) {
    return redirect("/education");
  }

  const now = new Date();
  const board = await loadBoard(now);
  const today = ymdFromDate(now, APPLICATION_TZ);
  const current = currentPosition(board.periods, today);
  const params = new URL(request.url).searchParams;
  const viewed = resolveViewed(board.periods, current, params.get("period"), params.get("week"));
  return { ...board, today, current, viewed, userId: auth.user.sub };
}

export async function action({ request }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  const roles = await getUserRoles(auth.user.sub, request);
  if (!roles.isCore || !(await isFeatureEnabled("education-taskboard", auth.user.sub, roles, request))) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  const result = await handleTaskboardAction(await request.formData(), auth.user.sub, new Date());
  if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
  return { ok: true, id: resultId(result) };
}

export default function EducationTaskboard() {
  const data = useLoaderData<typeof loader>();
  return <TaskboardPage {...data} />;
}
