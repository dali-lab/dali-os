import { useActionData, useLoaderData } from "react-router";
import type { Route } from "./+types/partner.projects.$id";
import { requirePartner } from "~/partners/lib/partner-auth.server";
import { partnerHasProjectAccess } from "~/partners/lib/partner-access";
import { loadPartnerProjectView } from "~/partners/lib/partner-project-view.server";
import { ensureCalendarFeedToken } from "~/partners/lib/partner-calendar.server";
import { requestPartnerMeeting } from "~/partners/lib/partner-meeting.server";
import { getFrontendUrl } from "~/lib/app-env";
import { PartnerProjectHubView } from "~/partners/components/PartnerProjectHubView";

export const meta: Route.MetaFunction = ({ data }) => {
  const n = (data as { project?: { name: string } } | undefined)?.project?.name;
  return [{ title: n ? `${n} · DALI OS` : "Project · DALI OS" }];
};

export async function loader({ request, params }: Route.LoaderArgs) {
  const { auth, partnerUser } = await requirePartner(request);
  // 404 (not 403) so inaccessible project ids don't leak existence.
  if (!(await partnerHasProjectAccess(auth.user.sub, params.id!))) {
    throw new Response("Not found", { status: 404 });
  }

  const data = await loadPartnerProjectView(
    params.id!,
    partnerUser.partnerOrgId,
    auth.user.sub,
  );
  if (!data) throw new Response("Not found", { status: 404 });
  const feedToken = await ensureCalendarFeedToken(auth.user.sub);
  const calendarFeedUrl = feedToken
    ? `${getFrontendUrl()}/partner/calendar/${feedToken}`
    : null;
  return { ...data, currentUserId: auth.user.sub, calendarFeedUrl };
}

export async function action({ request, params }: Route.ActionArgs) {
  const { auth, partnerUser } = await requirePartner(request);
  if (!(await partnerHasProjectAccess(auth.user.sub, params.id!))) {
    throw new Response("Not found", { status: 404 });
  }
  const form = await request.formData();
  const topic = ((form.get("topic") as string | null) ?? "").trim();
  if (!topic) return { error: "A topic is required." };
  await requestPartnerMeeting({
    projectId: params.id!,
    partnerOrgId: partnerUser.partnerOrgId,
    requestedByUserId: auth.user.sub,
    topic,
    details: ((form.get("details") as string | null) ?? "").trim() || null,
    preferredWindows:
      ((form.get("preferredWindows") as string | null) ?? "").trim() || null,
  });
  return { ok: true, requested: true };
}

export default function PartnerProjectView() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  return (
    <PartnerProjectHubView
      data={data}
      currentUserId={data.currentUserId}
      canRsvp
      calendarFeedUrl={data.calendarFeedUrl}
      meetingRequested={Boolean(
        actionData && "requested" in actionData && actionData.requested,
      )}
      requestError={
        actionData && "error" in actionData ? actionData.error : null
      }
      backLink={{ to: "/partner", label: "Back to portal" }}
      pageHref={(pageId) => `/partner/projects/${data.project.id}/pages/${pageId}`}
    />
  );
}
