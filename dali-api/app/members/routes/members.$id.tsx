import { useActionData, useLoaderData } from "react-router";
import type { Route } from "./+types/members.$id";
import { MemberProfileView } from "~/members/components/MemberProfileView";
import {
  loadProfilePage,
  runProfileAction,
} from "~/members/lib/profile-page.server";
import { requireAuth } from "~/lib/auth";
import { recordRouteVisit } from "~/lib/user-pages.server";

export const meta: Route.MetaFunction = ({ data }) => {
  const m = (data as { member?: { firstName: string; lastName: string } } | undefined)?.member;
  return [
    {
      title: m
        ? `${m.firstName} ${m.lastName} · Members · DALI OS`
        : "Member · DALI OS",
    },
  ];
};

export const handle = {
  breadcrumb: (data: unknown) => {
    const m = (data as { member?: { firstName: string; lastName: string } } | undefined)
      ?.member;
    return m ? `${m.firstName} ${m.lastName}`.trim() : undefined;
  },
  favoriteRoute: true,
};

export async function loader({ request, params }: Route.LoaderArgs) {
  const data = await loadProfilePage({ request, targetId: params.id });
  // After loadProfilePage's gate (it throws on redirect/not-found), so only a
  // viewable profile lands in the viewer's recents. Scoped to this route, not
  // the shared loader — Settings reuses loadProfilePage for the self profile.
  const auth = await requireAuth(request);
  if (auth.ok) {
    recordRouteVisit(
      auth.user.sub,
      `/members/${params.id}`,
      `${data.member.firstName} ${data.member.lastName}`.trim(),
    );
  }
  return data;
}

export async function action({ request, params }: Route.ActionArgs) {
  return runProfileAction({ request, targetId: params.id });
}

export default function MemberDetail() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  return (
    <MemberProfileView
      data={data}
      actionError={
        actionData && "error" in actionData ? actionData.error : null
      }
    />
  );
}
