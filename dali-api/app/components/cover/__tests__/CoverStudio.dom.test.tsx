// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { act } from "react";
import { renderDom, click } from "~/test-utils/render";
import { CoverStudio } from "../CoverStudio";

function setup(over: Partial<React.ComponentProps<typeof CoverStudio>> = {}) {
  const onSubmit = vi.fn();
  renderDom(
    <CoverStudio busy={false} heading="Cover" submitLabel="Save" initialCover={null} onClose={vi.fn()} onSubmit={onSubmit} {...over} />,
  );
  const q = (label: string) =>
    Array.from(document.body.querySelectorAll("button")).find((b) => b.textContent?.trim().startsWith(label) || b.getAttribute("aria-label") === label) as HTMLButtonElement;
  return { onSubmit, q };
}

describe("CoverStudio", () => {
  it("starts on the first pattern and saves it", () => {
    const { onSubmit, q } = setup();
    click(q("Save"));
    expect(onSubmit).toHaveBeenCalledWith("pattern:quiet-grid");
  });

  it("saves the picked style and card color", () => {
    const { onSubmit, q } = setup();
    click(q("Poster"));
    click(q("Plum"));
    click(q("Save"));
    expect(onSubmit).toHaveBeenCalledWith("pattern:poster?c=plum");
  });

  it("keeps the card color when the style changes", () => {
    const { onSubmit, q } = setup({ initialCover: "pattern:poster?c=wine" });
    click(q("Orbit field"));
    click(q("Save"));
    expect(onSubmit).toHaveBeenCalledWith("pattern:orbit-field?c=wine");
  });

  it("removes the cover", () => {
    const { onSubmit, q } = setup({ initialCover: "pattern:poster" });
    click(q("Remove cover"));
    click(q("Save"));
    expect(onSubmit).toHaveBeenCalledWith("");
  });

  it("disables card colors for an uploaded image", () => {
    const { q } = setup({ initialCover: "uploads/a.webp" });
    expect(q("Plum").disabled).toBe(true);
  });

  it("stores the key an upload returns", async () => {
    const uploadImage = vi.fn().mockResolvedValue("uploads/new.webp");
    const { onSubmit, q } = setup({ uploadImage });
    const input = document.body.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(["x"], "a.png", { type: "image/png" });
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    await act(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    click(q("Save"));
    expect(uploadImage).toHaveBeenCalledWith(file);
    expect(onSubmit).toHaveBeenCalledWith("uploads/new.webp");
  });

  it("shows an error and keeps the cover when the upload fails", async () => {
    const uploadImage = vi.fn().mockRejectedValue(new Error("no"));
    const { onSubmit, q } = setup({ uploadImage });
    const input = document.body.querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(input, "files", { value: [new File(["x"], "a.png")], configurable: true });
    await act(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(document.body.textContent).toContain("Upload failed.");
    click(q("Save"));
    expect(onSubmit).toHaveBeenCalledWith("pattern:quiet-grid");
  });

  it("does not submit while busy and shows a server error", () => {
    const { onSubmit, q } = setup({ busy: true, serverError: "Nope." });
    click(q("Save"));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("Nope.");
  });
});
