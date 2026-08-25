import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { createPresignedPost, type PresignedPost } from '@aws-sdk/s3-presigned-post'
import { MAX_UPLOAD_BYTES } from './file-validation'

const REGION = process.env.AWS_REGION
const BUCKET = process.env.AWS_S3_BUCKET

export function isS3Configured(): boolean {
  return Boolean(
    REGION &&
      BUCKET &&
      process.env.AWS_ACCESS_KEY_ID &&
      process.env.AWS_SECRET_ACCESS_KEY,
  )
}

// `responseChecksumValidation: "WHEN_REQUIRED"` opts out of the SDK's default
// behavior of adding `x-amz-checksum-mode=ENABLED` to presigned GetObject URLs.
// That extra query param breaks SigV4 (signed headers don't account for it),
// producing "signature does not match" on the browser-side fetch. We don't
// rely on response checksum validation — S3 already integrity-checks via TLS.
const s3 = new S3Client({
  region: REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
  responseChecksumValidation: "WHEN_REQUIRED",
  requestChecksumCalculation: "WHEN_REQUIRED",
})

// Generate a presigned POST policy for uploading a file directly from the
// client to S3. Unlike presigned PUT, the policy includes server-bound
// conditions that S3 enforces — the client cannot exceed the size cap or
// upload a different content type, even if it ignores its own pre-checks.
export async function getUploadPost(
  key: string,
  contentType: string,
  expiresIn = 300,
): Promise<PresignedPost> {
  return createPresignedPost(s3, {
    Bucket: BUCKET!,
    Key: key,
    Conditions: [
      ['content-length-range', 0, MAX_UPLOAD_BYTES],
      ['eq', '$Content-Type', contentType],
      ['starts-with', '$key', 'uploads/'],
    ],
    Fields: { 'Content-Type': contentType },
    Expires: expiresIn,
  })
}

// Server-side direct upload (MCP tool path — no browser to hand a presigned
// POST to). Same uploads/ scoping contract as the presign route; callers
// enforce size/type limits before invoking.
export async function putObject(
  key: string,
  body: Uint8Array,
  contentType: string,
): Promise<void> {
  if (!isS3Configured()) {
    throw new Error("AWS S3 is not configured")
  }
  await s3.send(
    new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: body, ContentType: contentType }),
  )
}

// Generate a presigned URL for reading a private file.
//
// `options` may be a number (legacy `expiresIn`) or an options object. Setting
// `contentType` / `inline` overrides the response headers on the presigned URL
// (`response-content-type` / `response-content-disposition`). This matters for
// inline previews: the browser renders a file by these headers, so an object
// stored with a wrong or missing Content-Type (common for server-generated
// PDFs) would otherwise fail to load in an <iframe> even though we know its
// real type. Forcing the type we have on record — and `inline` disposition —
// makes the preview render regardless of how the bytes were stored.
type DownloadUrlOptions = {
  expiresIn?: number
  contentType?: string
  fileName?: string
  inline?: boolean
}

export async function getDownloadUrl(
  key: string,
  options: number | DownloadUrlOptions = {},
) {
  if (!isS3Configured()) {
    throw new Error("AWS S3 is not configured")
  }
  const { expiresIn = 3600, contentType, fileName, inline } =
    typeof options === "number" ? { expiresIn: options } : options

  const disposition = inline
    ? "inline"
    : fileName
      ? // Strip quotes/control chars so the filename can't break out of the header.
        `attachment; filename="${fileName.replace(/["\r\n]/g, "")}"`
      : undefined

  const command = new GetObjectCommand({
    Bucket: BUCKET,
    Key: key,
    ...(contentType ? { ResponseContentType: contentType } : {}),
    ...(disposition ? { ResponseContentDisposition: disposition } : {}),
  })
  return getSignedUrl(s3, command, { expiresIn })
}

// Read a private object's bytes + stored Content-Type directly (server-side).
// Used to inline doc images as data URIs for headless-Chromium PDF rendering,
// where a relative, session-authed <img src> can't be fetched from about:blank.
export async function getObjectBytes(
  key: string,
): Promise<{ body: Buffer; contentType?: string }> {
  if (!isS3Configured()) {
    throw new Error("AWS S3 is not configured")
  }
  const res = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }))
  const bytes = await res.Body!.transformToByteArray()
  return { body: Buffer.from(bytes), contentType: res.ContentType ?? undefined }
}
