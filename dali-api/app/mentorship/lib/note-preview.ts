type Block = {
  content?: unknown;
  children?: Block[];
};

function inlineText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((c) => {
      if (c && typeof c === "object") {
        const o = c as { text?: unknown; content?: unknown; props?: { label?: unknown } };
        if (typeof o.text === "string") return o.text;
        if (o.content) return inlineText(o.content);
        if (typeof o.props?.label === "string") return o.props.label;
      }
      return "";
    })
    .join("");
}

export function blocksToPlainText(blocks: unknown, limit = 600): string {
  const lines: string[] = [];
  const walk = (list: unknown) => {
    if (!Array.isArray(list)) return;
    for (const b of list as Block[]) {
      const line = inlineText(b.content).trim();
      if (line) lines.push(line);
      if (b.children?.length) walk(b.children);
    }
  };
  walk(blocks);
  const text = lines.join("\n");
  return text.length > limit ? `${text.slice(0, limit).trimEnd()}…` : text;
}
