import { redirect, useLoaderData, useActionData, useSearchParams, Form, useNavigation } from 'react-router'
import { useState, useRef } from 'react'
import type { Route } from './+types/account.profile'
import { requireAuth } from '~/lib/auth'
import { prisma } from '~/lib/db'
import { getDownloadUrl } from '~/lib/s3'
import { getUserRolesDetailed } from '~/lib/roles'
import { Avatar } from '~/components/Avatar'
import { Camera, X, CheckCircle, AlertCircle, XCircle, Calendar } from 'lucide-react'

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request)
  if (!auth.ok) return redirect('/login')

  const member = await prisma.dALIMember.findFirst({
    where: { userId: auth.user.sub },
    select: {
      profilePictureKey: true,
      graduationYear: true,
      major: true,
      githubUrl: true,
      linkedinUrl: true,
      portfolioUrl: true,
      daliEmail: true,
      dartmouthEmail: true,
      did: true,
      googleRefreshToken: true,
      googleTokenExpiresAt: true,
    },
  })
  if (!member) return redirect('/login')

  const user = await prisma.user.findUnique({
    where: { id: auth.user.sub },
    select: { firstName: true, lastName: true, dartmouthEmail: true },
  })
  if (!user) return redirect('/login')

  let profilePictureUrl: string | null = null
  if (member.profilePictureKey) {
    profilePictureUrl = await getDownloadUrl(member.profilePictureKey)
  }

  const roles = await getUserRolesDetailed(auth.user.sub)

  const hasRefreshToken = !!member.googleRefreshToken
  const tokenExpired = member.googleTokenExpiresAt ? member.googleTokenExpiresAt < new Date() : true

  return {
    user: {
      firstName: user.firstName,
      lastName: user.lastName,
      profilePictureKey: member.profilePictureKey,
      graduationYear: member.graduationYear,
      major: member.major,
      githubUrl: member.githubUrl,
      linkedinUrl: member.linkedinUrl,
      portfolioUrl: member.portfolioUrl,
    },
    profilePictureUrl,
    member: {
      daliEmail: member.daliEmail,
      dartmouthEmail: member.dartmouthEmail ?? user.dartmouthEmail,
      did: member.did,
    },
    roles,
    calendarConnected: hasRefreshToken,
    calendarTokenExpired: hasRefreshToken && tokenExpired,
  }
}

export async function action({ request }: Route.ActionArgs) {
  const auth = await requireAuth(request)
  if (!auth.ok) return redirect('/login')

  const form = await request.formData()
  const firstName = (form.get('firstName') as string)?.trim()
  const lastName = (form.get('lastName') as string)?.trim()
  const graduationYearRaw = form.get('graduationYear') as string
  const major = (form.get('major') as string)?.trim() || null
  const githubUrl = (form.get('githubUrl') as string)?.trim() || null
  const linkedinUrl = (form.get('linkedinUrl') as string)?.trim() || null
  const portfolioUrl = (form.get('portfolioUrl') as string)?.trim() || null
  const profilePictureKey = (form.get('profilePictureKey') as string)?.trim() || null

  if (!firstName || !lastName) {
    return { error: 'First and last name are required.' }
  }

  let graduationYear: number | null = null
  if (graduationYearRaw) {
    graduationYear = parseInt(graduationYearRaw, 10)
    if (isNaN(graduationYear) || graduationYear < 2000 || graduationYear > 2040) {
      return { error: 'Graduation year must be between 2000 and 2040.' }
    }
  }

  // Basic URL validation for optional link fields
  for (const [label, val] of [['GitHub', githubUrl], ['LinkedIn', linkedinUrl], ['Portfolio', portfolioUrl]] as const) {
    if (val) {
      try {
        new URL(val)
      } catch {
        return { error: `${label} URL is not valid.` }
      }
    }
  }

  // Sync names on both User and DALIMember
  await prisma.user.update({
    where: { id: auth.user.sub },
    data: { firstName, lastName },
  })

  await prisma.dALIMember.update({
    where: { userId: auth.user.sub },
    data: {
      firstName,
      lastName,
      graduationYear,
      major,
      githubUrl,
      linkedinUrl,
      portfolioUrl,
      ...(profilePictureKey !== undefined ? { profilePictureKey } : {}),
    },
  })

  return redirect('/account?saved=1')
}

const inputClass = 'w-full px-3 py-2 bg-card border border-input rounded-lg text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring'
const disabledInputClass = 'w-full px-3 py-2 bg-muted border border-input rounded-lg text-sm text-muted-foreground cursor-not-allowed'

export default function AccountPage() {
  const { user, profilePictureUrl, member, roles, calendarConnected, calendarTokenExpired } = useLoaderData<typeof loader>()
  const actionData = useActionData<typeof action>()
  const [searchParams] = useSearchParams()
  const navigation = useNavigation()
  const saving = navigation.state === 'submitting'
  const justSaved = searchParams.get('saved') === '1'
  const calendarStatus = searchParams.get('calendar')

  const [avatarPreview, setAvatarPreview] = useState<string | null>(profilePictureUrl)
  const [pictureKey, setPictureKey] = useState<string | null>(user.profilePictureKey)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const hasPhoto = avatarPreview !== null
  const initials = `${user.firstName[0] ?? ''}${user.lastName[0] ?? ''}`.toUpperCase() || '?'

  let calStatus: 'connected' | 'expired' | 'disconnected'
  if (!calendarConnected) calStatus = 'disconnected'
  else if (calendarTokenExpired) calStatus = 'expired'
  else calStatus = 'connected'

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    if (!file.type.startsWith('image/')) {
      setUploadError('Please select an image file.')
      return
    }

    if (file.size > 5 * 1024 * 1024) {
      setUploadError('Image must be under 5MB.')
      return
    }

    setUploadError(null)
    setUploading(true)

    try {
      const ext = file.name.split('.').pop() ?? 'jpg'
      const key = `profile-pictures/${crypto.randomUUID()}.${ext}`

      const presignRes = await fetch('/api/upload/presign', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, contentType: file.type }),
      })
      if (!presignRes.ok) throw new Error('Failed to get upload URL')

      const { uploadUrl, key: scopedKey } = await presignRes.json()

      const uploadRes = await fetch(uploadUrl, {
        method: 'PUT',
        body: file,
        headers: { 'Content-Type': file.type },
      })
      if (!uploadRes.ok) throw new Error('Upload failed')

      setPictureKey(scopedKey)
      setAvatarPreview(URL.createObjectURL(file))
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="space-y-8">
      {/* Banners */}
      {justSaved && (
        <div className="flex items-center gap-2 px-4 py-3 bg-accent-green/20 border border-accent-green/30 rounded-lg text-sm text-foreground">
          <CheckCircle className="w-4 h-4 text-accent-green flex-shrink-0" />
          Profile saved.
        </div>
      )}

      {calendarStatus === 'connected' && (
        <div className="flex items-center gap-2 px-4 py-3 bg-accent-green/20 border border-accent-green/30 rounded-lg text-sm text-foreground">
          <CheckCircle className="w-4 h-4 text-accent-green flex-shrink-0" />
          Google Calendar connected successfully.
        </div>
      )}

      {calendarStatus === 'error' && (
        <div className="flex items-center gap-2 px-4 py-3 bg-destructive/10 border border-destructive/30 rounded-lg text-sm text-destructive">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          Failed to connect Google Calendar. Please try again.
        </div>
      )}

      {actionData?.error && (
        <div className="px-4 py-3 bg-destructive/10 border border-destructive/30 rounded-lg text-sm text-destructive">
          {actionData.error}
        </div>
      )}

      <Form method="post" className="space-y-6">
        {pictureKey !== undefined && (
          <input type="hidden" name="profilePictureKey" value={pictureKey ?? ''} />
        )}

        {/* Profile picture + name + roles */}
        <div className="flex items-start gap-5">
          <div className="relative flex-shrink-0">
            <Avatar src={avatarPreview} fallback={initials} size={80} />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full bg-card border border-border flex items-center justify-center text-muted-foreground hover:text-foreground transition shadow-sm"
            >
              <Camera className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="flex-1 min-w-0 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label htmlFor="firstName" className="block text-sm font-medium text-foreground mb-1">First name</label>
                <input id="firstName" name="firstName" type="text" required defaultValue={user.firstName} className={inputClass} />
              </div>
              <div>
                <label htmlFor="lastName" className="block text-sm font-medium text-foreground mb-1">Last name</label>
                <input id="lastName" name="lastName" type="text" required defaultValue={user.lastName} className={inputClass} />
              </div>
            </div>
            {roles.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {roles.map((role) => (
                  <span key={role} className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-accent-coral/10 text-accent-coral">
                    {role}
                  </span>
                ))}
              </div>
            )}
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="text-sm font-medium text-accent-coral hover:text-accent-coral/80 transition"
              >
                {uploading ? 'Uploading...' : 'Change photo'}
              </button>
              {hasPhoto && (
                <button
                  type="button"
                  onClick={() => { setPictureKey(null); setAvatarPreview(null) }}
                  className="flex items-center gap-1 text-sm text-muted-foreground hover:text-destructive transition"
                >
                  <X className="w-3.5 h-3.5" />
                  Remove
                </button>
              )}
            </div>
            {uploadError && <p className="text-xs text-destructive">{uploadError}</p>}
          </div>
          <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFileChange} className="hidden" />
        </div>

        {/* Details */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="graduationYear" className="block text-sm font-medium text-foreground mb-1">Graduation year</label>
            <input id="graduationYear" name="graduationYear" type="number" min={2000} max={2040} defaultValue={user.graduationYear ?? ''} placeholder="e.g. 2027" className={inputClass} />
          </div>
          <div>
            <label htmlFor="major" className="block text-sm font-medium text-foreground mb-1">Major / Minor</label>
            <input id="major" name="major" type="text" defaultValue={user.major ?? ''} placeholder="e.g. Math+CS" className={inputClass} />
          </div>
        </div>

        {/* Emails (read-only) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {member.daliEmail && (
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">DALI email</label>
              <input type="text" value={member.daliEmail} disabled className={disabledInputClass} />
            </div>
          )}
          {member.dartmouthEmail && (
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">Dartmouth email</label>
              <input type="text" value={member.dartmouthEmail} disabled className={disabledInputClass} />
            </div>
          )}
          {member.did && (
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">DID</label>
              <input type="text" value={member.did} disabled className={`${disabledInputClass} font-mono`} />
            </div>
          )}
        </div>

        {/* Links */}
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-foreground">Links</h3>
          <div>
            <label htmlFor="githubUrl" className="block text-xs text-muted-foreground mb-1">GitHub</label>
            <input id="githubUrl" name="githubUrl" type="url" defaultValue={user.githubUrl ?? ''} placeholder="https://github.com/username" className={inputClass} />
          </div>
          <div>
            <label htmlFor="linkedinUrl" className="block text-xs text-muted-foreground mb-1">LinkedIn</label>
            <input id="linkedinUrl" name="linkedinUrl" type="url" defaultValue={user.linkedinUrl ?? ''} placeholder="https://linkedin.com/in/username" className={inputClass} />
          </div>
          <div>
            <label htmlFor="portfolioUrl" className="block text-xs text-muted-foreground mb-1">Portfolio</label>
            <input id="portfolioUrl" name="portfolioUrl" type="url" defaultValue={user.portfolioUrl ?? ''} placeholder="https://yoursite.com" className={inputClass} />
          </div>
        </div>

        {/* Save */}
        <div>
          <button
            type="submit"
            disabled={saving || uploading}
            className="px-4 py-2 bg-accent-coral text-white text-sm font-medium rounded-lg hover:bg-accent-coral/90 transition disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save changes'}
          </button>
        </div>
      </Form>

      {/* Google Calendar */}
      <div className="bg-card border border-border rounded-lg p-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-muted flex items-center justify-center flex-shrink-0">
              <Calendar className="w-4.5 h-4.5 text-muted-foreground" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-foreground">Google Calendar</h3>
              <div className="flex items-center gap-1.5 mt-0.5">
                {calStatus === 'connected' && (
                  <>
                    <CheckCircle className="w-3 h-3 text-accent-green" />
                    <span className="text-xs text-accent-green font-medium">Connected</span>
                  </>
                )}
                {calStatus === 'expired' && (
                  <>
                    <AlertCircle className="w-3 h-3 text-accent-coral" />
                    <span className="text-xs text-accent-coral font-medium">Token expired</span>
                  </>
                )}
                {calStatus === 'disconnected' && (
                  <>
                    <XCircle className="w-3 h-3 text-muted-foreground" />
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
              {calStatus === 'connected' ? 'Reconnect' : 'Connect'}
            </button>
          </Form>
        </div>
      </div>
    </div>
  )
}
