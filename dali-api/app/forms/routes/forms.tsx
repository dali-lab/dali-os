import { redirect, useLoaderData } from "react-router";
import type { Route } from "./+types/forms";
import { requireAuth, forbidden, redirectApplicantToPortal } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { canViewForms } from "~/lib/roles";
import { loadFormsLevel, runFormsAction } from "~/forms/lib/forms-data";
import { FormsBrowser } from "~/forms/components/FormsBrowser";

export const meta: Route.MetaFunction = () => [{ title: "Forms · DALI OS" }];

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  const portalRedirect = redirectApplicantToPortal(auth);
  if (portalRedirect) return portalRedirect;
  if (!(await canViewForms(auth.user.sub))) return redirect("/");

  const level = await loadFormsLevel(null);
  return level!; // top level always resolves
}

export async function action({ request }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  if (!(await canViewForms(auth.user.sub)))
    return forbidden(request);

  const result = await runFormsAction(
    await request.formData(),
    auth.user.sub,
  );
  if ("error" in result)
    return Response.json({ error: result.error }, { status: result.status });
  return result;
}

export default function FormsPage() {
  const { folders, forms, allFolders, allForms } = useLoaderData<typeof loader>();

  return (
    <div className="flex flex-col gap-4">
      <header>
        <h1 className="font-heading text-2xl font-bold text-foreground">
          Forms
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Create forms and organize them into folders. Click a folder to open
          it. Editing a form's questions appends a new version; anyone filling
          it out sees the latest.
        </p>
      </header>

      <FormsBrowser
        folderId={null}
        parentId={null}
        folders={folders}
        forms={forms}
        allFolders={allFolders}
        allForms={allForms}
      />
    </div>
  );
}
