// Core-namespaced roles & permissions.
//
// PURE RE-EXPORT of ~/admin/routes/admin.members — there is exactly one implementation and this
// module delegates to it entirely. The /core URL is canonical while the
// nav-regroup flag is on; the pre-regroup URL redirects here for those
// viewers (regroupRedirect, called in the source loader).
//
// `handle` is overridden rather than re-exported so the breadcrumb reads
// "Core › …" instead of the source page's own trail. That override is the
// reason these aliases are files rather than a second route id.

import { coreHandle } from "~/core/coreNav";

export { meta, loader, action, default } from "~/admin/routes/admin.members";

export const handle = coreHandle("roles");
