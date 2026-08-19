import { redirect } from "react-router";
import type { Route } from "./+types/core.milestones.$id";
import { requireCore } from "~/lib/auth";
import { getUserRoles } from "~/lib/roles";
import { isFeatureEnabled } from "~/lib/feature-flags.server";
import { parseSessionCookie } from "~/lib/cookies";
import { coreHandle } from "~/core/coreNav";
import { coerceEntries } from "~/lib/milestones";
import {
  getMilestoneSet,
  lockedMilestoneVersionIds,
  saveMilestoneDraft,
  saveMilestoneVersion,
} from "~/lib/milestones.server";
import { MilestoneSetEditor } from "~/core/components/MilestoneSetEditor";

export const meta: Route.MetaFunction = ({ data }) => [
  { title: `${(data as { set?: { name?: string } })?.set?.name ?? "Milestones"} · DALI OS` },
];

export const handle = coreHandle("milestones");

export async function loader({ request, params }: Route.LoaderArgs) {
  const gate = await requireCore(request);
  if (!gate.ok) return gate.response;
  const roles = await getUserRoles(gate.auth.user.sub, request);
  if (!(await isFeatureEnabled("milestones-v2", gate.auth.user.sub, roles, request))) {
    return redirect("/core");
  }

  const set = await getMilestoneSet(params.id);
  if (!set) throw new Response("Not found", { status: 404 });
  const lockedIds = await lockedMilestoneVersionIds(set.id);

  return {
    set: {
      id: set.id,
      name: set.name,
      description: set.description,
      isLabWide: set.isLabWide,
      draftEntries: coerceEntries(set.draftEntries),
      versions: set.versions.map((v) => ({
        id: v.id,
        versionNumber: v.versionNumber,
        createdAt: v.createdAt.toISOString(),
        createdBy: [v.createdBy?.firstName, v.createdBy?.lastName].filter(Boolean).join(" "),
        entries: coerceEntries(v.entries),
        locked: lockedIds.has(v.id),
      })),
    },
    // Session token for the milestone:{id}:draft collab room.
    collabToken: parseSessionCookie(request),
  };
}

export async function action({ request, params }: Route.ActionArgs) {
  const gate = await requireCore(request);
  if (!gate.ok) return gate.response;
  const roles = await getUserRoles(gate.auth.user.sub, request);
  if (!(await isFeatureEnabled("milestones-v2", gate.auth.user.sub, roles, request))) {
    return redirect("/core");
  }

  const formData = await request.formData();
  const intent = formData.get("intent");

  let parsed: unknown = [];
  try {
    parsed = JSON.parse((formData.get("entries") as string) || "[]");
  } catch {
    parsed = [];
  }
  const entries = coerceEntries(parsed);

  if (intent === "save-draft") {
    await saveMilestoneDraft(params.id, entries);
    return { ok: true };
  }
  if (intent === "create-version") {
    await saveMilestoneVersion(params.id, entries, gate.auth.user.sub);
    return redirect(`/core/milestones/${params.id}`);
  }
  return null;
}

export default MilestoneSetEditor;
