// A ready-to-run curl command for a presigned S3 POST, shared by the MCP tools
// that hand an agent an upload link (project files, payroll CSVs). The agent
// has the file on disk and a shell; the bytes go straight to S3 and never pass
// through a tool call.

/** POSIX single-quote a value for the curl command. */
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** `--form-string` for the policy fields so curl never reads a value as `@file`
 *  or splits a `;` inside a Content-Type; `-F` only for the file part, last.
 *  Prints the status on its own line: 204 on success, S3's error XML otherwise. */
export function curlCommand(url: string, fields: Record<string, string>, fileName: string): string {
  // A literal backslash-n: curl expands it, and the command stays on one line.
  const parts = ["curl", "-sS", "-w", shellQuote("\\nHTTP %{http_code}\\n"), "-X", "POST", shellQuote(url)];
  for (const [name, value] of Object.entries(fields)) {
    parts.push("--form-string", shellQuote(`${name}=${value}`));
  }
  parts.push("-F", shellQuote(`file=@/path/to/${fileName}`));
  return parts.join(" ");
}
