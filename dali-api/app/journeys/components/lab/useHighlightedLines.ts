import { useEffect, useMemo, useState } from "react";
import type { CodeHighlighter as Highlighter } from "~/components/doc/schema/code-highlighter";

export interface HighlightToken {
  content: string;
  style?: Record<string, string>;
}

let highlighter: Promise<Highlighter> | null = null;

async function loadHighlighter(lang: string): Promise<Highlighter> {
  highlighter ??= import("~/components/doc/schema/code-highlighter").then((m) => m.codeBlockOptions.createHighlighter());
  const h = await highlighter;
  if (!h.getLoadedLanguages().includes(lang)) await h.loadLanguage(lang as never);
  return h;
}

/** Token lines for `value`, with light and dark colors as CSS variables, or null until ready. */
export function useHighlightedLines(value: string, lang: string | null): HighlightToken[][] | null {
  const [ready, setReady] = useState<{ lang: string; h: Highlighter } | null>(null);

  useEffect(() => {
    if (!lang) return;
    let live = true;
    loadHighlighter(lang)
      .then((h) => live && setReady({ lang, h }))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [lang]);

  return useMemo(() => {
    if (!lang || ready?.lang !== lang) return null;
    try {
      const { tokens } = ready.h.codeToTokens(value, {
        lang: lang as never,
        themes: { light: "github-light", dark: "github-dark" },
        defaultColor: false,
      });
      return tokens.map((line) =>
        line.map((t) => ({ content: t.content, style: t.htmlStyle as Record<string, string> | undefined })),
      );
    } catch {
      return null;
    }
  }, [ready, lang, value]);
}
