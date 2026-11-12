// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { useState } from "react";
import { createPortal } from "react-dom";
import { renderDom, click, getButton, typeInto } from "./render";

function Counter({ label }: { label: string }) {
  const [n, setN] = useState(0);
  return (
    <div>
      <button onClick={() => setN(n + 1)}>{label}</button>
      <span data-testid="n">{n}</span>
    </div>
  );
}

function Controlled() {
  const [v, setV] = useState("");
  return (
    <div>
      <input value={v} onChange={(e) => setV(e.target.value)} />
      <p>{v}</p>
    </div>
  );
}

function Portaled() {
  return createPortal(<div id="portaled">hi</div>, document.body);
}

describe("renderDom", () => {
  it("mounts into the document and drives state through click", () => {
    const { container } = renderDom(<Counter label="Add" />);
    expect(container.isConnected).toBe(true);
    click(getButton(container, "Add"));
    expect(container.querySelector("[data-testid=n]")?.textContent).toBe("1");
  });

  it("rerenders with new props and keeps state", () => {
    const view = renderDom(<Counter label="Add" />);
    click(getButton(view.container, "Add"));
    view.rerender(<Counter label="Plus" />);
    expect(getButton(view.container, "Plus")).toBeTruthy();
    expect(view.container.querySelector("[data-testid=n]")?.textContent).toBe("1");
  });

  it("throws when a button label is missing", () => {
    const { container } = renderDom(<Counter label="Add" />);
    expect(() => getButton(container, "Nope")).toThrow('button "Nope" not found');
  });

  it("types into a controlled input", () => {
    const { container } = renderDom(<Controlled />);
    typeInto(container.querySelector("input")!, "Ada");
    expect(container.querySelector("p")?.textContent).toBe("Ada");
  });

  it("unmount removes the container and is safe to call twice", () => {
    const view = renderDom(<Counter label="Add" />);
    view.unmount();
    expect(view.container.isConnected).toBe(false);
    expect(() => view.unmount()).not.toThrow();
  });
});

describe("renderDom cleanup", () => {
  it("leaves a portal behind in the first test", () => {
    renderDom(<Portaled />);
    expect(document.getElementById("portaled")).not.toBeNull();
  });

  it("starts the next test with an empty body", () => {
    expect(document.body.children.length).toBe(0);
    expect(document.getElementById("portaled")).toBeNull();
  });
});
