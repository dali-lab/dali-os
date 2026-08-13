// Core-namespaced staffing board.
//
// PURE RE-EXPORT of ~/projects/routes/projects.staffing — there is exactly one implementation and this
// module delegates to it entirely. The /core URL is canonical while the
// nav-regroup flag is on; the pre-regroup URL redirects here for those
// viewers (regroupRedirect, called in the source loader).
//
// `handle` is overridden rather than re-exported so the breadcrumb reads
// "Core › …" instead of the source page's own trail. That override is the
// reason these aliases are files rather than a second route id.

import { coreHandle } from "~/core/coreNav";

export { meta, loader, default } from "~/projects/routes/projects.staffing";

export const handle = coreHandle("staffing");
