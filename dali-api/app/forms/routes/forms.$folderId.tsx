import { redirect, useLoaderData, Link } from "react-router";
import { ChevronRight } from "lucide-react";
import type { Route } from "./+types/forms.$folderId";
import { requireAuth, forbidden, redirectApplicantToPortal } from "~/lib/auth";
import { isCore } from "~/lib/roles";
import { loadFormsLevel, runFormsAction } from "~/forms/lib/forms-data";
import { FormsBrowser } from "~/forms/components/FormsBrowser";

export const meta: Route.MetaFunction = ({ data }) => [
  { title: `${(data as any)?.current?.name ?? "Folder"} · Forms · DALI OS` },
];

export const handle = {
  breadcrumb: (data: unknown) =>
    (data as { current?: { name: string } } | undefined)?.current?.name,
};

export async function loader({ request, params }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");
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
  const { current, crumbs, folders, forms } = useLoaderData<typeof loader>();

  return (
    <div className="flex flex-col gap-4">
      <header>
        <nav className="flex items-center gap-1 text-sm text-muted-foreground flex-wrap">
          <Link to="/forms" className="hover:text-foreground transition-colors">
            Forms
          </Link>
          {crumbs.map((c) => (
            <span key={c.id} className="flex items-center gap-1">
              <ChevronRight className="w-3.5 h-3.5" />
              <Link
                to={`/forms/${c.id}`}
                className="hover:text-foreground transition-colors"
              >
                {c.name}
              </Link>
            </span>
          ))}
          <ChevronRight className="w-3.5 h-3.5" />
          <span className="text-foreground font-medium">{current?.name}</span>
        </nav>
        <h1 className="font-heading text-2xl font-bold text-foreground mt-2">
          {current?.name}
        </h1>
      </header>

      <FormsBrowser
        folderId={current?.id ?? null}
        folders={folders}
        forms={forms}
      />
    </div>
  );
}
