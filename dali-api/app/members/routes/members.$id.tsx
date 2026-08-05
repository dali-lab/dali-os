import { useActionData, useLoaderData } from "react-router";
import type { Route } from "./+types/members.$id";
import { MemberProfileView } from "~/members/components/MemberProfileView";
import {
  loadProfilePage,
  runProfileAction,
} from "~/members/lib/profile-page.server";

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
  return loadProfilePage({ request, targetId: params.id });
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
