/** Parses a JSON form field, or returns undefined when it's missing or malformed. */
export function safeJsonParse(value: FormDataEntryValue | null): unknown {
  if (typeof value !== "string") return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}
