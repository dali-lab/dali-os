// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useDriveDestinations } from "~/components/drive/use-drive-destinations";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const rows = {
  drives: [{ id: "lab", label: "Lab" }],
  folders: [{ id: "f1", driveId: "lab", parentId: null, title: "Ops" }],
};

const box: { current: ReturnType<typeof useDriveDestinations> | null } = { current: null };
let container: HTMLDivElement;
let root: Root;
const onError = vi.fn();

function Harness({ enabled, movingIds }: { enabled: boolean; movingIds?: string[] }) {
  box.current = useDriveDestinations({ enabled, onError, movingIds });
  return null;
}

async function render(enabled: boolean, movingIds?: string[]) {
  await act(async () => {
    root.render(createElement(Harness, { enabled, movingIds }));
  });
}

beforeEach(() => {
  onError.mockReset();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("useDriveDestinations", () => {
  it("names the pages being moved and refetches when they change", async () => {
    const fetchMock = vi.fn(async () => Response.json(rows));
    vi.stubGlobal("fetch", fetchMock);
    await render(true, ["a", "b"]);
    expect(fetchMock).toHaveBeenLastCalledWith("/api/drive/destinations?moving=a%2Cb", { credentials: "include" });
    await render(true, ["c"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenLastCalledWith("/api/drive/destinations?moving=c", { credentials: "include" });
  });

  it("fetches nothing until asked", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await render(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(box.current?.status).toBe("idle");
  });

  it("loads the endpoint once when enabled and keeps the rows", async () => {
    const fetchMock = vi.fn(async () => Response.json(rows));
    vi.stubGlobal("fetch", fetchMock);
    await render(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("/api/drive/destinations", { credentials: "include" });
    expect(box.current?.status).toBe("ready");
    expect(box.current?.rows).toEqual(rows);
    await render(false);
    await render(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(box.current?.rows).toEqual(rows);
  });

  it("reports a failed request through onError and retries on the next load", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response("no", { status: 500 }));
    fetchMock.mockResolvedValueOnce(Response.json(rows));
    vi.stubGlobal("fetch", fetchMock);
    await render(true);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(box.current?.status).toBe("error");
    let ok = false;
    await act(async () => {
      ok = (await box.current?.load()) ?? false;
    });
    expect(ok).toBe(true);
    expect(box.current?.status).toBe("ready");
  });
});
