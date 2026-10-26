// Callbacks run after every Prisma operation (db.ts calls runDbWriteHooks).
// This module imports nothing: db.ts sits in the client module graph, so it
// can't import a .server module directly. Server modules register here
// instead (layout-cache.server.ts does at load).

export type DbOperationHook = (model: string | undefined, operation: string) => void;

// On globalThis so Vite HMR re-evaluating a registering module doesn't stack
// a second copy of its hook against a fresh registry.
const g = globalThis as unknown as { __dbOperationHooks?: Map<string, DbOperationHook> };
const hooks = (g.__dbOperationHooks ??= new Map());

/** Register `hook` under `name`; registering the same name again replaces it. */
export function onDbOperation(name: string, hook: DbOperationHook): void {
  hooks.set(name, hook);
}

export function runDbOperationHooks(model: string | undefined, operation: string): void {
  for (const hook of hooks.values()) {
    try {
      hook(model, operation);
    } catch (err) {
      // A failing hook must never fail the query that already succeeded.
      console.error("[db-hooks] hook failed", err instanceof Error ? err.message : err);
    }
  }
}
