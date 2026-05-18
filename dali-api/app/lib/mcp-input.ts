// Minimal, dependency-free JSON Schema validator for MCP tool inputs.
//
// Covers the subset our tool schemas actually use: type, properties, required,
// additionalProperties, items, enum, minimum, maximum, minLength, maxLength,
// minItems, maxItems. Anything outside that subset is silently ignored.

export type JsonSchema = {
  type?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean;
  items?: JsonSchema;
  enum?: unknown[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
};

export type ValidationResult =
  | { ok: true; value: unknown }
  | { ok: false; error: string };

function typeOf(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  if (Number.isInteger(v)) return "integer";
  return typeof v;
}

function validate(value: unknown, schema: JsonSchema, path: string): string | null {
  if (schema.type) {
    const t = typeOf(value);
    const expected = schema.type;
    const ok =
      t === expected ||
      (expected === "number" && t === "integer") ||
      (expected === "integer" && t === "integer");
    if (!ok) {
      return `${path || "value"}: expected ${expected}, got ${t}`;
    }
  }

  if (schema.enum && !schema.enum.includes(value as never)) {
    return `${path || "value"}: must be one of ${JSON.stringify(schema.enum)}`;
  }

  if (typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      return `${path}: shorter than minLength ${schema.minLength}`;
    }
    if (schema.maxLength !== undefined && value.length > schema.maxLength) {
      return `${path}: longer than maxLength ${schema.maxLength}`;
    }
  }

  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) {
      return `${path}: below minimum ${schema.minimum}`;
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      return `${path}: above maximum ${schema.maximum}`;
    }
  }

  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      return `${path}: fewer than minItems ${schema.minItems}`;
    }
    if (schema.maxItems !== undefined && value.length > schema.maxItems) {
      return `${path}: more than maxItems ${schema.maxItems}`;
    }
    if (schema.items) {
      for (let i = 0; i < value.length; i++) {
        const err = validate(value[i], schema.items, `${path}[${i}]`);
        if (err) return err;
      }
    }
  }

  if (
    schema.type === "object" ||
    (value !== null && typeof value === "object" && !Array.isArray(value))
  ) {
    const obj = value as Record<string, unknown>;
    if (schema.required) {
      for (const k of schema.required) {
        if (!(k in obj)) return `${path}${path ? "." : ""}${k}: missing required field`;
      }
    }
    if (schema.properties) {
      for (const [k, sub] of Object.entries(schema.properties)) {
        if (k in obj) {
          const err = validate(obj[k], sub, `${path}${path ? "." : ""}${k}`);
          if (err) return err;
        }
      }
    }
    if (schema.additionalProperties === false && schema.properties) {
      const allowed = new Set(Object.keys(schema.properties));
      for (const k of Object.keys(obj)) {
        if (!allowed.has(k)) return `${path}${path ? "." : ""}${k}: unexpected property`;
      }
    }
  }

  return null;
}

export function validateInput(value: unknown, schema: JsonSchema): ValidationResult {
  // Default empty input to {} so tools with no required fields accept undefined.
  const v = value === undefined ? {} : value;
  const err = validate(v, schema, "");
  if (err) return { ok: false, error: err };
  return { ok: true, value: v };
}
