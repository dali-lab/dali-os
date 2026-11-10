import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "~/lib/db.server";
import { bumpLastActive, resetLastActiveThrottle } from "~/lib/auth";
import { makeUser } from "../../../integration/factories-misc";

beforeEach(() => resetLastActiveThrottle());

const lastActive = async (id: string) => (await prisma.user.findUniqueOrThrow({ where: { id } })).lastActiveAt;

describe("bumpLastActive SQL guard", () => {
  it("stamps a user who has never been active", async () => {
    const u = await makeUser();
    expect(await lastActive(u.id)).toBeNull();
    await bumpLastActive(u.id);
    const at = await lastActive(u.id);
    expect(at).not.toBeNull();
    expect(Math.abs(Date.now() - at!.getTime())).toBeLessThan(60_000);
  });

  it("does not rewrite a stamp newer than 60s even when the process throttle is cold", async () => {
    const u = await makeUser();
    const recent = new Date(Date.now() - 30_000);
    await prisma.user.update({ where: { id: u.id }, data: { lastActiveAt: recent } });
    await bumpLastActive(u.id);
    expect((await lastActive(u.id))!.getTime()).toBe(recent.getTime());
  });

  it("refreshes a stamp older than 60s", async () => {
    const u = await makeUser();
    const old = new Date(Date.now() - 120_000);
    await prisma.user.update({ where: { id: u.id }, data: { lastActiveAt: old } });
    await bumpLastActive(u.id);
    expect((await lastActive(u.id))!.getTime()).toBeGreaterThan(old.getTime() + 100_000);
  });

  it("only touches the given user and tolerates an unknown id", async () => {
    const a = await makeUser();
    const b = await makeUser();
    await bumpLastActive(a.id);
    await bumpLastActive("missing");
    expect(await lastActive(a.id)).not.toBeNull();
    expect(await lastActive(b.id)).toBeNull();
  });
});
