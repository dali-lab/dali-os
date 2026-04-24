import { redirect, useLoaderData, Form, useNavigation } from 'react-router'
import { useState, useRef } from 'react'
import type { Route } from './+types/account.profile'
import { requireAuth } from '~/lib/auth'
import { prisma } from '~/lib/db'
import { getDownloadUrl } from '~/lib/s3'
import { Avatar } from '~/components/Avatar'
import { Camera } from 'lucide-react'

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request)
  if (!auth.ok) return redirect('/login')

  const user = await prisma.user.findUnique({
    where: { id: auth.user.sub },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      profilePictureKey: true,
      graduationYear: true,
      major: true,
      githubUrl: true,
      linkedinUrl: true,
      portfolioUrl: true,
    },
  })

  if (!user) return redirect('/login')

  let profilePictureUrl: string | null = null
  if (user.profilePictureKey) {
    profilePictureUrl = await getDownloadUrl(user.profilePictureKey)
  }

  // Fetch member identifiers (read-only display)
  const member = await prisma.dALIMember.findFirst({
    where: { userId: auth.user.sub },
    select: { daliEmail: true, dartmouthEmail: true, did: true },
  })

  return {
    user: {
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      profilePictureKey: user.profilePictureKey,
      graduationYear: user.graduationYear,
      major: user.major,
      githubUrl: user.githubUrl,
      linkedinUrl: user.linkedinUrl,
      portfolioUrl: user.portfolioUrl,
    },
    profilePictureUrl,
    member,
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

  await prisma.user.update({
    where: { id: auth.user.sub },
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

  return redirect('/account')
}

export default function ProfileTab() {
  const { user, profilePictureUrl, member } = useLoaderData<typeof loader>()
  const navigation = useNavigation()
  const saving = navigation.state === 'submitting'

  const [avatarPreview, setAvatarPreview] = useState<string | null>(profilePictureUrl)
  const [pictureKey, setPictureKey] = useState<string | null>(user.profilePictureKey)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const initials = `${user.firstName[0] ?? ''}${user.lastName[0] ?? ''}`.toUpperCase() || '?'

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
    <div className="space-y-6">
      <div>
        <h2 className="font-heading font-bold text-xl text-foreground">Profile</h2>
        <p className="text-sm text-muted-foreground mt-1">Manage your personal information.</p>
      </div>

      <Form method="post" className="space-y-6">
        {pictureKey !== undefined && (
          <input type="hidden" name="profilePictureKey" value={pictureKey ?? ''} />
        )}

        {/* Profile picture */}
        <div className="flex items-center gap-4">
          <div className="relative">
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
          <div>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="text-sm font-medium text-accent-coral hover:text-accent-coral/80 transition"
            >
              {uploading ? 'Uploading...' : 'Change photo'}
            </button>
            {uploadError && <p className="text-xs text-destructive mt-1">{uploadError}</p>}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleFileChange}
            className="hidden"
          />
        </div>

        {/* Name fields */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="firstName" className="block text-sm font-medium text-foreground mb-1">First name</label>
            <input
              id="firstName"
              name="firstName"
              type="text"
              required
              defaultValue={user.firstName}
              className="w-full px-3 py-2 bg-card border border-input rounded-lg text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <div>
            <label htmlFor="lastName" className="block text-sm font-medium text-foreground mb-1">Last name</label>
            <input
              id="lastName"
              name="lastName"
              type="text"
              required
              defaultValue={user.lastName}
              className="w-full px-3 py-2 bg-card border border-input rounded-lg text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
        </div>

        {/* Graduation year */}
        <div className="max-w-xs">
          <label htmlFor="graduationYear" className="block text-sm font-medium text-foreground mb-1">Graduation year</label>
          <input
            id="graduationYear"
            name="graduationYear"
            type="number"
            min={2000}
            max={2040}
            defaultValue={user.graduationYear ?? ''}
            placeholder="e.g. 2027"
            className="w-full px-3 py-2 bg-card border border-input rounded-lg text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>

        {/* Major */}
        <div className="max-w-xs">
          <label htmlFor="major" className="block text-sm font-medium text-foreground mb-1">Major / Minor</label>
          <input
            id="major"
            name="major"
            type="text"
            defaultValue={user.major ?? ''}
            placeholder="e.g. Math+CS"
            className="w-full px-3 py-2 bg-card border border-input rounded-lg text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>

        {/* Links */}
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-foreground">Links</h3>
          <div>
            <label htmlFor="githubUrl" className="block text-xs text-muted-foreground mb-1">GitHub</label>
            <input
              id="githubUrl"
              name="githubUrl"
              type="url"
              defaultValue={user.githubUrl ?? ''}
              placeholder="https://github.com/username"
              className="w-full px-3 py-2 bg-card border border-input rounded-lg text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <div>
            <label htmlFor="linkedinUrl" className="block text-xs text-muted-foreground mb-1">LinkedIn</label>
            <input
              id="linkedinUrl"
              name="linkedinUrl"
              type="url"
              defaultValue={user.linkedinUrl ?? ''}
              placeholder="https://linkedin.com/in/username"
              className="w-full px-3 py-2 bg-card border border-input rounded-lg text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <div>
            <label htmlFor="portfolioUrl" className="block text-xs text-muted-foreground mb-1">Portfolio</label>
            <input
              id="portfolioUrl"
              name="portfolioUrl"
              type="url"
              defaultValue={user.portfolioUrl ?? ''}
              placeholder="https://yoursite.com"
              className="w-full px-3 py-2 bg-card border border-input rounded-lg text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
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

      {/* Member identifiers (read-only) */}
      {member && (
        <div className="space-y-4 pt-2">
          <div>
            <h3 className="text-sm font-medium text-foreground">Identifiers</h3>
            <p className="text-xs text-muted-foreground mt-0.5">These are managed by DALI and cannot be edited here.</p>
          </div>
          <div className="bg-card border border-border rounded-lg divide-y divide-border">
            {member.daliEmail && (
              <div className="flex items-center justify-between px-4 py-3">
                <span className="text-xs text-muted-foreground">DALI Email</span>
                <span className="text-sm text-foreground">{member.daliEmail}</span>
              </div>
            )}
            {member.dartmouthEmail && (
              <div className="flex items-center justify-between px-4 py-3">
                <span className="text-xs text-muted-foreground">Dartmouth Email</span>
                <span className="text-sm text-foreground">{member.dartmouthEmail}</span>
              </div>
            )}
            {member.did && (
              <div className="flex items-center justify-between px-4 py-3">
                <span className="text-xs text-muted-foreground">DID</span>
                <span className="text-sm font-mono text-foreground">{member.did}</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
