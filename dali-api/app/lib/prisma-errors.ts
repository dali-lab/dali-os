function codeOf(err: unknown): string | undefined {
  if (typeof err !== "object" || err === null) return undefined;
  const code = (err as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

export function uniqueViolationFields(err: unknown): string[] {
  if (codeOf(err) !== "P2002") return [];
  const meta = (err as { meta?: Record<string, unknown> }).meta;
  const target = meta?.target;
  if (Array.isArray(target)) return target.map(String);
  if (typeof target === "string") return [target];
  const constraint = (meta?.driverAdapterError as { cause?: { constraint?: { fields?: unknown; index?: unknown } } } | undefined)
    ?.cause?.constraint;
  if (Array.isArray(constraint?.fields)) return constraint.fields.map(String);
  return typeof constraint?.index === "string" ? [constraint.index] : [];
}

export function isUniqueViolation(err: unknown, field?: string): boolean {
  if (codeOf(err) !== "P2002") return false;
  if (field === undefined) return true;
  return uniqueViolationFields(err).some((f) => f.includes(field));
}

export function isRecordNotFound(err: unknown): boolean {
  return codeOf(err) === "P2025";
}

export function isForeignKeyViolation(err: unknown): boolean {
  return codeOf(err) === "P2003";
}
