import { data, redirect, useLoaderData } from "react-router";
import type { Route } from "./+types/core.milestones";
import { requireAuth } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { getUserRoles, isCore } from "~/lib/roles";
import { isFeatureEnabled } from "~/lib/feature-flags.server";
import { coreHandle } from "~/core/coreNav";
import { localTodayUtcDay } from "~/projects/lib/timeline-days";
import { loadMilestonesPage } from "~/core/lib/milestones-page.server";
import {
  MilestoneError,
  createMilestone,
  deleteMilestone,
  fillTermFromLastYear,
  moveMilestone,
  updateMilestone,
} from "~/core/lib/milestones.server";
import { milestoneIntent, parseMilestoneForm } from "~/core/lib/milestones-input";
import { MilestonesPage } from "~/core/components/milestones/MilestonesPage";

export const handle = coreHandle("milestones");

async function gate(request: Request) {
  const auth = await requireAuth(request);
  if (!auth.ok) return { response: redirectToLogin(request) } as const;
  if (!(await isCore(auth.user.sub, request))) return { response: redirect("/") } as const;
  const roles = await getUserRoles(auth.user.sub, request);
  if (!(await isFeatureEnabled("core-taskboard", auth.user.sub, roles, request))) {
    const embed = new URL(request.url).searchParams.has("embed");
    return { response: redirect(embed ? "/core/staffing?embed=1" : "/core/staffing") } as const;
  }
  return { userId: auth.user.sub, isAdmin: roles.isAdmin } as const;
}

export async function loader({ request }: Route.LoaderArgs) {
  const g = await gate(request);
  if ("response" in g) return g.response;
  const page = await loadMilestonesPage(request, localTodayUtcDay());
  return { ...page, isAdmin: g.isAdmin };
}

export async function action({ request }: Route.ActionArgs) {
  const g = await gate(request);
  if ("response" in g) return g.response;
  const parsed = milestoneIntent.safeParse(parseMilestoneForm(await request.formData()));
  if (!parsed.success) return data({ error: "Check the fields and try again" }, { status: 400 });
  const input = parsed.data;
  const actor = { userId: g.userId, request };
  try {
    switch (input.intent) {
      case "create":
        await createMilestone(input, actor);
        break;
      case "update":
        await updateMilestone(input, actor);
        break;
      case "move":
        await moveMilestone(input, actor);
        break;
      case "delete":
        await deleteMilestone(input.id, actor);
        break;
      case "fill":
        await fillTermFromLastYear(input.termId, actor);
        break;
    }
  } catch (err) {
    if (err instanceof MilestoneError) return data({ error: err.message }, { status: err.status });
    throw err;
  }
  return { ok: true };
}

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
  if (
    !formMethod &&
    currentUrl.pathname === nextUrl.pathname &&
    currentUrl.searchParams.get("term") === nextUrl.searchParams.get("term")
  ) {
    return false;
  }
  return defaultShouldRevalidate;
}

export default function CoreMilestonesRoute() {
  const page = useLoaderData<typeof loader>();
  return <MilestonesPage page={page as never} />;
}
