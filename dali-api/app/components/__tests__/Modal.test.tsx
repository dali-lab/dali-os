import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Modal, ModalHeader, ModalFooter, nextTrapTarget } from "../Modal";

describe("nextTrapTarget (focus-trap cycling)", () => {
  function makeButtons(n: number): HTMLElement[] {
    return Array.from({ length: n }, () => {
      const el = { focus: () => {} } as unknown as HTMLElement;
      return el;
    });
  }

  it("returns null on an empty focusable list", () => {
    expect(nextTrapTarget([], null, false)).toBeNull();
    expect(nextTrapTarget([], null, true)).toBeNull();
  });

  it("wraps Tab from the last element back to the first", () => {
    const els = makeButtons(3);
    expect(nextTrapTarget(els, els[2], false)).toBe(els[0]);
  });

  it("wraps Shift+Tab from the first element to the last", () => {
    const els = makeButtons(3);
    expect(nextTrapTarget(els, els[0], true)).toBe(els[2]);
  });

  it("returns null in the middle so the browser's natural tab order is used", () => {
    const els = makeButtons(3);
    expect(nextTrapTarget(els, els[1], false)).toBeNull();
    expect(nextTrapTarget(els, els[1], true)).toBeNull();
  });

  it("treats focus outside the trap (current=null) as needing redirection at boundaries only", () => {
    const els = makeButtons(2);
    // current is not first or last → no wrap, browser handles
    expect(nextTrapTarget(els, null, false)).toBeNull();
    expect(nextTrapTarget(els, null, true)).toBeNull();
  });

  it("with a single focusable element, both Tab and Shift+Tab wrap to itself", () => {
    const els = makeButtons(1);
    expect(nextTrapTarget(els, els[0], false)).toBe(els[0]);
    expect(nextTrapTarget(els, els[0], true)).toBe(els[0]);
  });
});

describe("Modal render output", () => {
  it("renders nothing when closed", () => {
    const html = renderToStaticMarkup(
      createElement(Modal, {
        open: false,
        onClose: () => {},
        labelledBy: "t",
        children: createElement("h3", { id: "t" }, "Title"),
      }),
    );
    expect(html).toBe("");
  });

  it("renders dialog with role, aria-modal, and aria-labelledby when open", () => {
    const html = renderToStaticMarkup(
      createElement(Modal, {
        open: true,
        onClose: () => {},
        labelledBy: "my-title",
        children: [
          createElement("h3", { id: "my-title", key: "h" }, "Hello"),
          createElement("button", { key: "b" }, "OK"),
        ],
      }),
    );
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-labelledby="my-title"');
    expect(html).toContain('id="my-title"');
    expect(html).toContain("Hello");
    expect(html).toContain("OK");
  });
});

describe("ModalHeader", () => {
  it("renders an <h2> carrying the passed titleId and a close button with the default aria-label", () => {
    const html = renderToStaticMarkup(
      createElement(ModalHeader, {
        titleId: "my-title",
        title: "Settings",
        onClose: () => {},
      }),
    );
    expect(html).toContain('id="my-title"');
    expect(html).toContain("Settings");
    expect(html).toContain('aria-label="Close"');
  });

  it("renders the subtitle when provided", () => {
    const html = renderToStaticMarkup(
      createElement(ModalHeader, {
        titleId: "t",
        title: "Title",
        subtitle: "A helpful description",
        onClose: () => {},
      }),
    );
    expect(html).toContain("A helpful description");
  });

  it("uses a custom close label", () => {
    const html = renderToStaticMarkup(
      createElement(ModalHeader, {
        titleId: "t",
        title: "Title",
        onClose: () => {},
        closeLabel: "Close settings",
      }),
    );
    expect(html).toContain('aria-label="Close settings"');
  });

  it("omits the close button when hideClose is set", () => {
    const html = renderToStaticMarkup(
      createElement(ModalHeader, {
        titleId: "t",
        title: "Title",
        onClose: () => {},
        hideClose: true,
      }),
    );
    expect(html).not.toContain("aria-label");
    expect(html).not.toContain("<button");
  });
});

describe("ModalFooter", () => {
  it("renders a Cancel button and the primary child", () => {
    const html = renderToStaticMarkup(
      createElement(
        ModalFooter,
        { onCancel: () => {} },
        createElement("button", { key: "p" }, "Save"),
      ),
    );
    expect(html).toContain("Cancel");
    expect(html).toContain("Save");
  });

  it("uses a custom cancel label", () => {
    const html = renderToStaticMarkup(
      createElement(
        ModalFooter,
        { onCancel: () => {}, cancelLabel: "Go back" },
        createElement("button", { key: "p" }, "Confirm"),
      ),
    );
    expect(html).toContain("Go back");
    expect(html).not.toContain(">Cancel<");
  });
});
