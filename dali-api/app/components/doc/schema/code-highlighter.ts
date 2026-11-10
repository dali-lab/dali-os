import { codeBlockOptions as blocknoteCodeBlockOptions } from "@blocknote/code-block";
import { createBundledHighlighter } from "@shikijs/core";
import { createJavaScriptRegexEngine } from "@shikijs/engine-javascript";

// Runtime-compiled grammars: the precompiled ones turn TextMate's \G anchor into
// an empty match, so CSS inside HTML never closes and breaks every line after it.
const LANGS = {
  c: () => import("@shikijs/langs/c"),
  cpp: () => import("@shikijs/langs/cpp"),
  css: () => import("@shikijs/langs/css"),
  glsl: () => import("@shikijs/langs/glsl"),
  graphql: () => import("@shikijs/langs/graphql"),
  haml: () => import("@shikijs/langs/haml"),
  html: () => import("@shikijs/langs/html"),
  java: () => import("@shikijs/langs/java"),
  javascript: () => import("@shikijs/langs/javascript"),
  json: () => import("@shikijs/langs/json"),
  jsonc: () => import("@shikijs/langs/jsonc"),
  jsonl: () => import("@shikijs/langs/jsonl"),
  jsx: () => import("@shikijs/langs/jsx"),
  julia: () => import("@shikijs/langs/julia"),
  less: () => import("@shikijs/langs/less"),
  markdown: () => import("@shikijs/langs/markdown"),
  mdx: () => import("@shikijs/langs/mdx"),
  php: () => import("@shikijs/langs/php"),
  postcss: () => import("@shikijs/langs/postcss"),
  pug: () => import("@shikijs/langs/pug"),
  python: () => import("@shikijs/langs/python"),
  r: () => import("@shikijs/langs/r"),
  regexp: () => import("@shikijs/langs/regexp"),
  sass: () => import("@shikijs/langs/sass"),
  scss: () => import("@shikijs/langs/scss"),
  shellscript: () => import("@shikijs/langs/shellscript"),
  sql: () => import("@shikijs/langs/sql"),
  svelte: () => import("@shikijs/langs/svelte"),
  typescript: () => import("@shikijs/langs/typescript"),
  vue: () => import("@shikijs/langs/vue"),
  "vue-html": () => import("@shikijs/langs/vue-html"),
  wasm: () => import("@shikijs/langs/wasm"),
  wgsl: () => import("@shikijs/langs/wgsl"),
  xml: () => import("@shikijs/langs/xml"),
  yaml: () => import("@shikijs/langs/yaml"),
  tsx: () => import("@shikijs/langs/tsx"),
  haskell: () => import("@shikijs/langs/haskell"),
  csharp: () => import("@shikijs/langs/csharp"),
  latex: () => import("@shikijs/langs/latex"),
  lua: () => import("@shikijs/langs/lua"),
  mermaid: () => import("@shikijs/langs/mermaid"),
  ruby: () => import("@shikijs/langs/ruby"),
  rust: () => import("@shikijs/langs/rust"),
  scala: () => import("@shikijs/langs/scala"),
  swift: () => import("@shikijs/langs/swift"),
  kotlin: () => import("@shikijs/langs/kotlin"),
  "objective-c": () => import("@shikijs/langs/objective-c"),
};

const createHighlighter = createBundledHighlighter({
  langs: LANGS,
  themes: {
    "github-dark": () => import("@shikijs/themes/github-dark"),
    "github-light": () => import("@shikijs/themes/github-light"),
  },
  engine: () => createJavaScriptRegexEngine(),
});

export const codeBlockOptions = {
  ...blocknoteCodeBlockOptions,
  createHighlighter: () => createHighlighter({ themes: ["github-dark", "github-light"], langs: [] }),
};

export type CodeHighlighter = Awaited<ReturnType<typeof codeBlockOptions.createHighlighter>>;
