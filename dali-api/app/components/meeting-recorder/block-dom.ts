export function findBlock(root: HTMLElement, id: string): HTMLElement | null {
  for (const el of root.querySelectorAll<HTMLElement>("[data-id]")) {
    if (el.getAttribute("data-id") === id) return el;
  }
  return null;
}

export function contentOf(block: HTMLElement): HTMLElement {
  return block.querySelector<HTMLElement>(":scope > .bn-block > .bn-block-content") ?? block;
}
