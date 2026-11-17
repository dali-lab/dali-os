import { describe, it, expect, vi } from "vitest";
import { inviteAddress, parseLaunchArgs, planLaunch, runLaunch, type LaunchArgs, type LaunchCandidate, type LaunchTarget } from "../lib/alumni-invite-launch";

const person = (id: string, over: Partial<LaunchCandidate> = {}): LaunchCandidate => ({
  id,
  firstName: id,
  email: `${id}@dartmouth.edu`,
  daliEmail: `${id}@dali.dartmouth.edu`,
  personalEmail: null,
  ...over,
});

describe("parseLaunchArgs", () => {
  it("requires a batch and defaults to a dry run on the alumni template", () => {
    expect(() => parseLaunchArgs([])).toThrow("--batch");
    expect(() => parseLaunchArgs(["--batch", "--send"])).toThrow("--batch");
    expect(parseLaunchArgs(["--batch", "b1"])).toEqual({
      batch: "b1",
      send: false,
      only: null,
      limit: null,
      templateKey: "alumni.invite",
    });
  });

  it("reads the optional flags", () => {
    const args = parseLaunchArgs(["--batch", "b1", "--send", "--only", "u1, u2", "--limit", "5"]);
    expect(args).toMatchObject({ send: true, only: ["u1", "u2"], limit: 5 });
  });

  it("rejects a bad limit, an unknown template and a template without the link", () => {
    expect(() => parseLaunchArgs(["--batch", "b1", "--limit", "0"])).toThrow("--limit");
    expect(() => parseLaunchArgs(["--batch", "b1", "--template", "nope"])).toThrow("Unknown template");
    expect(() => parseLaunchArgs(["--batch", "b1", "--template", "forms.receipt"])).toThrow("inviteLink");
  });
});

describe("inviteAddress", () => {
  it("prefers the personal email, then the work address, then the login email, normalized", () => {
    expect(inviteAddress(person("a", { personalEmail: " Ada@Example.com " }))).toBe("ada@example.com");
    expect(inviteAddress(person("a"))).toBe("a@dali.dartmouth.edu");
    expect(inviteAddress(person("a", { daliEmail: null }))).toBe("a@dartmouth.edu");
    expect(inviteAddress(person("a", { daliEmail: "", email: null }))).toBeNull();
  });
});

describe("planLaunch", () => {
  const none = { only: null, limit: null };

  it("skips people already invited in the batch and people with no address", () => {
    const plan = planLaunch(
      [person("a"), person("b"), person("c", { email: null, daliEmail: null })],
      new Set(["a"]),
      none,
    );
    expect(plan.targets.map((t) => t.userId)).toEqual(["b"]);
    expect(plan.alreadyInvited).toBe(1);
    expect(plan.noAddress).toEqual(["c"]);
  });

  it("lists who has no personal email", () => {
    const plan = planLaunch([person("a", { personalEmail: "a@example.com" }), person("b")], new Set(), none);
    expect(plan.withoutPersonal).toEqual(["b"]);
    expect(plan.targets).toHaveLength(2);
  });

  it("narrows to --only ids and caps with --limit after skipping", () => {
    const people = [person("a"), person("b"), person("c")];
    expect(planLaunch(people, new Set(), { only: ["b", "c"], limit: null }).targets.map((t) => t.userId)).toEqual(["b", "c"]);
    expect(planLaunch(people, new Set(["a"]), { only: null, limit: 1 }).targets.map((t) => t.userId)).toEqual(["b"]);
  });

  it("is idempotent: planning again after a batch was sent yields nothing", () => {
    const people = [person("a"), person("b")];
    const first = planLaunch(people, new Set(), none);
    const second = planLaunch(people, new Set(first.targets.map((t) => t.userId)), none);
    expect(second.targets).toEqual([]);
  });
});

describe("runLaunch", () => {
  const people = [person("a"), person("b", { personalEmail: "b@example.com" })];
  const deps = () => ({
    loadCandidates: vi.fn(async () => people),
    loadInvitedUserIds: vi.fn(async () => [] as string[]),
    send: vi.fn(async (_target: LaunchTarget, _args: LaunchArgs) => ({ queued: true })),
    log: vi.fn(),
  });

  it("sends nothing on a dry run, and prints the counts and who has no personal email", async () => {
    const d = deps();
    const result = await runLaunch(parseLaunchArgs(["--batch", "b1"]), d);
    expect(result).toEqual({ queued: 0 });
    expect(d.send).not.toHaveBeenCalled();
    const out = d.log.mock.calls.map((c) => c[0]).join("\n");
    expect(out).toContain("Dry run");
    expect(out).toContain("To invite: 2");
    expect(out).toContain("Without a personal email (invited at a Dartmouth address): 1");
    expect(out).toContain("  a");
  });

  it("queues one email per target with --send, and skips the batch's earlier invites on a re-run", async () => {
    const d = deps();
    const args = parseLaunchArgs(["--batch", "b1", "--send"]);
    expect(await runLaunch(args, d)).toEqual({ queued: 2 });
    expect(d.send).toHaveBeenCalledTimes(2);
    expect(d.send.mock.calls[1][0]).toEqual({ userId: "b", firstName: "b", address: "b@example.com" });

    const again = deps();
    again.loadInvitedUserIds.mockResolvedValue(["a", "b"]);
    expect(await runLaunch(args, again)).toEqual({ queued: 0 });
    expect(again.send).not.toHaveBeenCalled();
  });
});
