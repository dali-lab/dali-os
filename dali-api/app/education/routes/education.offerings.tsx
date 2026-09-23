import { redirect, useLoaderData, Link } from "react-router";
import type { Route } from "./+types/education.offerings";
import { requireAuth } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { getUserRoles } from "~/lib/roles";
import { listCatalog, listManageable } from "~/education/lib/offerings.server";
import {
  OfferingCatalog,
  type CatalogOffering,
} from "~/education/components/OfferingCatalog";
import { buttonClasses } from "~/components/ui/Button";
import { useFeatureFlag } from "~/components/FeatureFlags";

export const meta: Route.MetaFunction = () => [{ title: "Offerings · DALI OS" }];

export const handle = {
  // Offering pages name themselves in their own headers, so the trail above
  // them only repeated where you already are.
  hideBreadcrumbs: true,
};

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);

  const roles = await getUserRoles(auth.user.sub);
  // Every lab member browses here. An external instructor (no DALIMember row)
  // reaches it too, for the offerings they teach — the layout keeps them in the
  // instructor chrome. Anyone else belongs on the portal mirror.
  const canManage = roles.isCore || roles.isInstructor;
  if (!roles.isLabMember && !canManage) return redirect("/portal/education");

  const [catalog, manageable] = await Promise.all([
    roles.isLabMember ? listCatalog(auth.user.sub) : Promise.resolve([]),
    canManage ? listManageable(auth.user.sub) : Promise.resolve([]),
  ]);

  // The catalog is the published, browsable set; a manager also sees their own
  // drafts and archived offerings, which the catalog query excludes. Catalog
  // rows win on overlap since they carry the viewer's own application status.
  const byId = new Map<string, CatalogOffering>(
    catalog.map((o) => [o.id, o as CatalogOffering]),
  );
  for (const o of manageable) {
    if (!byId.has(o.id)) byId.set(o.id, { ...o, myStatus: null });
  }

  return {
    offerings: [...byId.values()],
    isCore: roles.isCore,
  };
}

export default function EducationOfferings() {
  const { offerings, isCore } = useLoaderData<typeof loader>();
  const certTemplatesOn = useFeatureFlag("certificate-templates");

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-bold text-foreground">
            Offerings
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Workshops, miniseries, and fellowships run by the lab. Open one to
            apply, RSVP, or manage it.
          </p>
        </div>
        {isCore && (
          <div className="flex shrink-0 items-center gap-2">
            {certTemplatesOn && (
              <Link
                to="/education/certificate-templates"
                className={buttonClasses("secondary", "sm")}
              >
                Certificate templates
              </Link>
            )}
            <Link to="/education/manage/new" className={buttonClasses("primary", "sm")}>
              New offering
            </Link>
          </div>
        )}
      </header>

      <OfferingCatalog offerings={offerings} to={(id) => `/education/${id}`} />
    </div>
  );
}
