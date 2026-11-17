// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { collectUrlQuestions, isUrlType, useApplyUrlChecks, type UrlQuestionSources } from "~/components/portal/apply/use-apply-url-checks";
import type { Question } from "~/types";
import { renderHook } from "~/components/drive/__tests__/render-hook";

const q = (key: string, type: Question["type"] = "text"): Question => ({ key, type, required: false, data: { label: key } }) as Question;

const sources = (over: Partial<UrlQuestionSources> = {}): UrlQuestionSources => ({
  formQuestions: [q("repo", "github_url"), q("design", "figma_url"), q("name")],
  answers: { repo: "https://github.com/ada/site", design: "  ", name: "Ada" },
  generalLocked: false,
  domains: [
    { id: "dev", name: "Dev", challenges: [{ challengeVersionId: "cv1", challengeName: "One", description: null, questions: [q("docs", "drive_url")] }] },
  ],
  selectedDomainIds: ["dev"],
  continuedFrom: {},
  continuedInterest: null,
  continuedAnswers: {},
  domainAnswers: { dev: { docs: "https://drive.google.com/x" } },
  pickedChallengeByDomain: { dev: "cv1" },
  ...over,
});

describe("collectUrlQuestions", () => {
  it("recognises only the three URL question types", () => {
    expect(["github_url", "figma_url", "drive_url"].every(isUrlType)).toBe(true);
    expect(["text", "email", "file"].some(isUrlType)).toBe(false);
  });

  it("collects non-empty URL answers from the general form and each picked challenge", () => {
    expect(collectUrlQuestions(sources())).toEqual([
      { key: "repo", url: "https://github.com/ada/site", type: "github_url" },
      { key: "docs", url: "https://drive.google.com/x", type: "drive_url" },
    ]);
  });

  it("skips frozen general answers from a waitlisted application", () => {
    expect(collectUrlQuestions(sources({ generalLocked: true })).map((u) => u.key)).toEqual(["docs"]);
  });

  it("reads a reused domain's continued interest form instead of its challenge", () => {
    const found = collectUrlQuestions(
      sources({
        continuedFrom: { dev: "Fall" },
        continuedInterest: { questions: [q("again", "github_url")] },
        continuedAnswers: { dev: { again: "https://github.com/ada/again" } },
      }),
    );
    expect(found.map((u) => u.key)).toEqual(["repo", "again"]);
  });

  it("ignores a domain the applicant has not picked a challenge for", () => {
    expect(collectUrlQuestions(sources({ pickedChallengeByDomain: {} })).map((u) => u.key)).toEqual(["repo"]);
  });
});

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
const mounted: Array<() => void> = [];
afterEach(() => {
  vi.unstubAllGlobals();
  mounted.splice(0).forEach((u) => u());
});
const reply = (body: unknown, ok = true, status = 200) => ({ ok, status, json: async () => body });
function mount(over: Partial<UrlQuestionSources> = {}) {
  const hook = renderHook(useApplyUrlChecks, { initialProps: sources(over) });
  mounted.push(hook.unmount);
  return hook;
}
const posted = (i: number) => JSON.parse(fetchMock.mock.calls[i][1].body);

describe("useApplyUrlChecks: on blur", () => {
  it("sends the URL and its question type to the checker and stores the result", async () => {
    const result = { status: "valid", url: "https://github.com/ada/site", message: "ok" };
    fetchMock.mockResolvedValue(reply(result));
    const { result: hook } = mount();
    await act(async () => hook.current.checkUrlField("repo", "https://github.com/ada/site", "github_url"));
    expect(fetchMock.mock.calls[0][0]).toBe("/api/check-url");
    expect(posted(0)).toEqual({ url: "https://github.com/ada/site", type: "github_url" });
    expect(hook.current.urlChecks.repo).toEqual({ status: "done", result });
  });

  it("routes each URL type to the checker with its own type", async () => {
    fetchMock.mockResolvedValue(reply({ status: "valid", url: "u", message: "" }));
    const { result: hook } = mount();
    for (const type of ["github_url", "figma_url", "drive_url"] as const) {
      await act(async () => hook.current.checkUrlField(type, `https://x/${type}`, type));
    }
    expect(fetchMock.mock.calls.map((_, i) => posted(i).type)).toEqual(["github_url", "figma_url", "drive_url"]);
  });

  it("goes idle without a request when the field is emptied", async () => {
    const { result: hook } = mount();
    await act(async () => hook.current.checkUrlField("repo", "   ", "github_url"));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(hook.current.urlChecks.repo).toEqual({ status: "idle" });
  });

  it("shows a checking state while the request is out", async () => {
    let resolve!: (v: unknown) => void;
    fetchMock.mockReturnValue(new Promise((r) => (resolve = r)));
    const { result: hook } = mount();
    let pending!: Promise<void>;
    act(() => {
      pending = hook.current.checkUrlField("repo", "https://github.com/a/b", "github_url");
    });
    expect(hook.current.urlChecks.repo).toEqual({ status: "checking" });
    await act(async () => {
      resolve(reply({ status: "valid", url: "https://github.com/a/b", message: "" }));
      await pending;
    });
    expect(hook.current.urlChecks.repo.status).toBe("done");
  });

  it("turns a rate limit, a server error and a network failure into an error result, not a throw", async () => {
    const { result: hook } = mount();
    fetchMock.mockResolvedValueOnce(reply({}, false, 429));
    await act(async () => hook.current.checkUrlField("a", "https://x/a", "github_url"));
    expect(hook.current.urlChecks.a.result).toMatchObject({ status: "error", message: expect.stringContaining("Too many checks") });
    fetchMock.mockResolvedValueOnce(reply({ error: "Bad host" }, false, 400));
    await act(async () => hook.current.checkUrlField("b", "https://x/b", "github_url"));
    expect(hook.current.urlChecks.b.result).toMatchObject({ status: "error", message: "Bad host" });
    fetchMock.mockResolvedValueOnce(reply({}, false, 500));
    await act(async () => hook.current.checkUrlField("c", "https://x/c", "github_url"));
    expect(hook.current.urlChecks.c.result?.message).toBe("Unexpected error (500)");
    fetchMock.mockRejectedValueOnce(new Error("offline"));
    await act(async () => hook.current.checkUrlField("d", "https://x/d", "github_url"));
    expect(hook.current.urlChecks.d.result).toEqual({ status: "error", url: "https://x/d", message: "Failed to check URL" });
  });
});

describe("useApplyUrlChecks: before review", () => {
  it("returns no warnings and sends nothing when there are no links", async () => {
    const { result: hook } = mount({ answers: {}, domainAnswers: {} });
    let warnings: Record<string, string> = { stale: "x" };
    await act(async () => {
      warnings = await hook.current.runUrlChecksForReview();
    });
    expect(warnings).toEqual({});
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("makes a warning, not an error, of every link that is not valid", async () => {
    fetchMock.mockImplementation(async (_url: string, init: { body: string }) => {
      const { url } = JSON.parse(init.body);
      return url.includes("github") ? reply({ status: "private", url, message: "Looks private" }) : reply({ status: "valid", url, message: "" });
    });
    const { result: hook } = mount();
    let warnings: Record<string, string> = {};
    await act(async () => {
      warnings = await hook.current.runUrlChecksForReview();
    });
    expect(warnings).toEqual({ repo: "Looks private" });
    expect(hook.current.urlChecks.docs.status).toBe("done");
  });

  it("reports an unreachable checker as a warning too", async () => {
    fetchMock.mockRejectedValue(new Error("offline"));
    const { result: hook } = mount();
    let warnings: Record<string, string> = {};
    await act(async () => {
      warnings = await hook.current.runUrlChecksForReview();
    });
    expect(warnings).toEqual({ repo: "Failed to check URL", docs: "Failed to check URL" });
  });

  it("reuses the on-blur result while the value is unchanged, and re-checks when it changed", async () => {
    fetchMock.mockResolvedValue(reply({ status: "valid", url: "https://github.com/ada/site", message: "" }));
    const { result: hook, rerender } = mount({ domainAnswers: {} });
    await act(async () => hook.current.checkUrlField("repo", "https://github.com/ada/site", "github_url"));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => void (await hook.current.runUrlChecksForReview()));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    rerender(sources({ domainAnswers: {}, answers: { repo: "https://github.com/ada/other" } }));
    await act(async () => void (await hook.current.runUrlChecksForReview()));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
