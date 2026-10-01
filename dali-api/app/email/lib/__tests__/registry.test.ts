import { describe, expect, it } from "vitest";

import {
  EMAIL_TEMPLATES,
  EMAIL_TEMPLATE_KEYS,
  educationKey,
  emailTemplateDef,
  emailTemplatesByArea,
  hiringKey,
  isEmailTemplateKey,
} from "~/email/lib/registry";
import { TEMPLATE_VARIABLES, type TemplateSlot } from "~/hiring/lib/email-variables";
import { DECISION_EMAIL_SLOTS } from "~/education/lib/education-emails";
import { TEMPLATE_VARIABLES_REGISTRY } from "~/lib/template-variables";
import { EMAIL_PURPOSE_KEYS } from "~/lib/email-identities";

describe("registry integrity", () => {
  it("declares only variables that exist in the shared vocabulary", () => {
    const known = new Set(Object.keys(TEMPLATE_VARIABLES_REGISTRY));
    for (const key of EMAIL_TEMPLATE_KEYS) {
      for (const v of emailTemplateDef(key).variables) {
        expect(known, `${key} uses {{${v}}}`).toContain(v);
      }
    }
  });

  it("routes every email to a real sender identity", () => {
    for (const key of EMAIL_TEMPLATE_KEYS) {
      expect(EMAIL_PURPOSE_KEYS).toContain(emailTemplateDef(key).purpose);
    }
  });

  it("gives every sample the variables that email declares", () => {
    // Otherwise the editor preview and the test send render a raw {{token}}.
    for (const key of EMAIL_TEMPLATE_KEYS) {
      const def = emailTemplateDef(key);
      for (const v of def.variables) {
        expect(Object.keys(def.sample), `${key} sample is missing ${v}`).toContain(v);
      }
    }
  });

  it("gives fallback copy to exactly the keys that fall back", () => {
    for (const key of EMAIL_TEMPLATE_KEYS) {
      const def = emailTemplateDef(key);
      if (def.whenMissing === "default") {
        expect(def.defaults, `${key} falls back but has no defaults`).toBeDefined();
      } else {
        expect(def.defaults, `${key} has unused defaults`).toBeUndefined();
      }
    }
  });

  it("writes every description as a sentence, so the admin list reads", () => {
    for (const key of EMAIL_TEMPLATE_KEYS) {
      const def = emailTemplateDef(key);
      expect(def.label.length).toBeGreaterThan(0);
      expect(def.description.endsWith("."), `${key}: ${def.description}`).toBe(true);
    }
  });
});

describe("registry covers both pre-collapse slot vocabularies", () => {
  // The drift guard: the slot tables are gone, but hiring and education still
  // speak slots at every call site. A slot with no registry entry would throw at
  // send time, which is exactly what this catches at build time instead.
  it("has an entry for every hiring slot", () => {
    for (const slot of Object.keys(TEMPLATE_VARIABLES) as TemplateSlot[]) {
      expect(isEmailTemplateKey(`hiring:${slot}`), `missing hiring:${slot}`).toBe(true);
    }
  });

  it("has an entry for every education decision slot", () => {
    for (const { status } of DECISION_EMAIL_SLOTS) {
      expect(
        isEmailTemplateKey(`education:decision:${status}`),
        `missing education:decision:${status}`,
      ).toBe(true);
    }
  });

  it("carries hiring's per-slot variable contract over unchanged", () => {
    for (const [slot, vars] of Object.entries(TEMPLATE_VARIABLES)) {
      const def = emailTemplateDef(hiringKey(slot));
      expect([...def.variables].sort(), slot).toEqual([...vars].sort());
    }
  });

  it("keeps the two areas' colliding slot names apart", () => {
    // "decision:Rejected" existed in both tables. That collision is why keys are
    // area-prefixed rather than bare slots.
    expect(hiringKey("decision:Rejected")).toBe("hiring:decision:Rejected");
    expect(educationKey("decision:Rejected")).toBe("education:decision:Rejected");
    expect(hiringKey("decision:Rejected")).not.toBe(educationKey("decision:Rejected"));
  });

  it("throws on a slot it doesn't know, rather than inventing a key", () => {
    expect(() => hiringKey("decision:Nope")).toThrow(/unknown hiring email slot/);
    expect(() => educationKey("decision:Nope")).toThrow(/unknown education email slot/);
  });
});

describe("emailTemplatesByArea", () => {
  it("groups without losing or duplicating a key", () => {
    const grouped = emailTemplatesByArea();
    const flat = grouped.flatMap((g) => g.keys);
    expect(flat.sort()).toEqual([...EMAIL_TEMPLATE_KEYS].sort());
    expect(new Set(flat).size).toBe(flat.length);
  });

  it("lists each area once", () => {
    const areas = emailTemplatesByArea().map((g) => g.area);
    expect(new Set(areas).size).toBe(areas.length);
  });
});

describe("isEmailTemplateKey", () => {
  it("accepts a real key and rejects everything else", () => {
    expect(isEmailTemplateKey("hiring:decision:Accepted")).toBe(true);
    expect(isEmailTemplateKey("decision:Accepted")).toBe(false);
    expect(isEmailTemplateKey("")).toBe(false);
    expect(isEmailTemplateKey(null)).toBe(false);
    expect(isEmailTemplateKey(42)).toBe(false);
    // Not fooled by an inherited property name.
    expect(isEmailTemplateKey("toString")).toBe(false);
  });
});

describe("the collapse covered what the old stores held", () => {
  it("has 18 editable emails: 14 hiring slots plus 4 education decisions", () => {
    const hiring = EMAIL_TEMPLATE_KEYS.filter((k) => k.startsWith("hiring:"));
    const education = EMAIL_TEMPLATE_KEYS.filter((k) => k.startsWith("education:"));
    expect(hiring).toHaveLength(14);
    expect(education).toHaveLength(4);
    expect(EMAIL_TEMPLATES).toBeDefined();
  });
});
