// Bookmarks for the editors that the unified email editor replaced. One file
// serves every old path — /admin/email-templates, /hiring/emails, the old
// /core/communications/email/:id detail page, and their /:id variants. The id is
// dropped because templates no longer have one: there is exactly one row per
// registry key.
//
// /admin/email is NOT here: it redirects from inside the source loader
// (regroupRedirect), which keeps its query string.

import { redirect } from "react-router";

export async function loader() {
  return redirect("/core/communications/email");
}
