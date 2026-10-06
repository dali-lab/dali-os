// Core-namespaced email editor.
//
// PURE RE-EXPORT of ~/admin/routes/admin.email — there is exactly one
// implementation and this module delegates to it entirely. /core is the
// canonical URL (Core ▸ Communications ▸ Email is the only nav entry that
// points at this page); /admin/email redirects here via regroupRedirect in the
// source loader.
//
// `handle` is overridden rather than re-exported so the trail reads
// "Core › Communications › Email" and carries the section switcher. That
// override is the reason these aliases are files rather than a second route id.

import { coreHandle } from "~/core/coreNav";

export { meta, loader, action, default } from "~/admin/routes/admin.email";

export const handle = coreHandle("email");
