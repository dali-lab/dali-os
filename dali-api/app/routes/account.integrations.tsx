import { redirect, useLoaderData, Form, useSearchParams } from 'react-router'
import type { Route } from './+types/account.integrations'
import { requireAuth } from '~/lib/auth'
import { requireMember } from '~/lib/roles'
import { prisma } from '~/lib/db'
import { Calendar, CheckCircle, AlertCircle, XCircle } from 'lucide-react'

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request)
  if (!auth.ok) return redirect('/login')

  const member = await requireMember(auth.user.sub)
  if (!member) return redirect('/account')

  const user = await prisma.user.findUnique({
    where: { id: auth.user.sub },
    select: {
      googleRefreshToken: true,
      googleTokenExpiresAt: true,
    },
  })

  const hasRefreshToken = !!user?.googleRefreshToken
  const tokenExpired = user?.googleTokenExpiresAt ? user.googleTokenExpiresAt < new Date() : true

  return {
    calendarConnected: hasRefreshToken,
    calendarTokenExpired: hasRefreshToken && tokenExpired,
  }
}

export default function IntegrationsTab() {
  const { calendarConnected, calendarTokenExpired } = useLoaderData<typeof loader>()
  const [searchParams] = useSearchParams()
  const justConnected = searchParams.get('calendar') === 'connected'

  let status: 'connected' | 'expired' | 'disconnected'
  if (!calendarConnected) status = 'disconnected'
  else if (calendarTokenExpired) status = 'expired'
  else status = 'connected'

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-heading font-bold text-xl text-foreground">Integrations</h2>
        <p className="text-sm text-muted-foreground mt-1">Manage connected services.</p>
      </div>

      {justConnected && (
        <div className="flex items-center gap-2 px-4 py-3 bg-accent-green/20 border border-accent-green/30 rounded-lg text-sm text-foreground">
          <CheckCircle className="w-4 h-4 text-accent-green flex-shrink-0" />
          Google Calendar connected successfully.
        </div>
      )}

      {/* Google Calendar */}
      <div className="bg-card border border-border rounded-lg p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center flex-shrink-0">
              <Calendar className="w-5 h-5 text-muted-foreground" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-foreground">Google Calendar</h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Used to check your availability when scheduling interviews.
              </p>

              <div className="flex items-center gap-1.5 mt-2">
                {status === 'connected' && (
                  <>
                    <CheckCircle className="w-3.5 h-3.5 text-accent-green" />
                    <span className="text-xs text-accent-green font-medium">Connected</span>
                  </>
                )}
                {status === 'expired' && (
                  <>
                    <AlertCircle className="w-3.5 h-3.5 text-accent-coral" />
                    <span className="text-xs text-accent-coral font-medium">Token expired</span>
                  </>
                )}
                {status === 'disconnected' && (
                  <>
                    <XCircle className="w-3.5 h-3.5 text-muted-foreground" />
                    <span className="text-xs text-muted-foreground font-medium">Not connected</span>
                  </>
                )}
              </div>
            </div>
          </div>

          <Form method="post" action="/account/reconnect-calendar">
            <button
              type="submit"
              className="px-3 py-1.5 text-xs font-medium rounded-lg border border-border text-foreground hover:bg-muted transition"
            >
              {status === 'connected' ? 'Reconnect' : 'Connect'}
            </button>
          </Form>
        </div>
      </div>
    </div>
  )
}
