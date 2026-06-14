function escapeCell(raw: unknown): string {
  if (raw === null || raw === undefined) return "";
  const s = String(raw);
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export const csvCell = escapeCell;

export function rowsToCsv(rows: ReadonlyArray<ReadonlyArray<unknown>>): string {
  if (rows.length === 0) return "";
  return rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

export function csvResponse(body: string, filename: string, init: { status?: number; headers?: HeadersInit } = {}): Response {
  const safeName = filename.replace(/[\r\n"]/g, "_");
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "text/csv; charset=utf-8");
  headers.set("Content-Disposition", `attachment; filename="${safeName}"`);
  return new Response(body, { status: init.status ?? 200, headers });
}
