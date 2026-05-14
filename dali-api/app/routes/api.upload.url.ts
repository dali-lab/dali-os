// GET /api/upload/url?key=uploads/projects/abc/poster.png
// Returns: { url: string } — a presigned S3 read URL valid for 1 hour

import { requireAuth } from "~/lib/auth";
import { getDownloadUrl } from '~/lib/s3'

export async function loader({ request }: { request: Request }) {
  const auth = await requireAuth(request)
  if (!auth.ok) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const key = new URL(request.url).searchParams.get('key')
  if (!key) return Response.json({ error: 'key query param is required' }, { status: 400 })

  const url = await getDownloadUrl(key)
  return Response.json({ url })
}
