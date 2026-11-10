// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const uploadFileToS3 = vi.fn();
vi.mock("~/lib/upload-client", () => ({ uploadFileToS3: (...a: unknown[]) => uploadFileToS3(...a) }));
const toastError = vi.fn();
vi.mock("~/components/ui/toast", () => ({ useToast: () => ({ error: toastError, success: vi.fn() }) }));

type CropProps = {
  open: boolean;
  imageSrc: string | null;
  aspect: number;
  outputShortSide: number;
  fit: boolean;
  onCancel: () => void;
  onConfirm: (b: Blob) => void;
};
let cropProps: CropProps | null = null;
vi.mock("~/components/PhotoCropModal", () => ({
  PhotoCropModal: (p: CropProps) => {
    cropProps = p;
    return null;
  },
}));

const { MediaField } = await import("~/core/components/banners/MediaField");

let container: HTMLDivElement;
let root: Root;
const onChange = vi.fn();

beforeEach(() => {
  cropProps = null;
  uploadFileToS3.mockResolvedValue({ s3Key: "banners/x/poster.webp" });
  URL.createObjectURL = vi.fn(() => "blob:local");
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.clearAllMocks();
});

async function mount(cropAspect?: number) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () =>
    root.render(createElement(MediaField, { label: "Poster", accept: "image/*", value: null, onChange, cropAspect })),
  );
}

async function pick(file: File) {
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
}

const png = () => new File(["x"], "flyer.png", { type: "image/png" });

describe("MediaField crop", () => {
  it("opens the crop step at the frame's shape before uploading an image", async () => {
    await mount(3 / 4);
    await pick(png());
    expect(cropProps?.open).toBe(true);
    expect(cropProps?.imageSrc).toBe("blob:local");
    expect(cropProps?.aspect).toBe(3 / 4);
    expect(cropProps?.outputShortSide).toBe(1080);
    expect(cropProps?.fit).toBe(true);
    expect(uploadFileToS3).not.toHaveBeenCalled();
  });

  it("uploads the cropped image and sets the field to it", async () => {
    await mount(3 / 4);
    await pick(png());
    await act(async () => cropProps!.onConfirm(new Blob(["c"], { type: "image/webp" })));
    expect(uploadFileToS3).toHaveBeenCalledTimes(1);
    const [file, prefix, accept] = uploadFileToS3.mock.calls[0] as [File, string, string];
    expect(file.name).toBe("flyer.webp");
    expect(file.type).toBe("image/webp");
    expect(prefix).toMatch(/banner/);
    expect(accept).toBe("image/*");
    expect(onChange).toHaveBeenCalledWith(expect.stringContaining("banners%2Fx%2Fposter.webp"));
    expect(cropProps?.open).toBe(false);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:local");
  });

  it("uploads nothing when the crop is cancelled", async () => {
    await mount(16 / 9);
    await pick(png());
    await act(async () => cropProps!.onCancel());
    expect(cropProps?.open).toBe(false);
    expect(uploadFileToS3).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:local");
  });

  it("uploads a GIF as is so it keeps animating", async () => {
    await mount(16 / 9);
    const gif = new File(["g"], "party.gif", { type: "image/gif" });
    await pick(gif);
    expect(cropProps?.open).toBe(false);
    expect(uploadFileToS3).toHaveBeenCalledWith(gif, expect.any(String), "image/*");
  });

  it("uploads directly when the field has no crop shape", async () => {
    await mount();
    const file = png();
    await pick(file);
    expect(cropProps).toBeNull();
    expect(uploadFileToS3).toHaveBeenCalledWith(file, expect.any(String), "image/*");
  });

  it("shows the upload error and leaves the field empty", async () => {
    uploadFileToS3.mockRejectedValueOnce(new Error("File too large (max 10 MB)"));
    await mount(3 / 4);
    await pick(png());
    await act(async () => cropProps!.onConfirm(new Blob(["c"], { type: "image/png" })));
    expect(toastError).toHaveBeenCalledWith("File too large (max 10 MB)");
    expect(onChange).not.toHaveBeenCalled();
  });
});
