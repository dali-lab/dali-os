// Bookmarks for the editors that /admin/email replaced. One file serves every
// old path — /admin/email-templates, /core/communications/email,
// /hiring/emails, and their /:id variants. The id is dropped because templates
// no longer have one: there is exactly one row per registry key.

import { redirect } from "react-router";

export async function loader() {
  return redirect("/admin/email");
}
