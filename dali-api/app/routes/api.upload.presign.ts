// POST /api/upload/presign
// Body: { key: string, contentType: string }
// Returns: { uploadUrl: string, key: string }
//
// The client uploads directly to S3 using the presigned PUT URL.
// After upload, store the key in the DB and use GET /api/upload/url?key=... to read it.

import { requireAuth } from '~/lib/auth'
import { getUploadUrl } from '~/lib/s3'
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_LABEL } from '~/lib/file-validation'

const ALLOWED_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'application/pdf',
])

export async function action({ request }: { request: Request }) {
  try {
    const auth = await requireAuth(request)
    if (!auth.ok) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const { key, contentType, contentLength } = await request.json()

    if (!key || typeof key !== 'string') {
      return Response.json({ error: 'key is required' }, { status: 400 })
    }
    if (!contentType || !ALLOWED_TYPES.has(contentType)) {
      return Response.json(
        { error: `contentType must be one of: ${[...ALLOWED_TYPES].join(', ')}` },
        { status: 400 },
      )
    }
    // Advisory size cap. The client supplies contentLength so this is spoofable;
    // it catches honest oversize requests cheaply but does not bind the actual
    // upload — S3 presigned PUTs don't enforce length. True enforcement would
    // require presigned POST with content-length-range.
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

    // Scope all keys under uploads/ to avoid collisions with other bucket contents
    const scopedKey = key.startsWith('uploads/') ? key : `uploads/${key}`

    const uploadUrl = await getUploadUrl(scopedKey, contentType)
    return Response.json({ uploadUrl, key: scopedKey })
  } catch (err) {
    console.error('Upload presign error:', err)
    return Response.json(
      { error: 'Failed to generate upload URL' },
      { status: 500 },
    )
  }
}
