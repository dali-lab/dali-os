import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { createPresignedPost, type PresignedPost } from '@aws-sdk/s3-presigned-post'
import { MAX_UPLOAD_BYTES } from './file-validation'

const REGION = process.env.AWS_REGION
const BUCKET = process.env.AWS_S3_BUCKET

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

// Generate a presigned URL for reading a private file.
export async function getDownloadUrl(key: string, expiresIn = 3600) {
  const command = new GetObjectCommand({ Bucket: BUCKET, Key: key })
  return getSignedUrl(s3, command, { expiresIn })
}
