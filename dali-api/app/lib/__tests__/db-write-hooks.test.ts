import { afterEach, describe, expect, it, vi } from "vitest";
import { onDbOperation, runDbOperationHooks } from "~/lib/db-write-hooks";

const registered: string[] = [];
const register = (name: string, hook: Parameters<typeof onDbOperation>[1]) => {
  registered.push(name);
  onDbOperation(name, hook);
};

afterEach(() => {
  for (const name of registered.splice(0)) onDbOperation(name, () => {});
  vi.restoreAllMocks();
});

describe("db operation hooks", () => {
  it("passes each operation's model and name to every hook", () => {
    const a = vi.fn();
    const b = vi.fn();
    register("test-a", a);
    register("test-b", b);
    runDbOperationHooks("CoreAssignment", "update");
    expect(a).toHaveBeenCalledWith("CoreAssignment", "update");
    expect(b).toHaveBeenCalledWith("CoreAssignment", "update");
  });

  it("passes an undefined model through for raw queries", () => {
    const hook = vi.fn();
    register("test-raw", hook);
    runDbOperationHooks(undefined, "$executeRaw");
    expect(hook).toHaveBeenCalledWith(undefined, "$executeRaw");
  });

  it("re-registering a name replaces the hook instead of adding a second", () => {
    const first = vi.fn();
    const second = vi.fn();
    register("test-same", first);
    register("test-same", second);
    runDbOperationHooks("Activity", "delete");
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();
  });

  it("a throwing hook is logged and doesn't stop the others or throw", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const after = vi.fn();
    register("test-throw", () => {
      throw new Error("boom");
    });
    register("test-after", after);
    expect(() => runDbOperationHooks("Activity", "update")).not.toThrow();
    expect(after).toHaveBeenCalledOnce();
    expect(err).toHaveBeenCalledWith("[db-hooks] hook failed", "boom");
  });
});
