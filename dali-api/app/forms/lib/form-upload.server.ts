import { prisma } from "~/lib/db.server";
import { getUploadPost, isS3Configured } from "~/lib/s3";
import {
  FORM_UPLOAD_CAP,
  fileMatchesAccept,
  isBlockedUpload,
  isFormUploadKeyFor,
} from "~/lib/file-validation";
import type { Question } from "~/types";
import { formFillAccess } from "./public-form";

type Failure = { error: string; status: number };

export type FormUploadPost = { url: string; fields: Record<string, string>; key: string };

// Presigns one file answer for a form, found by its fill token. Anyone who may
// fill the form may upload to its file questions, signed in or not.
export async function presignFormUpload(args: {
  token: string;
  userId: string | null;
  key: string;
  contentType: string;
  contentLength?: number;
  request?: Request;
}): Promise<FormUploadPost | Failure> {
  const form = await prisma.form.findUnique({
    where: { publicToken: args.token },
    select: { id: true, published: true, versions: { select: { questions: true } } },
  });
  if (!form || !form.published) return { error: "Form not found for this link.", status: 404 };

  if (!args.userId && (await formFillAccess(form, null, args.request)) !== "ok") {
    return { error: "Sign in to upload files to this form.", status: 401 };
  }

  const question = form.versions
    .flatMap((v) => (v.questions as unknown as Question[]) ?? [])
    .find((q) => q.type === "file" && isFormUploadKeyFor(args.key, q.key));
  if (!question) return { error: "This question doesn't take files.", status: 400 };

  const fileName = args.key.split("/").pop() ?? "";
  if (isBlockedUpload(fileName, args.contentType)) {
    return { error: "File type not allowed", status: 400 };
  }
  const accept = question.data.accept;
  if (accept && !fileMatchesAccept(fileName, args.contentType, accept)) {
    return { error: `File type not allowed. Accepted: ${accept}`, status: 400 };
  }
  if (args.contentLength !== undefined && args.contentLength > FORM_UPLOAD_CAP.maxBytes) {
    return { error: `File too large (max ${FORM_UPLOAD_CAP.label})`, status: 413 };
  }
  if (!isS3Configured()) {
    return { error: "File storage is not configured on this server.", status: 503 };
  }

  const key = args.key.startsWith("uploads/") ? args.key : `uploads/${args.key}`;
  const { url, fields } = await getUploadPost(key, args.contentType, {
    maxBytes: FORM_UPLOAD_CAP.maxBytes,
    expiresIn: FORM_UPLOAD_CAP.expiresIn,
  });
  return { url, fields, key };
}
