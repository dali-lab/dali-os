// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { renderDom, click } from "~/test-utils/render";
import { HubCoverStudio, normalizeCover } from "../HubCoverStudio";
import { parseCover } from "~/components/cover/CoverPattern";

const LEGACY = "pattern:petal-ledger?d=frame,seal&c=plum";

function setup(over: Partial<React.ComponentProps<typeof HubCoverStudio>> = {}) {
  const onSubmit = vi.fn();
  renderDom(
    <HubCoverStudio busy={false} heading="Edit" submitLabel="Save" initialTitle="Design" initialCover={null} onClose={vi.fn()} onSubmit={onSubmit} {...over} />,
  );
  const save = () => [...document.body.querySelectorAll("button")].find((b) => b.textContent === "Save") as HTMLButtonElement;
  return { onSubmit, save };
}

describe("legacy stored covers", () => {
  it("reads a stored value with a decor query as its pattern and card color", () => {
    expect(parseCover(LEGACY)).toEqual({ id: "petal-ledger", card: "plum" });
    expect(parseCover("pattern:orbit-field?d=underline")).toEqual({ id: "orbit-field", card: "ink" });
  });

  it("drops the decor query when a cover is normalized", () => {
    expect(normalizeCover(LEGACY)).toBe("pattern:petal-ledger?c=plum");
    expect(normalizeCover("pattern:orbit-field?d=underline")).toBe("pattern:orbit-field");
    expect(normalizeCover("/api/upload/raw?key=uploads%2Fa.webp")).toBe("/api/upload/raw?key=uploads%2Fa.webp");
    expect(normalizeCover("")).toBe("");
  });

  it("saves an unchanged legacy cover without its decor and keeps the edited title", () => {
    const { onSubmit, save } = setup({ initialCover: LEGACY });
    const title = document.body.querySelector("input") as HTMLInputElement;
    expect(title.value).toBe("Design");
    click(save());
    expect(onSubmit).toHaveBeenCalledWith("Design", "pattern:petal-ledger?c=plum", undefined);
  });

  it("renders the legacy cover's preview", () => {
    setup({ initialCover: LEGACY });
    expect(document.body.textContent).toContain("Design");
    expect(document.body.querySelector("svg")).not.toBeNull();
  });
});
