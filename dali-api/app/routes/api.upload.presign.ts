// POST /api/upload/presign
// Body: { key: string, contentType: string, contentLength?: number, accept?: string }
// Returns: { url: string, fields: Record<string, string>, key: string }
//
// The client uploads directly to S3 via multipart POST using the returned
// url + fields. S3 enforces content-length-range and Content-Type via the
// signed policy, so a malicious client cannot exceed the size cap.
// After upload, store the key in the DB and use GET /api/upload/url?key=... to read it.

import { requireAuth } from "~/lib/auth";
import { getUploadPost, isS3Configured } from '~/lib/s3'
import {
  MAX_UPLOAD_BYTES,
  MAX_UPLOAD_LABEL,
  fileMatchesAccept,
  isBlockedUpload,
} from '~/lib/file-validation'
import { checkRateLimit } from '~/lib/rate-limit'

const RATE_LIMIT_MAX = 20
const RATE_LIMIT_WINDOW_MS = 60_000

function filenameFromKey(key: string): string {
  const idx = key.lastIndexOf('/')
  return idx < 0 ? key : key.slice(idx + 1)
}

export async function action({ request }: { request: Request }) {
  try {
    const auth = await requireAuth(request)
    if (!auth.ok) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const rateLimited = checkRateLimit(
      request,
      { max: RATE_LIMIT_MAX, windowMs: RATE_LIMIT_WINDOW_MS },
      auth.user.sub,
    )
    if (rateLimited) return rateLimited

    const { key, contentType, contentLength, accept } = await request.json()

    if (!key || typeof key !== 'string') {
      return Response.json({ error: 'key is required' }, { status: 400 })
    }
    if (!contentType || typeof contentType !== 'string') {
      return Response.json({ error: 'contentType is required' }, { status: 400 })
    }
    if (accept !== undefined && typeof accept !== 'string') {
      return Response.json({ error: 'accept must be a string' }, { status: 400 })
    }

    const fileName = filenameFromKey(key)

    // Defense-in-depth: block known-dangerous types regardless of what the
    // caller's `accept` config says. Runs unconditionally so a misconfigured
    // challenge accept string can't accidentally permit executables.
    if (isBlockedUpload(fileName, contentType)) {
      return Response.json({ error: 'File type not allowed' }, { status: 400 })
    }

    if (accept && !fileMatchesAccept(fileName, contentType, accept)) {
      return Response.json(
              { error: `File type not allowed. Accepted: ${accept}` },
              { status: 400 },
            )
    }
    // Cheap pre-check that returns a clean 413 before signing. The presigned
    // POST policy below also enforces the size cap server-side, so this is
    // only for UX — the client cannot bypass the real limit.
    if (contentLength !== undefined) {
      if (typeof contentLength !== 'number' || !Number.isFinite(contentLength) || contentLength < 0) {
        return Response.json({ error: 'contentLength must be a non-negative number' }, { status: 400 })
      }
      if (contentLength > MAX_UPLOAD_BYTES) {
        return Response.json(
                  { error: `File too large (max ${MAX_UPLOAD_LABEL})` },
                  { status: 413 },
                )
      }
    }

    // Say so plainly when the bucket isn't configured. Without this the AWS SDK
    // throws on a missing bucket and every caller — the editor's image
    // drag-drop, project banners, avatars, file uploads — reports the same
    // opaque "Failed to generate upload URL", which reads as a bug in the
    // feature rather than a missing local credential.
    if (!isS3Configured()) {
      return Response.json(
        { error: 'File storage is not configured on this server (AWS_S3_BUCKET / credentials).' },
        { status: 503 },
      )
    }

    // Scope all keys under uploads/ to avoid collisions with other bucket contents
    const scopedKey = key.startsWith('uploads/') ? key : `uploads/${key}`

    const { url, fields } = await getUploadPost(scopedKey, contentType)
    return Response.json({ url, fields, key: scopedKey })
  } catch (err) {
    console.error('Upload presign error:', err)
    return Response.json(
      { error: 'Failed to generate upload URL' },
      { status: 500 },
    )
  }
}
