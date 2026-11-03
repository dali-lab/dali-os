import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { scaledGalleryCopy } from "~/community/lib/gallery";
import { MAX_UPLOAD_BYTES } from "~/lib/file-validation";
import { uploadFileToS3 } from "~/lib/upload-client";
import { uploadEditorImage, withUploadErrorToast } from "../upload";

vi.mock("~/lib/upload-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/upload-client")>()),
  uploadFileToS3: vi.fn(),
}));
vi.mock("~/community/lib/gallery", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/community/lib/gallery")>()),
  scaledGalleryCopy: vi.fn(),
}));

const file = new File(["x"], "photo.png", { type: "image/png" });

function fileOfSize(size: number, name: string, type: string) {
  const f = new File(["x"], name, { type });
  Object.defineProperty(f, "size", { value: size });
  return f;
}

describe("uploadEditorImage", () => {
  const OVER_CAP = MAX_UPLOAD_BYTES + 1;
  const close = vi.fn();
  const decode = vi.fn();
  const notify = vi.fn();

  function uploaded() {
    return vi.mocked(uploadFileToS3).mock.calls[0][0];
  }

  beforeEach(() => {
    vi.clearAllMocks();
    decode.mockResolvedValue({ width: 4096, height: 2048, close });
    vi.stubGlobal("createImageBitmap", decode);
    vi.mocked(uploadFileToS3).mockResolvedValue({
      s3Key: "uploads/doc-images/a b",
      fileName: "x",
      contentType: "image/webp",
      sizeBytes: 1,
    });
    vi.mocked(scaledGalleryCopy).mockResolvedValue(
      fileOfSize(2 * 1024 * 1024, "display.webp", "image/webp"),
    );
  });

  afterEach(() => vi.unstubAllGlobals());

  it("uploads an image at the cap untouched, without a notice", async () => {
    const atCap = fileOfSize(MAX_UPLOAD_BYTES, "photo.png", "image/png");

    await expect(uploadEditorImage(atCap, notify)).resolves.toBe(
      "/api/upload/raw?key=uploads%2Fdoc-images%2Fa%20b",
    );

    expect(uploaded()).toBe(atCap);
    expect(decode).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it("uploads a smaller copy of an over-cap image and says what happened", async () => {
    await uploadEditorImage(fileOfSize(24 * 1024 * 1024, "paste.final.png", "image/png"), notify);

    expect(scaledGalleryCopy).toHaveBeenCalledWith(expect.anything(), 2048, 1024, "display");
    expect(uploaded().name).toBe("paste.final.webp");
    expect(uploaded().type).toBe("image/webp");
    expect(notify).toHaveBeenCalledExactlyOnceWith(
      "Image shrunk from 24 MB to 2.0 MB to fit the 10 MB limit.",
    );
    expect(close).toHaveBeenCalledOnce();
  });

  it("re-encodes at full size when the image is heavy but not long", async () => {
    decode.mockResolvedValue({ width: 1600, height: 900, close });

    await uploadEditorImage(fileOfSize(OVER_CAP, "scan.png", "image/png"), notify);

    expect(scaledGalleryCopy).toHaveBeenCalledWith(expect.anything(), 1600, 900, "display");
  });

  it("works without a notify callback", async () => {
    await uploadEditorImage(fileOfSize(OVER_CAP, "photo.png", "image/png"));

    expect(uploaded().type).toBe("image/webp");
  });

  it.each([
    ["an animated GIF", "loop.gif", "image/gif"],
    ["an SVG", "logo.svg", "image/svg+xml"],
    ["a video", "clip.mp4", "video/mp4"],
    ["an attachment", "data.zip", "application/zip"],
  ])("leaves %s alone so the upload reports the cap", async (_label, name, type) => {
    const big = fileOfSize(OVER_CAP, name, type);

    await uploadEditorImage(big, notify);

    expect(uploaded()).toBe(big);
    expect(decode).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it("keeps the original when the browser can't decode it", async () => {
    decode.mockRejectedValue(new DOMException("bad image", "InvalidStateError"));
    const heic = fileOfSize(OVER_CAP, "photo.heic", "image/heic");

    await uploadEditorImage(heic, notify);

    expect(uploaded()).toBe(heic);
    expect(notify).not.toHaveBeenCalled();
  });

  it.each([
    ["encoding fails", null],
    ["the copy is still over the cap", fileOfSize(OVER_CAP, "display.webp", "image/webp")],
  ])("keeps the original when %s", async (_label, copy) => {
    vi.mocked(scaledGalleryCopy).mockResolvedValue(copy);
    const big = fileOfSize(OVER_CAP, "photo.png", "image/png");

    await uploadEditorImage(big, notify);

    expect(uploaded()).toBe(big);
    expect(notify).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledOnce();
  });
});

describe("withUploadErrorToast", () => {
  it("returns the uploaded src without showing an error", async () => {
    const showError = vi.fn();
    const upload = withUploadErrorToast(async () => "/api/upload/raw?key=a", showError);

    await expect(upload(file)).resolves.toBe("/api/upload/raw?key=a");
    expect(showError).not.toHaveBeenCalled();
  });

  it("shows the upload error message and rethrows it", async () => {
    const showError = vi.fn();
    const err = new Error("File too large (max 10 MB)");
    const upload = withUploadErrorToast(async () => {
      throw err;
    }, showError);

    await expect(upload(file)).rejects.toBe(err);
    expect(showError).toHaveBeenCalledExactlyOnceWith("File too large (max 10 MB)");
  });

  it("falls back to a generic message for non-Error or empty rejections", async () => {
    const showError = vi.fn();
    const upload = withUploadErrorToast(() => Promise.reject("boom"), showError);
    await expect(upload(file)).rejects.toBe("boom");

    const empty = withUploadErrorToast(() => Promise.reject(new Error("")), showError);
    await expect(empty(file)).rejects.toThrow();

    expect(showError.mock.calls).toEqual([["Upload failed"], ["Upload failed"]]);
  });
});
