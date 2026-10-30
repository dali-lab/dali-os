import { describe, expect, it, vi } from "vitest";
import { withUploadErrorToast } from "../upload";

const file = new File(["x"], "photo.png", { type: "image/png" });

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
