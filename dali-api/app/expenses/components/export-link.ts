export function exportHref(format: "csv" | "pdf", scope: "mine" | "approvals" | "all", params: URLSearchParams): string {
  const out = new URLSearchParams();
  out.set("format", format);
  out.set("scope", scope);
  for (const key of ["status", "cardId", "categoryId", "termId", "from", "to", "noReceipt", "outstanding"]) {
    const v = params.get(key);
    if (v) out.set(key, v);
  }
  return `/expenses/export?${out.toString()}`;
}
