import { AsyncLocalStorage } from "node:async_hooks";
import { runDbOperationHooks } from "~/lib/db-write-hooks";

type Queue = { operations: Map<string, [string | undefined, string]>; closed: boolean };

const pending = new AsyncLocalStorage<Queue>();

/** Run the hooks now, or once the enclosing interactive transaction commits. */
export function runOrDeferDbOperationHooks(model: string | undefined, operation: string): void {
  const queue = pending.getStore();
  if (!queue || queue.closed) return runDbOperationHooks(model, operation);
  queue.operations.set(`${model}:${operation}`, [model, operation]);
}

/**
 * Run an interactive transaction with its hooks held back, then flush them
 * once each. Rollbacks flush too: the queue can't tell a transaction's writes
 * from a write on the global client made inside its callback, which did commit,
 * and the only hooks clear caches, so a needless clear costs one extra read.
 */
export async function withDeferredDbHooks<T>(run: () => Promise<T>): Promise<T> {
  const outer = pending.getStore();
  if (outer && !outer.closed) return run();
  const queue: Queue = { operations: new Map(), closed: false };
  try {
    return await pending.run(queue, run);
  } finally {
    queue.closed = true;
    for (const [model, operation] of queue.operations.values()) {
      try {
        runDbOperationHooks(model, operation);
      } catch (err) {
        console.error("[db-hooks] flush failed", err instanceof Error ? err.message : err);
      }
    }
  }
}

/**
 * Wrap `$transaction` so interactive callbacks defer their hooks to commit.
 * The array form needs nothing: Prisma runs its extensions inside the
 * `$transaction` call and resolves each query only after the batch commits.
 */
export function deferHooksInTransactions<T extends object>(client: T): T {
  return new Proxy(client, {
    get(target, prop) {
      const value = Reflect.get(target, prop, target);
      if (typeof value !== "function" || typeof prop !== "string" || !prop.startsWith("$")) return value;
      if (prop !== "$transaction") return value.bind(target);
      return (...args: unknown[]) =>
        typeof args[0] === "function"
          ? withDeferredDbHooks(() => value.apply(target, args))
          : value.apply(target, args);
    },
  });
}
