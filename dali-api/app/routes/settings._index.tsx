import { redirect, useActionData, useLoaderData } from "react-router";
import { requireAuth } from "~/lib/auth";
import { loadSettingsPageData } from "~/lib/settings-page.server";
import { runProfileAction } from "~/members/lib/profile-page.server";
import { SettingsPage } from "~/components/settings/SettingsPage";
import type { Route } from "./+types/settings._index";

export const meta: Route.MetaFunction = () => [{ title: "Settings · DALI OS" }];

export async function loader({ request }: Route.LoaderArgs) {
  return loadSettingsPageData(request);
}

export async function action({ request }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");
  return runProfileAction({ request, targetId: auth.user.sub });
}

export default function SettingsIndex() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  if (data instanceof Response) return null;
  return (
    <SettingsPage
      data={data}
      actionError={
        actionData && typeof actionData === "object" && "error" in actionData
          ? String(actionData.error)
          : null
      }
    />
  );
}
