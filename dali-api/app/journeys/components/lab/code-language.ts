export interface CommentSyntax {
  open: string;
  close?: string;
}

export interface CodeLanguage {
  /** A Shiki language id from @blocknote/code-block's bundle, or null for plain text. */
  highlight: string | null;
  comment: CommentSyntax | null;
  autoPairs: boolean;
}

const LINE = { open: "//" };
const BLOCK = { open: "/*", close: "*/" };
const MARKUP = { open: "<!--", close: "-->" };
const HASH = { open: "#" };

const BY_EXTENSION: Record<string, CodeLanguage> = {
  js: { highlight: "javascript", comment: LINE, autoPairs: true },
  mjs: { highlight: "javascript", comment: LINE, autoPairs: true },
  cjs: { highlight: "javascript", comment: LINE, autoPairs: true },
  jsx: { highlight: "jsx", comment: LINE, autoPairs: true },
  ts: { highlight: "typescript", comment: LINE, autoPairs: true },
  mts: { highlight: "typescript", comment: LINE, autoPairs: true },
  tsx: { highlight: "tsx", comment: LINE, autoPairs: true },
  json: { highlight: "json", comment: null, autoPairs: true },
  css: { highlight: "css", comment: BLOCK, autoPairs: true },
  scss: { highlight: "scss", comment: LINE, autoPairs: true },
  html: { highlight: "html", comment: MARKUP, autoPairs: true },
  htm: { highlight: "html", comment: MARKUP, autoPairs: true },
  svg: { highlight: "xml", comment: MARKUP, autoPairs: true },
  xml: { highlight: "xml", comment: MARKUP, autoPairs: true },
  md: { highlight: "markdown", comment: MARKUP, autoPairs: false },
  py: { highlight: "python", comment: HASH, autoPairs: true },
  sh: { highlight: "shellscript", comment: HASH, autoPairs: true },
  yml: { highlight: "yaml", comment: HASH, autoPairs: true },
  yaml: { highlight: "yaml", comment: HASH, autoPairs: true },
  sql: { highlight: "sql", comment: { open: "--" }, autoPairs: true },
};

const PLAIN: CodeLanguage = { highlight: null, comment: null, autoPairs: false };

export function languageFor(path: string): CodeLanguage {
  const name = path.split("/").pop() ?? "";
  const dot = name.lastIndexOf(".");
  return (dot > 0 && BY_EXTENSION[name.slice(dot + 1).toLowerCase()]) || PLAIN;
}
