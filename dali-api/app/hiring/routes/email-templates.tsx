// The email template library moved to Admin → Email Templates (templates
// serve every area, not just hiring). Bookmark redirect only.

import { redirect } from 'react-router'

export async function loader() {
  return redirect('/admin/email-templates')
}
