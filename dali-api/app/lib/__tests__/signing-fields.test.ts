import { describe, it, expect } from "vitest";
import {
  bakeSigningBody,
  collectSigningFields,
  isEmptyBody,
  fieldDisplayText,
  variableDisplayText,
  isCheckboxChecked,
} from "../signing-fields";
import { ensureBlocks } from "~/collab/legacy/pm-to-blocknote";

// ─── Legacy ProseMirror fixture (pre-migration format — read-only support) ──

const pmBody = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [
        { type: "text", text: "Welcome back for the " },
        { type: "variable", attrs: { name: "term" } },
        { type: "text", text: " term." },
      ],
    },
    {
      type: "paragraph",
      content: [
        { type: "signatureField", attrs: { fieldId: "sig1", role: "member", required: true } },
        { type: "dateField", attrs: { fieldId: "date1", role: "member", required: true } },
        { type: "checkboxField", attrs: { fieldId: "ack1", role: "member", required: false } },
        { type: "signatureField", attrs: { fieldId: "sup1", role: "supervisor", required: true } },
      ],
    },
  ],
};

// ─── BlockNote fixture: all 5 field types + variable, nested children and
// table content (both cell forms), a field inside link content ──────────────
// Structurally typed (any) — the walkers are structural and the assertions
// index deep into heterogeneous unions.

const blocksBody: any[] = [
  {
    id: "b1",
    type: "paragraph",
    props: {},
    content: [
      { type: "text", text: "Welcome back for the ", styles: {} },
      { type: "variable", props: { name: "term", value: "" } },
      { type: "text", text: " term.", styles: {} },
    ],
    children: [],
  },
  {
    id: "b2",
    type: "paragraph",
    props: {},
    content: [
      { type: "signatureField", props: { fieldId: "sig1", role: "member", required: true, value: "" } },
      { type: "dateField", props: { fieldId: "date1", role: "member", required: true, value: "" } },
      { type: "initialField", props: { fieldId: "init1", role: "member", required: true, value: "" } },
      { type: "checkboxField", props: { fieldId: "ack1", role: "member", required: false, value: "" } },
      { type: "textField", props: { fieldId: "txt1", role: "member", required: false, value: "" } },
    ],
    children: [
      {
        id: "b3",
        type: "paragraph",
        props: {},
        content: [
          {
            type: "signatureField",
            props: { fieldId: "sup1", role: "supervisor", required: true, value: "" },
          },
        ],
        children: [],
      },
    ],
  },
  {
    id: "b4",
    type: "table",
    props: {},
    content: {
      type: "tableContent",
      rows: [
        {
          cells: [
            // bare inline-array cell form
            [{ type: "checkboxField", props: { fieldId: "cell1", role: "member" } }],
            // full tableCell object form
            {
              type: "tableCell",
              props: {},
              content: [{ type: "variable", props: { name: "memberName", value: "" } }],
            },
          ],
        },
      ],
    },
    children: [],
  },
  {
    id: "b5",
    type: "paragraph",
    props: {},
    content: [
      {
        type: "link",
        href: "https://example.com",
        content: [
          { type: "textField", props: { fieldId: "linked1", role: "member", required: false, value: "" } },
        ],
      },
    ],
    children: [],
  },
];

describe("collectSigningFields — block JSON", () => {
  it("collects all 5 field types incl. nested children, table cells, and link content", () => {
    const fields = collectSigningFields(blocksBody);
    expect(fields).toEqual([
      { fieldId: "sig1", type: "signatureField", role: "member", required: true },
      { fieldId: "date1", type: "dateField", role: "member", required: true },
      { fieldId: "init1", type: "initialField", role: "member", required: true },
      { fieldId: "ack1", type: "checkboxField", role: "member", required: false },
      { fieldId: "txt1", type: "textField", role: "member", required: false },
      { fieldId: "sup1", type: "signatureField", role: "supervisor", required: true },
      // `required` omitted → defaults to true (legacy semantics preserved)
      { fieldId: "cell1", type: "checkboxField", role: "member", required: true },
      { fieldId: "linked1", type: "textField", role: "member", required: false },
    ]);
  });

  it("required-field validation semantics are unchanged (checkbox vs text emptiness)", () => {
    // Mirrors the recordSignature gate: required member fields must be filled;
    // checkboxes count via isCheckboxChecked, everything else via trimmed text.
    const fields = collectSigningFields(blocksBody).filter(
      (f) => f.role === "member" && f.required,
    );
    const values: Record<string, unknown> = {
      sig1: "Ada Lovelace",
      date1: "July 31, 2026",
      init1: "AL",
      cell1: true,
    };
    const filled = fields.every((f) => {
      const v = values[f.fieldId];
      return f.type === "checkboxField"
        ? isCheckboxChecked(v)
        : v != null && String(v).trim() !== "";
    });
    expect(filled).toBe(true);
    // unchecked checkbox blocks the gate
    const missing = fields.every((f) => {
      const v = { ...values, cell1: false }[f.fieldId];
      return f.type === "checkboxField"
        ? isCheckboxChecked(v)
        : v != null && String(v).trim() !== "";
    });
    expect(missing).toBe(false);
  });
});

describe("collectSigningFields — legacy ProseMirror JSON", () => {
  it("collects every field with its role + required flag", () => {
    const fields = collectSigningFields(pmBody);
    expect(fields).toEqual([
      { fieldId: "sig1", type: "signatureField", role: "member", required: true },
      { fieldId: "date1", type: "dateField", role: "member", required: true },
      { fieldId: "ack1", type: "checkboxField", role: "member", required: false },
      { fieldId: "sup1", type: "signatureField", role: "supervisor", required: true },
    ]);
  });

  it("returns [] for a non-object body", () => {
    expect(collectSigningFields(null)).toEqual([]);
    expect(collectSigningFields("nope")).toEqual([]);
  });
});

describe("bakeSigningBody — block JSON", () => {
  const baked = bakeSigningBody(blocksBody, {
    fieldValues: { sig1: "Ada Lovelace", ack1: true, cell1: false, txt1: "hello", linked1: "x" },
    variables: { term: "26S", memberName: "Jane Member" },
  }) as any[];

  it("bakes captured values into props.value (booleans stringified for the string prop)", () => {
    const para = baked[1].content;
    expect(para[0].props.value).toBe("Ada Lovelace");
    expect(para[3].props.value).toBe("true"); // checkbox true → "true"
    expect(para[4].props.value).toBe("hello");
    // no captured value → untouched
    expect(para[1].props.value).toBe("");
  });

  it("resolves variables into props.value", () => {
    expect(baked[0].content[1].props).toMatchObject({ name: "term", value: "26S" });
  });

  it("bakes nested children, both table-cell forms, and link content", () => {
    expect(baked[1].children[0].content[0].props.value).toBe(""); // supervisor value not provided
    const rows = baked[2].content.rows;
    expect(rows[0].cells[0][0].props.value).toBe("false"); // bare inline-array cell
    expect(rows[0].cells[1].content[0].props).toMatchObject({
      name: "memberName",
      value: "Jane Member",
    }); // tableCell object
    expect(baked[3].content[0].content[0].props.value).toBe("x"); // link content
  });

  it("never mutates the input", () => {
    expect(blocksBody[1].content[0].props.value).toBe("");
    expect(blocksBody[2].content.rows[0].cells[0][0].props.value).toBeUndefined();
  });

  it("checkbox round-trip: baked string values still read as checked/unchecked", () => {
    expect(isCheckboxChecked("true")).toBe(true);
    expect(fieldDisplayText("checkboxField", "true")).toBe("☑");
    expect(fieldDisplayText("checkboxField", "false")).toBe("☐");
  });
});

describe("bakeSigningBody — legacy ProseMirror JSON (attrs, raw values)", () => {
  it("bakes captured field values + resolved variables into attrs.value, immutably", () => {
    const baked = bakeSigningBody(pmBody, {
      fieldValues: { sig1: "Ada Lovelace", date1: "July 30, 2026", ack1: true },
      variables: { term: "26S" },
    }) as typeof pmBody;

    expect(baked.content[0].content![1].attrs).toMatchObject({ name: "term", value: "26S" });
    expect(baked.content[1].content![0].attrs).toMatchObject({ value: "Ada Lovelace" });
    expect(baked.content[1].content![1].attrs).toMatchObject({ value: "July 30, 2026" });
    expect(baked.content[1].content![2].attrs).toMatchObject({ value: true });
    expect(baked.content[1].content![3].attrs).not.toHaveProperty("value");
    expect(pmBody.content[1].content![0].attrs).not.toHaveProperty("value");
  });
});

describe("dual-format signature path: legacy PM version body → block frozen body", () => {
  it("ensureBlocks(pm) then bake yields block JSON with values baked (what recordSignature freezes)", () => {
    const blocks = ensureBlocks(pmBody);
    expect(Array.isArray(blocks)).toBe(true);

    // fieldIds survive conversion 1:1, so client-captured values key correctly
    const fields = collectSigningFields(blocks);
    expect(fields.map((f) => f.fieldId)).toEqual(["sig1", "date1", "ack1", "sup1"]);

    const frozen = bakeSigningBody(blocks, {
      fieldValues: { sig1: "Ada Lovelace", ack1: true },
      variables: { term: "26S" },
    }) as { content: { type: string; props: Record<string, unknown> }[] }[];
    expect(Array.isArray(frozen)).toBe(true);
    const sig = frozen
      .flatMap((b) => (Array.isArray(b.content) ? b.content : []))
      .find((i) => i.type === "signatureField" && i.props.fieldId === "sig1");
    expect(sig?.props.value).toBe("Ada Lovelace");
    const term = frozen
      .flatMap((b) => (Array.isArray(b.content) ? b.content : []))
      .find((i) => i.type === "variable");
    expect(term?.props).toMatchObject({ name: "term", value: "26S" });
  });
});

describe("isEmptyBody", () => {
  it("block JSON: empty for no blocks / whitespace-free paragraphs, non-empty with text", () => {
    expect(isEmptyBody([])).toBe(true);
    expect(
      isEmptyBody([{ id: "a", type: "paragraph", props: {}, content: [], children: [] }]),
    ).toBe(true);
    expect(isEmptyBody(blocksBody)).toBe(false);
    // text inside a table cell counts
    expect(
      isEmptyBody([
        {
          id: "t",
          type: "table",
          props: {},
          content: {
            type: "tableContent",
            rows: [{ cells: [[{ type: "text", text: "hi", styles: {} }]] }],
          },
          children: [],
        },
      ]),
    ).toBe(false);
  });

  it("legacy PM: empty doc detection matches the old isEmptyDoc", () => {
    expect(isEmptyBody({ type: "doc", content: [{ type: "paragraph" }] })).toBe(true);
    expect(isEmptyBody(pmBody)).toBe(false);
    expect(isEmptyBody(null)).toBe(true);
    expect(isEmptyBody({})).toBe(true);
  });
});

describe("fieldDisplayText / variableDisplayText / isCheckboxChecked", () => {
  it("renders checkbox glyphs and passthrough text", () => {
    expect(fieldDisplayText("checkboxField", true)).toBe("☑");
    expect(fieldDisplayText("checkboxField", false)).toBe("☐");
    expect(fieldDisplayText("signatureField", "Ada")).toBe("Ada");
    expect(fieldDisplayText("textField", null)).toBe("");
  });

  it("shows the token for an unresolved variable, else the value", () => {
    expect(variableDisplayText("term", "")).toBe("{{term}}");
    expect(variableDisplayText("term", "26S")).toBe("26S");
  });

  it("treats true and 'true' as checked", () => {
    expect(isCheckboxChecked(true)).toBe(true);
    expect(isCheckboxChecked("true")).toBe(true);
    expect(isCheckboxChecked(false)).toBe(false);
    expect(isCheckboxChecked(undefined)).toBe(false);
  });
});
