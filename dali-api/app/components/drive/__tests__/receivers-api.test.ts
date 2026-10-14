import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchReceiverSlots, pathText, sendReceiverRequest } from "~/components/drive/receivers-api";

afterEach(() => vi.unstubAllGlobals());

const reply = (status: number, body: unknown) =>
  vi.fn(
    async (_url: string, _init?: RequestInit) =>
      new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }),
  );

describe("fetchReceiverSlots", () => {
  it("asks for the process's slots", async () => {
    const fetchMock = reply(200, { slots: [{ folderType: "Meetings", label: "Meeting notebooks", folder: null }] });
    vi.stubGlobal("fetch", fetchMock);
    expect(await fetchReceiverSlots("Project", "p1")).toEqual([
      { folderType: "Meetings", label: "Meeting notebooks", folder: null },
    ]);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/folder-receivers?processType=Project&processId=p1");
  });

  it("is null when the viewer can't manage receivers or the request fails", async () => {
    vi.stubGlobal("fetch", reply(403, { error: "Forbidden" }));
    expect(await fetchReceiverSlots("Core", null)).toBeNull();
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("offline"))));
    expect(await fetchReceiverSlots("Core", null)).toBeNull();
  });
});

describe("sendReceiverRequest", () => {
  it("posts the body as JSON", async () => {
    const fetchMock = reply(200, { ok: true });
    vi.stubGlobal("fetch", fetchMock);
    const body = { intent: "set", processType: "Core", folderType: "Meetings", folderId: "f1" } as const;
    expect(await sendReceiverRequest(body)).toEqual({ ok: true });
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual(body);
  });

  it("surfaces the API's error text", async () => {
    vi.stubGlobal("fetch", reply(409, { error: "This folder already receives agreements. Clear that first." }));
    expect(await sendReceiverRequest({ intent: "clear", processType: "Core", folderType: "Agreements" })).toEqual({
      ok: false,
      error: "This folder already receives agreements. Clear that first.",
    });
  });

  it("falls back to a generic message when the response has no error text or the network fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 500 })));
    expect(await sendReceiverRequest({ intent: "clear", processType: "Core", folderType: "Meetings" })).toEqual({
      ok: false,
      error: "That didn't save. Try again.",
    });
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("offline"))));
    expect(await sendReceiverRequest({ intent: "clear", processType: "Core", folderType: "Meetings" })).toMatchObject({ ok: false });
  });
});

describe("pathText", () => {
  it("joins titles and names untitled folders", () => {
    expect(pathText([{ title: "Core" }, { title: "" }, { title: "Agreements" }])).toBe(
      "Core / Untitled folder / Agreements",
    );
  });
});
