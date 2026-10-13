import { describe, it, expect, vi } from "vitest";
import {
  createNotebookRequest,
  detachRequest,
  notebookRequest,
  removeFromNotebookRequest,
  renameRequest,
  sendJson,
} from "~/components/notebooks/notebook-requests";

describe("request builders", () => {
  it("posts each notebook intent to the notebook's route", () => {
    expect(notebookRequest("nb1", { intent: "add-page", pageId: "p1" })).toEqual({
      url: "/api/notebooks/nb1",
      body: { intent: "add-page", pageId: "p1" },
    });
    expect(notebookRequest("nb1", { intent: "set-template", templatePageId: null }).body).toEqual({
      intent: "set-template",
      templatePageId: null,
    });
    expect(notebookRequest("nb1", { intent: "merge-into", targetId: "nb2" }).body).toEqual({
      intent: "merge-into",
      targetId: "nb2",
    });
    expect(notebookRequest("nb1", { intent: "dissolve" }).body).toEqual({ intent: "dissolve" });
    expect(notebookRequest("nb1", { intent: "trash" }).body).toEqual({ intent: "trash" });
  });

  it("detaches a note through the page's meeting route", () => {
    expect(detachRequest("p1")).toEqual({ url: "/api/pages/p1/meeting", body: { intent: "detach-meeting" } });
  });

  it("renames through the ordinary document route with a trimmed title", () => {
    expect(renameRequest("nb1", "  Weekly  ")).toEqual({ url: "/api/documents/nb1", body: { title: "Weekly" } });
  });

  it("removes a tab by moving it to the folder the notebook sits in", () => {
    expect(
      removeFromNotebookRequest("p1", { workspaceType: "Project", workspaceId: "proj1", folderId: "f1" }),
    ).toEqual({
      url: "/api/pages/p1/move",
      body: { workspaceType: "Project", workspaceId: "proj1", parentPageId: "f1" },
    });
  });

  it("moves a tab to the top of the workspace when the notebook sits there", () => {
    expect(removeFromNotebookRequest("p1", { workspaceType: "Lab", workspaceId: null, folderId: null }).body).toEqual({
      workspaceType: "Lab",
      workspaceId: null,
      parentPageId: null,
    });
  });

  it("creates a notebook with the document's title in its workspace and folder, with no template", () => {
    expect(
      createNotebookRequest({ title: " Plan ", workspaceType: "Lab", workspaceId: null, parentPageId: "f1" }),
    ).toEqual({
      url: "/api/notebooks",
      body: { title: "Plan", workspaceType: "Lab", workspaceId: null, parentPageId: "f1", templatePageId: null },
    });
  });
});

describe("sendJson", () => {
  const respond = (ok: boolean, json: unknown) => vi.fn(async () => ({ ok, json: async () => json }));

  it("posts the body as JSON with credentials and returns the parsed result", async () => {
    const doFetch = respond(true, { id: "nb9" });

    const res = await sendJson<{ id: string }>({ url: "/api/notebooks", body: { title: "A" } }, doFetch);

    expect(res).toEqual({ ok: true, data: { id: "nb9" } });
    expect(doFetch).toHaveBeenCalledWith("/api/notebooks", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "A" }),
    });
  });

  it("surfaces the server's message on a failure", async () => {
    expect(await sendJson({ url: "/x", body: {} }, respond(false, { error: "You can't edit this notebook" }))).toEqual({
      ok: false,
      error: "You can't edit this notebook",
    });
  });

  it("falls back to a generic message when the failure has none or the request throws", async () => {
    expect((await sendJson({ url: "/x", body: {} }, respond(false, {}))).error).toBe("Something went wrong");
    const throwing = vi.fn(async () => {
      throw new Error("offline");
    });
    expect(await sendJson({ url: "/x", body: {} }, throwing)).toEqual({ ok: false, error: "Something went wrong" });
  });
});
