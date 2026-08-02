// Moved to Admin → Email Templates. Bookmark redirect only.

import { redirect } from 'react-router'
import type { Route } from './+types/email-templates.$id'

export async function loader({ params }: Route.LoaderArgs) {
  return redirect(`/admin/email-templates/${params.id}`)
}
