// Drive-namespaced authoring route for agreement templates.
//
// This file is a PURE RE-EXPORT of the admin.agreements.$id route — there is
// exactly one implementation (the admin route) and this module delegates to it
// entirely. The Drive URL (/documents/agreement/:id) becomes the canonical
// surface when the drive-consolidation flag is on; the admin URL redirects here
// so old bookmarks keep working.
//
// The redirect-loop guard lives in admin.agreements.$id.tsx: its loader only
// redirects when the request path starts with /admin/agreements, so re-exporting
// that loader here is safe — loading /documents/agreement/:id will not redirect.

export { loader, action, default } from "./admin.agreements.$id";
