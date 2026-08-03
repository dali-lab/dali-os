import { redirect, useLoaderData } from "react-router";
import { redirectToLogin } from "~/lib/login-next";
import type { Route } from "./+types/forms.$folderId";
import { requireAuth, forbidden, redirectApplicantToPortal } from "~/lib/auth";
import { isCore } from "~/lib/roles";
import { loadFormsLevel, runFormsAction } from "~/forms/lib/forms-data";
import { FormsBrowser } from "~/forms/components/FormsBrowser";

export const meta: Route.MetaFunction = ({ data }) => [
  { title: `${(data as any)?.current?.name ?? "Folder"} · Forms · DALI OS` },
];

// Folder nesting isn't in the URL (/forms/:folderId is flat), so the route
// expands its segment into the full ancestry sub-trail.
export const handle = {
  breadcrumb: (data: unknown) => {
    const d = data as
      | { current?: { name: string }; crumbs?: { id: string; name: string }[] }
      | undefined;
    if (!d?.current) return null;
    return [
      ...(d.crumbs ?? []).map((c) => ({ label: c.name, to: `/forms/${c.id}` })),
      { label: d.current.name },
    ];
  },
};

export async function loader({ request, params }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  const portalRedirect = redirectApplicantToPortal(auth);
  if (portalRedirect) return portalRedirect;
  if (!(await isCore(auth.user.sub))) return redirect("/");

  const level = await loadFormsLevel(params.folderId);
  if (!level) return redirect("/forms"); // unknown folder → top level
  return level;
}

export async function action({ request }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  if (!(await isCore(auth.user.sub)))
    return forbidden(request);

  const result = await runFormsAction(
    await request.formData(),
    auth.user.sub,
  );
  if ("error" in result)
    return Response.json({ error: result.error }, { status: result.status });
  return result;
}

export default function FormsFolderPage() {
  const { current, folders, forms, allFolders, allForms } =
    useLoaderData<typeof loader>();

  return (
    <div className="flex flex-col gap-4">
      <header>
        <h1 className="font-heading text-2xl font-bold text-foreground">
          {current?.name}
        </h1>
      </header>

      <FormsBrowser
        folderId={current?.id ?? null}
        parentId={current?.parentId ?? null}
        folders={folders}
        forms={forms}
        allFolders={allFolders}
        allForms={allForms}
      />
    </div>
  );
}
