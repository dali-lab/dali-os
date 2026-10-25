import { redirect } from "react-router";
import type { Route } from "./+types/core.access";
import { requireAuth } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { isAdmin, isCore } from "~/lib/roles";
import { coreHandle } from "~/core/coreNav";
import { loadAccess } from "~/core/lib/access.server";
import { action as rolesAction } from "~/admin/routes/admin.members";
import { action as domainsAction } from "~/admin/routes/admin.domains";
import { RolesDomainsPage } from "~/core/components/access/RolesDomainsPage";

export const handle = coreHandle("access");

export const meta: Route.MetaFunction = () => [{ title: "Roles & domains · Core · DALI OS" }];

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  if (!(await isCore(auth.user.sub))) return redirect("/");
  const [data, viewerIsAdmin] = await Promise.all([loadAccess(), isAdmin(auth.user.sub)]);
  return { ...data, viewerIsAdmin, isAdmin: viewerIsAdmin };
}

/** Which page used to own each intent. Its action still does the work, with its own checks. */
export const INTENT_OWNER = {
  "set-admin": "roles",
  "set-staff": "roles",
  "add-core-title": "roles",
  "remove-core-title": "roles",
  // The roles page's version records the change in the audit log.
  "add-domain-lead": "roles",
  "remove-domain-lead": "roles",
  "create-domain": "domains",
  "delete-domain": "domains",
  "add-eligibility": "domains",
  "set-eligibility-level": "domains",
  "remove-eligibility": "domains",
} as const;

export async function action({ request, params, context }: Route.ActionArgs) {
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "") as keyof typeof INTENT_OWNER;
  const owner = INTENT_OWNER[intent];
  if (!owner) return Response.json({ error: "Unknown action." }, { status: 400 });
  // The form was read here, so hand the delegate a fresh request carrying it.
  // Its content type (with the old multipart boundary) must not carry over.
  const headers = new Headers(request.headers);
  headers.delete("content-type");
  headers.delete("content-length");
  const forwarded = new Request(request.url, { method: "POST", headers, body: form });
  const args = { request: forwarded, params, context } as never;
  return owner === "roles" ? rolesAction(args) : domainsAction(args);
}

export default function CoreAccessRoute({ loaderData }: Route.ComponentProps) {
  return <RolesDomainsPage data={loaderData} />;
}
