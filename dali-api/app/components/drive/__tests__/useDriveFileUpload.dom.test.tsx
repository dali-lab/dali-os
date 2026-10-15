// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { renderHook } from "./render-hook";

const toast = Object.assign(vi.fn(), { info: vi.fn(), success: vi.fn(), error: vi.fn() });
vi.mock("~/components/ui/toast", () => ({ useToast: () => toast }));

import { FOLDERS_UNSUPPORTED, useDriveFileUpload, type UploadTarget } from "../useDriveFileUpload";
import { MAX_CONCURRENT_UPLOADS } from "~/lib/upload-batch";

const file = (name: string) => new File(["x"], name, { type: "text/plain" });
const names = (n: number) => Array.from({ length: n }, (_, i) => `f${i + 1}.txt`);
const jsonRes = (body: unknown, ok = true) => ({ ok, json: async () => body }) as Response;

type Mock = {
  inFlight: number;
  peak: number;
  registered: Record<string, unknown>[];
  failOn: (name: string) => boolean;
};
let mock: Mock;

function installFetch() {
  mock = { inFlight: 0, peak: 0, registered: [], failOn: () => false };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/upload/presign") {
        const { key } = JSON.parse(init!.body as string) as { key: string };
        mock.inFlight += 1;
        mock.peak = Math.max(mock.peak, mock.inFlight);
        await new Promise((r) => setTimeout(r, 2));
        if (mock.failOn(key)) {
          mock.inFlight -= 1;
          return jsonRes({ error: "Too big" }, false);
        }
        return jsonRes({ url: "https://s3.test", fields: { a: "b" }, key });
      }
      if (url === "https://s3.test") {
        await new Promise((r) => setTimeout(r, 2));
        return { ok: true } as Response;
      }
      const body = JSON.parse(init!.body as string) as Record<string, unknown>;
      mock.registered.push(body);
      mock.inFlight -= 1;
      return jsonRes({});
    }),
  );
}

const lab: UploadTarget = { scope: { kind: "Lab" }, folderPageId: "current" };

function mountHook(target: UploadTarget = lab) {
  const onComplete = vi.fn();
  const h = renderHook((t: UploadTarget) => useDriveFileUpload(t, onComplete), { initialProps: target });
  return { ...h, onComplete };
}

const upload = (h: ReturnType<typeof mountHook>, files: File[], opts?: Parameters<ReturnType<typeof mountHook>["result"]["current"]["uploadFiles"]>[1]) =>
  act(async () => {
    await h.result.current.uploadFiles(files, opts);
  });

beforeEach(() => {
  vi.clearAllMocks();
  installFetch();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useDriveFileUpload destination", () => {
  it("names where the files landed and offers Open", async () => {
    const onOpen = vi.fn();
    const onComplete = vi.fn();
    const h = renderHook((t: UploadTarget) => useDriveFileUpload(t, onComplete, { label: "Projects ▸ DALI OS ▸ Assets", onOpen }), {
      initialProps: lab,
    });
    await act(async () => {
      await h.result.current.uploadFiles([file("a.txt")]);
    });
    const [message, opts] = toast.success.mock.calls[0];
    expect(message).toBe("Uploaded 1 file to Projects ▸ DALI OS ▸ Assets");
    expect(opts.actions).toEqual([{ label: "Open", onClick: onOpen }]);
    h.unmount();
  });

  it("lets a call name its own destination, such as a folder it was dropped on", async () => {
    const mine = vi.fn();
    const dropped = vi.fn();
    const h = renderHook((t: UploadTarget) => useDriveFileUpload(t, vi.fn(), { label: "Lab-wide", onOpen: mine }), {
      initialProps: lab,
    });
    await act(async () => {
      await h.result.current.uploadFiles([file("a.txt"), file("b.txt")], {
        destination: { label: "Lab-wide ▸ Plans", onOpen: dropped },
      });
    });
    expect(toast.success.mock.calls[0][0]).toBe("Uploaded 2 files to Lab-wide ▸ Plans");
    toast.success.mock.calls[0][1].actions[0].onClick();
    expect(dropped).toHaveBeenCalled();
    expect(mine).not.toHaveBeenCalled();
    h.unmount();
  });

  it("keeps the plain toast, with no action, when no destination is known", async () => {
    const h = mountHook();
    await upload(h, [file("a.txt")]);
    expect(toast.success.mock.calls[0][1].actions).toBeUndefined();
    h.unmount();
  });

  it("does not claim a destination when the upload failed", async () => {
    mock.failOn = () => true;
    const h = renderHook((t: UploadTarget) => useDriveFileUpload(t, vi.fn(), { label: "Lab-wide", onOpen: vi.fn() }), {
      initialProps: lab,
    });
    await act(async () => {
      await h.result.current.uploadFiles([file("a.txt")]);
    });
    expect(toast.success).not.toHaveBeenCalled();
    expect(JSON.stringify(toast.error.mock.calls.at(-1))).not.toContain("Lab-wide");
    h.unmount();
  });
});

describe("useDriveFileUpload batches", () => {
  it("never has more than the concurrency limit in flight and registers every file", async () => {
    const h = mountHook();
    await upload(h, names(8).map(file));
    expect(MAX_CONCURRENT_UPLOADS).toBe(3);
    expect(mock.peak).toBe(3);
    expect(mock.registered.map((r) => r.fileName).sort()).toEqual(names(8).sort());
    h.unmount();
  });

  it("starts fewer workers than the limit for a small batch", async () => {
    const h = mountHook();
    await upload(h, names(2).map(file));
    expect(mock.peak).toBe(2);
    h.unmount();
  });

  it("keeps uploading after a file fails and reports each failure", async () => {
    mock.failOn = (key) => key.endsWith("f2.txt") || key.endsWith("f4.txt");
    const h = mountHook();
    await upload(h, names(5).map(file));
    expect(mock.registered.map((r) => r.fileName).sort()).toEqual(["f1.txt", "f3.txt", "f5.txt"]);
    expect(h.result.current.progress).toEqual({
      done: 5,
      total: 5,
      failed: [
        { name: "f2.txt", error: "Too big" },
        { name: "f4.txt", error: "Too big" },
      ],
    });
    expect(h.result.current.uploadError).toBe("2 of 5 files failed: f2.txt, f4.txt");
    h.unmount();
  });

  it("calls onComplete exactly once, even with failures, when something registered", async () => {
    mock.failOn = (key) => key.endsWith("f2.txt");
    const h = mountHook();
    await upload(h, names(3).map(file));
    expect(h.onComplete).toHaveBeenCalledTimes(1);
    h.unmount();
  });

  it("does not call onComplete when every file failed", async () => {
    mock.failOn = () => true;
    const h = mountHook();
    await upload(h, names(2).map(file));
    expect(h.onComplete).not.toHaveBeenCalled();
    h.unmount();
  });

  it("uses the single file's own error as uploadError for a one-file batch", async () => {
    mock.failOn = () => true;
    const h = mountHook();
    await upload(h, [file("a.txt")]);
    expect(h.result.current.uploadError).toBe("Too big");
    h.unmount();
  });

  it("clears uploadError after a clean batch and flips uploading around the run", async () => {
    mock.failOn = () => true;
    const h = mountHook();
    await upload(h, [file("a.txt")]);
    expect(h.result.current.uploadError).not.toBeNull();
    mock.failOn = () => false;
    let pending!: Promise<void>;
    act(() => {
      pending = h.result.current.uploadFiles([file("b.txt")]);
    });
    expect(h.result.current.uploading).toBe(true);
    await act(async () => {
      await pending;
    });
    expect(h.result.current.uploading).toBe(false);
    expect(h.result.current.uploadError).toBeNull();
    h.unmount();
  });

  it("does nothing for an empty batch", async () => {
    const h = mountHook();
    await upload(h, []);
    expect(fetch).not.toHaveBeenCalled();
    expect(toast.info).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
    h.unmount();
  });
});

describe("useDriveFileUpload destination", () => {
  it("registers into the hook's target folder by default", async () => {
    const h = mountHook();
    await upload(h, [file("a.txt")]);
    expect(mock.registered[0]).toMatchObject({ scope: { kind: "Lab" }, folderPageId: "current" });
    h.unmount();
  });

  it("registers into the overriding folder for that call only", async () => {
    const h = mountHook();
    await upload(h, [file("a.txt")], { folderPageId: "dropped-on" });
    await upload(h, [file("b.txt")]);
    expect(mock.registered[0]).toMatchObject({ folderPageId: "dropped-on" });
    expect(mock.registered[1]).toMatchObject({ folderPageId: "current" });
    h.unmount();
  });

  it("can override the scope along with the folder", async () => {
    const h = mountHook();
    await upload(h, [file("a.txt")], { scope: { kind: "Project", projectId: "p1" }, folderPageId: null });
    expect(mock.registered[0]).toMatchObject({ scope: { kind: "Project", projectId: "p1" } });
    expect(mock.registered[0]).not.toHaveProperty("folderPageId");
    h.unmount();
  });

  it("uses the latest target when it changes between renders", async () => {
    const h = mountHook();
    h.rerender({ scope: { kind: "Member" }, folderPageId: "other" });
    await upload(h, [file("a.txt")]);
    expect(mock.registered[0]).toMatchObject({ scope: { kind: "Member" }, folderPageId: "other" });
    h.unmount();
  });
});

describe("useDriveFileUpload toasts", () => {
  it("shows one progress toast that updates in place, then a success toast with the same id", async () => {
    const h = mountHook();
    await upload(h, names(7).map(file));
    const progressCalls = toast.info.mock.calls;
    expect(progressCalls.map((c) => c[0])).toEqual(
      Array.from({ length: 8 }, (_, i) => `Uploading ${i} of 7…`),
    );
    const ids = new Set(progressCalls.map((c) => c[1].id));
    expect(ids.size).toBe(1);
    expect(progressCalls.every((c) => c[1].duration === 0)).toBe(true);
    expect(toast.success).toHaveBeenCalledTimes(1);
    expect(toast.success).toHaveBeenCalledWith("Uploaded 7 files", { id: [...ids][0] });
    expect(toast.error).not.toHaveBeenCalled();
    h.unmount();
  });

  it("says 1 file, not 1 files", async () => {
    const h = mountHook();
    await upload(h, [file("a.txt")]);
    expect(toast.success.mock.calls[0][0]).toBe("Uploaded 1 file");
    h.unmount();
  });

  it("reports partial failure as an error toast naming the failed files", async () => {
    mock.failOn = (key) => key.endsWith("f2.txt") || key.endsWith("f4.txt");
    const h = mountHook();
    await upload(h, names(7).map(file));
    expect(toast.success).not.toHaveBeenCalled();
    const [message, opts] = toast.error.mock.calls[0];
    expect(opts.id).toBe(toast.info.mock.calls[0][1].id);
    expect(JSON.stringify(message)).toContain("Uploaded 5 of 7 files · 2 failed");
    expect(JSON.stringify(message)).toContain("f2.txt, f4.txt");
    h.unmount();
  });

  it("truncates a long list of failed names", async () => {
    mock.failOn = () => true;
    const h = mountHook();
    await upload(h, names(6).map(file));
    expect(JSON.stringify(toast.error.mock.calls[0][0])).toContain("f1.txt, f2.txt, f3.txt and 3 more");
    expect(h.result.current.uploadError).toBe("6 of 6 files failed: f1.txt, f2.txt, f3.txt and 3 more");
    h.unmount();
  });

  it("explains a single failed file with its error", async () => {
    mock.failOn = () => true;
    const h = mountHook();
    await upload(h, [file("a.txt")]);
    const json = JSON.stringify(toast.error.mock.calls[0][0]);
    expect(json).toContain("Upload failed");
    expect(json).toContain("a.txt: Too big");
    h.unmount();
  });

  it("gives separate batches separate toasts", async () => {
    const h = mountHook();
    await upload(h, [file("a.txt")]);
    await upload(h, [file("b.txt")]);
    expect(toast.success.mock.calls[0][1].id).not.toBe(toast.success.mock.calls[1][1].id);
    h.unmount();
  });

  it("mentions skipped folders in the final toast", async () => {
    const h = mountHook();
    await upload(h, [file("a.txt")], { skippedFolders: 2 });
    expect(JSON.stringify(toast.success.mock.calls[0][0])).toContain(FOLDERS_UNSUPPORTED);
    h.unmount();
  });

  it("only warns when a drop held nothing but folders", async () => {
    const h = mountHook();
    await upload(h, [], { skippedFolders: 1 });
    expect(toast.error).toHaveBeenCalledWith(FOLDERS_UNSUPPORTED);
    expect(fetch).not.toHaveBeenCalled();
    h.unmount();
  });
});
