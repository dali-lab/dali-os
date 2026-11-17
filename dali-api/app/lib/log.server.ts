type LogContext = Record<string, string | number | boolean | null>;

export function logError(scope: string, err: unknown, context?: LogContext): void {
  const message = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? err.stack : undefined;
  console.error(`[${scope}] ${message}`, { ...(context ?? {}), ...(stack ? { stack } : {}) });
}
