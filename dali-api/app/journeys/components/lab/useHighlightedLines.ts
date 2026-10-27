import { useEffect, useMemo, useState } from "react";
import type { codeBlockOptions } from "@blocknote/code-block";

type Highlighter = Awaited<ReturnType<typeof codeBlockOptions.createHighlighter>>;

export interface HighlightToken {
  content: string;
  style?: Record<string, string>;
}

let highlighter: Promise<Highlighter> | null = null;

// The doc editor's Shiki bundle, imported lazily so it stays out of SSR and
// off pages without a lab. Languages load once each, on first use.
async function loadHighlighter(lang: string): Promise<Highlighter> {
  highlighter ??= import("@blocknote/code-block").then((m) => m.codeBlockOptions.createHighlighter());
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
