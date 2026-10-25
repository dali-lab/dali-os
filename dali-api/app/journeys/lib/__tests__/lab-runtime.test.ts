import { describe, expect, it } from "vitest";
import { buildLabDocument, LAB_MESSAGE_SOURCE, resolvePath } from "../lab-runtime";
import type { LabStep } from "../types";

const preview = (files: Record<string, string>) => buildLabDocument(files, { runId: 7, mode: "preview" });
const test = (files: Record<string, string>, steps: LabStep[] = []) =>
  buildLabDocument(files, { runId: 7, mode: "test", steps });

/** Decoded source of every quoted data: module URL in a document, in order of appearance. */
function dataModules(doc: string): string[] {
  return [...doc.matchAll(/(["'])data:text\/javascript;charset=utf-8,(.*?)\1/g)].map((m) => decodeURIComponent(m[2]));
}

describe("resolvePath", () => {
  it("resolves relative to the importing file's folder", () => {
    expect(resolvePath("index.html", "styles/main.css")).toBe("styles/main.css");
    expect(resolvePath("src/main.js", "./utils/greet.js")).toBe("src/utils/greet.js");
    expect(resolvePath("src/a/b.js", "../c.js")).toBe("src/c.js");
  });
  it("treats a leading slash as the lab root", () => {
    expect(resolvePath("src/deep/x.js", "/root.js")).toBe("root.js");
  });
  it("drops empty and dot segments and can't climb above the root", () => {
    expect(resolvePath("a.js", ".//b//./c.js")).toBe("b/c.js");
    expect(resolvePath("a.js", "../../x.js")).toBe("x.js");
  });
});

describe("buildLabDocument", () => {
  it("says to add an index.html when there is none", () => {
    expect(preview({ "a.js": "1" })).toContain("Add an index.html file to see a preview.");
  });

  it("wraps a fragment in a full document", () => {
    const doc = preview({ "index.html": "<p>hi</p>" });
    expect(doc.startsWith('<!doctype html><html><head><meta charset="utf-8">')).toBe(true);
    expect(doc).toContain("<body><p>hi</p>");
    expect(doc.endsWith("</body></html>")).toBe(true);
  });

  it("includes every css and js file for a fragment with no links or scripts", () => {
    const doc = preview({ "index.html": "<p>x</p>", "b.css": "b{}", "a.css": "a{}", "s.js": "go()", "m.mjs": "m()", "n.txt": "TEXT_ONLY" });
    expect(doc).toContain('<style data-file="a.css">a{}</style><style data-file="b.css">b{}</style>');
    expect(doc).toContain("<script>m()\n//# sourceURL=m.mjs</script>");
    expect(doc).toContain("<script>go()\n//# sourceURL=s.js</script>");
    expect(doc).not.toContain("TEXT_ONLY");
  });

  it("doesn't auto-include css when the page links a stylesheet, or js when it has a script", () => {
    const doc = preview({
      "index.html": '<link rel="stylesheet" href="https://cdn.example/x.css"><script>inline()</script>',
      "local.css": "local{}",
      "local.js": "local()",
    });
    expect(doc).not.toContain("local{}");
    expect(doc).not.toContain("local()");
  });

  it("inlines local stylesheets and leaves external and missing ones alone", () => {
    const doc = preview({
      "index.html": '<link rel="stylesheet" href="styles/main.css"><link rel="stylesheet" href="https://x/y.css"><link rel="stylesheet" href="gone.css"><link rel="icon" href="i.png">',
      "styles/main.css": "body{color:red}",
    });
    expect(doc).toContain('<style data-file="styles/main.css">body{color:red}</style>');
    expect(doc).toContain('<link rel="stylesheet" href="https://x/y.css">');
    expect(doc).toContain('<link rel="stylesheet" href="gone.css">');
    expect(doc).toContain('<link rel="icon" href="i.png">');
  });

  it("inlines classic scripts with a sourceURL and reports missing ones to the console", () => {
    const doc = preview({
      "index.html": '<script src="app.js"></script><script src="nope.js"></script><script src="https://cdn/x.js"></script>',
      "app.js": "start()",
    });
    expect(doc).toContain("<script>start()\n//# sourceURL=app.js</script>");
    expect(doc).toContain(`<script>console.error("Couldn't find nope.js")</script>`);
    expect(doc).toContain('<script src="https://cdn/x.js"></script>');
  });

  it("finds a script without its extension or as a folder index", () => {
    const doc = preview({ "index.html": '<script src="lib"></script><script src="pkg"></script>', "lib.js": "L()", "pkg/index.js": "P()" });
    expect(doc).toContain("//# sourceURL=lib.js");
    expect(doc).toContain("//# sourceURL=pkg/index.js");
  });

  it("escapes closing tags inside inlined code", () => {
    const doc = preview({
      "index.html": '<link rel="stylesheet" href="s.css"><script src="a.js"></script>',
      "a.js": 'document.body.innerHTML = "</script>";',
      "s.css": "/* </style> */",
    });
    expect(doc).toContain('"<\\/script>"');
    expect(doc).toContain("/* <\\/style> */");
  });

  it("turns module scripts and their relative imports into nested data: URLs", () => {
    const doc = preview({
      "index.html": '<script type="module" src="src/main.js"></script>',
      "src/main.js": 'import { greet } from "./utils/greet.js";\nimport "./side";\ngreet();',
      "src/utils/greet.js": 'import { name } from "../name.js";\nexport function greet() { return name; }',
      "src/name.js": "export const name = `DALI`;",
      "src/side.js": "console.log(1)",
    });
    const [main] = dataModules(doc);
    expect(main).toContain("//# sourceURL=src/main.js");
    const inner = dataModules(main);
    expect(inner.some((m) => m.includes("//# sourceURL=src/side.js"))).toBe(true);
    const greet = inner.find((m) => m.includes("//# sourceURL=src/utils/greet.js"))!;
    expect(dataModules(greet)[0]).toContain("export const name = `DALI`;");
  });

  it("rewrites bare imports to esm.sh and keeps external and unresolved ones", () => {
    const doc = preview({
      "index.html": '<script type="module" src="m.js"></script>',
      "m.js": "import confetti from 'canvas-confetti';\nimport x from 'https://cdn/x.js';\nimport y from './missing.js';\nexport { z } from \"./z.js\";\nconst q = import(\"./z.js\");",
      "z.js": "export const z = 1;",
    });
    const [m] = dataModules(doc);
    expect(m).toContain("import confetti from 'https://esm.sh/canvas-confetti'");
    expect(m).toContain("import x from 'https://cdn/x.js'");
    expect(m).toContain("import y from './missing.js'");
    expect(m).toMatch(/export \{ z \} from "data:text\/javascript/);
    expect(m).toMatch(/import\("data:text\/javascript/);
  });

  // Known bug: encodeURIComponent leaves ' unescaped, so a module imported
  // with single quotes whose own code contains a ' ends the string literal
  // early (the default lab template hits this). Drop `.fails` once fixed.
  it("keeps a single-quoted import of code containing quotes intact", () => {
    const doc = preview({
      "index.html": '<script type="module" src="main.js"></script>',
      "main.js": "import { greet } from './greet.js';",
      "greet.js": "export const greet = () => 'Hello';",
    });
    const [main] = dataModules(doc);
    expect(dataModules(main)[0]).toContain("export const greet = () => 'Hello';");
  });

  it("reports a circular import instead of recursing forever", () => {
    const doc = preview({
      "index.html": '<script type="module" src="a.js"></script>',
      "a.js": "import './b.js';",
      "b.js": "import './a.js';",
    });
    expect(doc).toContain(`console.error("Circular import involving a.js isn't supported in labs.")`);
  });

  it("injects into an existing head and before the closing body", () => {
    const doc = test(
      { "index.html": "<html><head><title>T</title></head><body><p>x</p></body></html>" },
      [{ id: "s1", title: "", instructions: "", check: "true" }],
    );
    expect(doc).toMatch(/^<html><head><meta charset="utf-8"><title>T<\/title>/);
    expect(doc).toMatch(/<p>x<\/p><script>\(function\(\)\{var RUN=7;var tests=.*<\/script><\/body><\/html>$/);
  });

  it("prepends head content and appends tail content when the page has a body but no head", () => {
    const doc = test({ "index.html": "<body>b</body>" });
    expect(doc.startsWith('<meta charset="utf-8"><body>b')).toBe(true);
    expect(doc).toMatch(/<\/script><\/body>$/);
    const noBodyClose = test({ "index.html": "<html><body>b" });
    expect(noBodyClose).toMatch(/<\/script>$/);
  });

  it("adds the console bridge only in preview mode", () => {
    const doc = preview({ "index.html": "<p></p>" });
    expect(doc).toContain(`source:'${LAB_MESSAGE_SOURCE}',runId:RUN,type:'console'`);
    expect(doc).toContain("var RUN=7");
    expect(doc).not.toContain("var tests=");
  });

  it("adds the check runner only in test mode, with steps serialized safely", () => {
    const doc = test({ "index.html": "<p></p>" }, [
      { id: "a", title: "", instructions: "", check: "document.querySelector('h1') !== null" },
      { id: "b", title: "", instructions: "", check: "'</script>'.length > 0" },
    ]);
    expect(doc).not.toContain("type:'console'");
    expect(doc).toContain(`type:'checks'`);
    expect(doc).toContain(`{"id":"a","test":"document.querySelector('h1') !== null"}`);
    expect(doc).toContain("\\u003c/script>");
    expect(doc).not.toContain("'</script>'.length");
  });
});
