// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";

const prompt = vi.fn();
const navigate = vi.fn();
vi.mock("react-router", async (orig) => ({
  ...(await orig<typeof import("react-router")>()),
  useNavigate: () => navigate,
}));
vi.mock("~/components/ui/dialog", () => ({ useDialog: () => ({ prompt }) }));

import { act } from "react";
import { renderDom } from "~/test-utils/render";
import { DeleteProjectSection } from "./ProjectSettings";

const fetchMock = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", fetchMock);
});

async function clickDelete(container: HTMLElement) {
  const btn = Array.from(container.querySelectorAll("button")).find((b) => /delete/i.test(b.textContent ?? ""))!;
  await act(async () => btn.click());
}

describe("DeleteProjectSection", () => {
  it("only accepts the exact project name in the confirm prompt", async () => {
    prompt.mockResolvedValue(null);
    const { container } = renderDom(<DeleteProjectSection projectId="p1" projectName="Atlas" />);
    await clickDelete(container);
    const { validate } = prompt.mock.calls[0][0];
    expect(validate("Atlas ")).toBeNull();
    expect(validate("Atl")).toBe("That doesn't match the project name.");
  });

  it("does not delete when the prompt is dismissed", async () => {
    prompt.mockResolvedValue(null);
    const { container } = renderDom(<DeleteProjectSection projectId="p1" projectName="Atlas" />);
    await clickDelete(container);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("deletes and returns to the project list once confirmed", async () => {
    prompt.mockResolvedValue("Atlas");
    fetchMock.mockResolvedValue({ ok: true });
    const { container } = renderDom(<DeleteProjectSection projectId="p1" projectName="Atlas" />);
    await clickDelete(container);
    expect(fetchMock).toHaveBeenCalledWith("/api/projects/p1", { method: "DELETE" });
    expect(navigate).toHaveBeenCalledWith("/projects");
  });
});
