import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server");
vi.mock("~/forms/lib/form-access.server", () => ({ fillAccessByPage: vi.fn() }));
vi.mock("~/lib/s3", () => ({
  getUploadPost: vi.fn(),
  isS3Configured: vi.fn(),
}));

import { prisma } from "~/lib/db.server";
import { fillAccessByPage } from "~/forms/lib/form-access.server";
import { getUploadPost, isS3Configured } from "~/lib/s3";
import { presignFormUpload } from "~/forms/lib/form-upload.server";
import { FORM_UPLOAD_CAP } from "~/lib/file-validation";

const db = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;
const access = fillAccessByPage as ReturnType<typeof vi.fn>;
const uploadPost = getUploadPost as ReturnType<typeof vi.fn>;
const s3Configured = isS3Configured as ReturnType<typeof vi.fn>;

const KEY = "applications/shots/0b6f8a52-1c1e-4d38-9a51-2f3c6d7e8f90-a.png";

function form(over: Record<string, unknown> = {}) {
  return {
    id: "f1",
    published: true,
    versions: [
      {
        questions: [
          { key: "name", type: "text", required: true, data: { label: "Name" } },
          { key: "shots", type: "file", required: true, data: { label: "Shots", accept: "image/*" } },
        ],
      },
      { questions: [{ key: "old", type: "file", required: false, data: { label: "Old" } }] },
    ],
    ...over,
  };
}

const presign = (over: Partial<Parameters<typeof presignFormUpload>[0]> = {}) =>
  presignFormUpload({
    token: "tok",
    userId: null,
    key: KEY,
    contentType: "image/png",
    contentLength: 1024,
    ...over,
  });

beforeEach(() => {
  vi.clearAllMocks();
  db.form.findUnique.mockResolvedValue(form());
  access.mockResolvedValue("ok");
  s3Configured.mockReturnValue(true);
  uploadPost.mockResolvedValue({ url: "https://bucket/", fields: { a: "b" } });
});

describe("presignFormUpload", () => {
  it("presigns an anonymous upload on a form open to anyone with the link", async () => {
    expect(await presign()).toEqual({
      url: "https://bucket/",
      fields: { a: "b" },
      key: `uploads/${KEY}`,
    });
    expect(db.form.findUnique.mock.calls[0][0].where).toEqual({ publicToken: "tok" });
    expect(access).toHaveBeenCalledWith("f1", null, undefined);
    expect(uploadPost).toHaveBeenCalledWith(`uploads/${KEY}`, "image/png", {
      maxBytes: FORM_UPLOAD_CAP.maxBytes,
      expiresIn: FORM_UPLOAD_CAP.expiresIn,
    });
  });

  it("presigns for a signed-in filler without re-checking link access", async () => {
    expect(await presign({ userId: "u1" })).toMatchObject({ key: `uploads/${KEY}` });
    expect(access).not.toHaveBeenCalled();
  });

  it("asks an anonymous visitor to sign in when the form needs it", async () => {
    access.mockResolvedValue("login");
    expect(await presign()).toEqual({ error: "Sign in to upload files to this form.", status: 401 });
    access.mockResolvedValue("denied");
    expect(await presign()).toMatchObject({ status: 401 });
    expect(uploadPost).not.toHaveBeenCalled();
  });

  it("404s for an unknown or unpublished form", async () => {
    db.form.findUnique.mockResolvedValue(null);
    expect(await presign()).toMatchObject({ status: 404 });
    db.form.findUnique.mockResolvedValue(form({ published: false }));
    expect(await presign()).toMatchObject({ status: 404 });
  });

  it("only signs keys under one of the form's file questions", async () => {
    for (const key of [
      "applications/name/abc-a.png",
      "applications/missing/abc-a.png",
      "avatars/abc-a.png",
      "applications/shots/../../resumes/a.pdf",
    ]) {
      expect(await presign({ key })).toEqual({ error: "This question doesn't take files.", status: 400 });
    }
    expect(uploadPost).not.toHaveBeenCalled();
  });

  it("takes a file question from an older version", async () => {
    const key = "applications/old/abc-notes.pdf";
    expect(await presign({ key, contentType: "application/pdf" })).toMatchObject({ key: `uploads/${key}` });
  });

  it("enforces the question's accepted types, not the client's", async () => {
    expect(
      await presign({ key: "applications/shots/abc-a.pdf", contentType: "application/pdf" }),
    ).toEqual({ error: "File type not allowed. Accepted: image/*", status: 400 });
  });

  it("refuses blocked file types", async () => {
    const key = "applications/old/abc-run.exe";
    expect(await presign({ key, contentType: "application/x-msdownload" })).toEqual({
      error: "File type not allowed",
      status: 400,
    });
  });

  it("refuses a file over the form upload cap", async () => {
    expect(await presign({ contentLength: FORM_UPLOAD_CAP.maxBytes + 1 })).toMatchObject({ status: 413 });
  });

  it("says so when storage isn't configured", async () => {
    s3Configured.mockReturnValue(false);
    expect(await presign()).toMatchObject({ status: 503 });
  });
});
