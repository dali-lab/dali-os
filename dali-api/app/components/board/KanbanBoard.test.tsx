import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { KanbanBoard, type KanbanColumn } from "./KanbanBoard";

type Card = { id: string; label: string };

function render(
  props: Partial<Parameters<typeof KanbanBoard<Card>>[0]> & {
    columns: KanbanColumn<Card>[];
  },
) {
  return renderToStaticMarkup(
    createElement(KanbanBoard<Card>, {
      id: "test-board",
      getCardId: (c) => c.id,
      getCardData: (c) => ({ cardId: c.id }),
      renderCard: (c, { dragHandleProps }) =>
        createElement(
          "div",
          { ...dragHandleProps, "data-card": c.id },
          c.label,
        ),
      draggable: true,
      onDragEnd: () => {},
      ...props,
    }),
  );
}

const cols = (): KanbanColumn<Card>[] => [
  { id: "todo", title: "To do", cards: [{ id: "a", label: "Alpha" }] },
  { id: "doing", title: "Doing", cards: [] },
];

describe("KanbanBoard render output", () => {
  it("renders one shell per column with its title", () => {
    const html = render({ columns: cols() });
    expect(html).toContain("To do");
    expect(html).toContain("Doing");
  });

  it("renders cards via renderCard", () => {
    const html = render({ columns: cols() });
    expect(html).toContain("Alpha");
    expect(html).toContain('data-card="a"');
  });

  it("shows the Empty placeholder for an empty column", () => {
    const html = render({ columns: cols() });
    expect(html).toContain("Empty");
  });

  it("honors a custom emptyLabel", () => {
    const html = render({ columns: cols(), emptyLabel: "Nothing here" });
    expect(html).toContain("Nothing here");
    expect(html).not.toContain(">Empty<");
  });

  it("renders the destructive error banner when error is set", () => {
    const html = render({ columns: cols(), error: "Boom" });
    expect(html).toContain("Boom");
    expect(html).toContain("border-destructive/30");
  });

  it("renders the default count badge from the card count", () => {
    const html = render({ columns: cols() });
    // The 'todo' column has one card.
    expect(html).toContain(">1<");
  });

  it("read-only board (draggable=false) emits no drag handle attributes", () => {
    const html = render({ columns: cols(), draggable: false });
    // dnd-kit decorates draggable nodes with aria-roledescription on the handle.
    expect(html).not.toContain("aria-roledescription");
  });

  it("draggable board wires dnd-kit drag attributes onto the card handle", () => {
    const html = render({ columns: cols(), draggable: true });
    expect(html).toContain("aria-roledescription");
  });

  it("applies a per-column className override to the shell", () => {
    const html = render({
      columns: [
        { id: "x", title: "X", cards: [], className: "delibs-shell-marker" },
      ],
    });
    expect(html).toContain("delibs-shell-marker");
  });

  it("renders renderOverlay output (no active card => null is fine)", () => {
    const html = render({
      columns: cols(),
      renderOverlay: () => createElement("div", { "data-overlay": "1" }, "ov"),
    });
    // The overlay container mounts; its child renders only mid-drag, so on a
    // static render we just assert the board still renders without throwing.
    expect(html).toContain("To do");
  });

  it("lays columns out in a grid when layout='grid'", () => {
    const html = render({ columns: cols(), layout: "grid" });
    expect(html).toContain("grid-template-columns");
  });
});
