import { afterEach, describe, expect, it, vi } from "vitest";
import { onDbOperation } from "~/lib/db-write-hooks";
import {
  deferHooksInTransactions,
  runOrDeferDbOperationHooks,
  withDeferredDbHooks,
} from "~/lib/db-transaction-hooks";

const hook = vi.fn();
onDbOperation("tx-test", hook);

afterEach(() => {
  hook.mockReset();
  vi.restoreAllMocks();
});

const tick = () => new Promise((r) => setImmediate(r));

describe("runOrDeferDbOperationHooks", () => {
  it("runs immediately outside a transaction", () => {
    runOrDeferDbOperationHooks("Term", "update");
    expect(hook).toHaveBeenCalledExactlyOnceWith("Term", "update");
  });
});

describe("withDeferredDbHooks", () => {
  it("holds hooks during the transaction and runs them after it commits", async () => {
    const seenInside: number[] = [];
    await withDeferredDbHooks(async () => {
      runOrDeferDbOperationHooks("CoreAssignment", "create");
      await tick();
      seenInside.push(hook.mock.calls.length);
    });
    expect(seenInside).toEqual([0]);
    expect(hook).toHaveBeenCalledExactlyOnceWith("CoreAssignment", "create");
  });

  it("runs each distinct model and operation once", async () => {
    await withDeferredDbHooks(async () => {
      for (let i = 0; i < 5; i++) runOrDeferDbOperationHooks("CoreAssignment", "create");
      runOrDeferDbOperationHooks("CoreAssignment", "delete");
      runOrDeferDbOperationHooks("AdminMembership", "create");
    });
    expect(hook.mock.calls).toEqual([
      ["CoreAssignment", "create"],
      ["CoreAssignment", "delete"],
      ["AdminMembership", "create"],
    ]);
  });

  it("flushes the hooks and rethrows when the transaction rolls back", async () => {
    await expect(
      withDeferredDbHooks(async () => {
        runOrDeferDbOperationHooks("CoreAssignment", "create");
        throw new Error("rollback");
      }),
    ).rejects.toThrow("rollback");
    expect(hook).toHaveBeenCalledExactlyOnceWith("CoreAssignment", "create");
  });

  it("a transaction opened by work left over from a closed one defers its own hooks", async () => {
    let lateTransaction!: () => Promise<void>;
    await withDeferredDbHooks(async () => {
      lateTransaction = () =>
        withDeferredDbHooks(async () => {
          runOrDeferDbOperationHooks("Term", "update");
          expect(hook).not.toHaveBeenCalled();
        });
    });
    await lateTransaction();
    expect(hook).toHaveBeenCalledExactlyOnceWith("Term", "update");
  });

  it("returns the callback's result", async () => {
    await expect(withDeferredDbHooks(async () => 42)).resolves.toBe(42);
  });

  it("does not fail a committed transaction when a hook throws", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    hook.mockImplementation(() => {
      throw new Error("boom");
    });
    await expect(
      withDeferredDbHooks(async () => {
        runOrDeferDbOperationHooks("Term", "update");
        return "ok";
      }),
    ).resolves.toBe("ok");
  });

  it("keeps concurrent transactions apart", async () => {
    const order: string[] = [];
    hook.mockImplementation((model: string) => order.push(`hook:${model}`));
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const slow = withDeferredDbHooks(async () => {
      runOrDeferDbOperationHooks("Term", "update");
      await gate;
      order.push("slow-commit");
    });
    const failing = withDeferredDbHooks(async () => {
      runOrDeferDbOperationHooks("Domain", "update");
      throw new Error("x");
    }).catch(() => order.push("failed"));
    await failing;
    expect(order).toEqual(["hook:Domain", "failed"]);
    release();
    await slow;
    expect(order).toEqual(["hook:Domain", "failed", "slow-commit", "hook:Term"]);
  });

  it("an outside write during a transaction still runs immediately", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const tx = withDeferredDbHooks(async () => {
      runOrDeferDbOperationHooks("Term", "update");
      await gate;
    });
    runOrDeferDbOperationHooks("Domain", "update");
    expect(hook).toHaveBeenCalledExactlyOnceWith("Domain", "update");
    release();
    await tx;
    expect(hook).toHaveBeenCalledTimes(2);
  });

  it("runs a late operation immediately once the transaction has closed", async () => {
    let late!: () => void;
    await withDeferredDbHooks(async () => {
      late = () => runOrDeferDbOperationHooks("Term", "update");
    });
    late();
    expect(hook).toHaveBeenCalledExactlyOnceWith("Term", "update");
  });

  it("a nested call flushes with the outer transaction", async () => {
    await withDeferredDbHooks(async () => {
      await withDeferredDbHooks(async () => runOrDeferDbOperationHooks("Term", "update"));
      expect(hook).not.toHaveBeenCalled();
    });
    expect(hook).toHaveBeenCalledOnce();
  });
});

describe("deferHooksInTransactions", () => {
  const fakeClient = () => {
    const client = {
      marker: "m",
      user: { findMany: vi.fn() },
      $transaction: vi.fn(async function (this: unknown, arg: unknown, options?: unknown) {
        if (typeof arg === "function") return (arg as (tx: unknown) => unknown)({ tx: true });
        return Promise.all(arg as Promise<unknown>[]);
      }),
      $queryRaw: vi.fn(function (this: unknown) {
        return this;
      }),
    };
    return client;
  };

  it("defers hooks fired inside an interactive callback until it resolves", async () => {
    const client = deferHooksInTransactions(fakeClient());
    const result = await client.$transaction(async (tx: unknown) => {
      runOrDeferDbOperationHooks("CoreAssignment", "update");
      expect(hook).not.toHaveBeenCalled();
      return tx;
    });
    expect(result).toEqual({ tx: true });
    expect(hook).toHaveBeenCalledOnce();
  });

  it("flushes hooks when the interactive transaction rejects", async () => {
    const client = deferHooksInTransactions(fakeClient());
    await expect(
      client.$transaction(async () => {
        runOrDeferDbOperationHooks("CoreAssignment", "update");
        throw new Error("rollback");
      }),
    ).rejects.toThrow("rollback");
    expect(hook).toHaveBeenCalledOnce();
  });

  it("passes the array form and its options through untouched", async () => {
    const base = fakeClient();
    const client = deferHooksInTransactions(base);
    const ops = [Promise.resolve(1), Promise.resolve(2)];
    await expect(client.$transaction(ops, { isolationLevel: "Serializable" } as never)).resolves.toEqual([1, 2]);
    expect(base.$transaction).toHaveBeenCalledWith(ops, { isolationLevel: "Serializable" });
  });

  it("forwards options on the interactive form", async () => {
    const base = fakeClient();
    const client = deferHooksInTransactions(base);
    const fn = async () => 1;
    await client.$transaction(fn, { timeout: 5000 } as never);
    expect(base.$transaction).toHaveBeenCalledWith(fn, { timeout: 5000 });
  });

  it("leaves models and other members alone, and binds $ methods to the real client", () => {
    const base = fakeClient();
    const client = deferHooksInTransactions(base);
    expect(client.marker).toBe("m");
    expect(client.user).toBe(base.user);
    expect(client.$queryRaw()).toBe(base);
  });
});
