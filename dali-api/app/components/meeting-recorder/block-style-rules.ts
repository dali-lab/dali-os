import { useEffect, useRef } from "react";

const SAFE_ID = /^[A-Za-z0-9_-]+$/;

/** Selector for one block's wrapper, or null when the id can't be quoted
 *  safely. Rules are the only channel into the editor's blocks: ProseMirror
 *  owns every node under the editor, so nothing here may set an attribute or
 *  style on one. */
export function blockSelector(id: string): string | null {
  const escaped = typeof CSS !== "undefined" && typeof CSS.escape === "function" ? CSS.escape(id) : SAFE_ID.test(id) ? id : null;
  return escaped === null ? null : `.dali-doc .bn-block-outer[data-id="${escaped}"]`;
}

export const BLOCK_CONTENT = "> .bn-block > .bn-block-content";

export function useBlockStyleRules(key: string, css: string) {
  const element = useRef<HTMLStyleElement | null>(null);

  useEffect(() => {
    if (css === "") {
      element.current?.remove();
      element.current = null;
      return;
    }
    if (!element.current) {
      const style = document.createElement("style");
      style.setAttribute("data-enhance-rules", key);
      document.head.appendChild(style);
      element.current = style;
    }
    if (element.current.textContent !== css) element.current.textContent = css;
  }, [key, css]);

  useEffect(
    () => () => {
      element.current?.remove();
      element.current = null;
    },
    [],
  );
}
