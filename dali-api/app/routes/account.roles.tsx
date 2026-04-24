import { redirect, useLoaderData } from 'react-router'
import type { Route } from './+types/account.roles'
import { requireAuth } from '~/lib/auth'
import { requireMember, getUserRolesDetailed } from '~/lib/roles'

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request)
  if (!auth.ok) return redirect('/login')

  const member = await requireMember(auth.user.sub)
  if (!member) return redirect('/account')

  const roles = await getUserRolesDetailed(auth.user.sub)

  return { roles }
}

export default function RolesTab() {
  const { roles } = useLoaderData<typeof loader>()

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-heading font-bold text-xl text-foreground">Roles & Access</h2>
        <p className="text-sm text-muted-foreground mt-1">Your current roles and permissions in DALI.</p>
      </div>

      <div className="bg-card border border-border rounded-lg p-5">
        {roles.length === 0 ? (
          <p className="text-sm text-muted-foreground">No roles assigned. You have basic member access.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {roles.map((role) => (
              <span
                key={role}
                className="inline-flex items-center px-3 py-1.5 rounded-full text-xs font-medium bg-muted text-foreground"
              >
                {role}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
