import { describe, expect, it } from "vitest";
import { prisma } from "~/lib/db.server";
import { setSubCalendarEnabled } from "~/calendar/lib/sub-calendar.server";
import { makeCalendarLink, makeUser } from "~/lib/__tests__/integration-fixtures.calendar";

const idsOf = async (id: string) =>
  (await prisma.userCalendarLink.findUniqueOrThrow({ where: { id }, select: { subCalendarIds: true } })).subCalendarIds;

describe("setSubCalendarEnabled against Postgres", () => {
  it("appends a calendar and ignores a repeat enable", async () => {
    const link = await makeCalendarLink((await makeUser()).id, ["a"]);
    await setSubCalendarEnabled(link.id, "b", true);
    await setSubCalendarEnabled(link.id, "b", true);
    expect(await idsOf(link.id)).toEqual(["a", "b"]);
  });

  it("removes only the named calendar and tolerates one that was never on", async () => {
    const link = await makeCalendarLink((await makeUser()).id, ["a", "b", "c"]);
    await setSubCalendarEnabled(link.id, "b", false);
    await setSubCalendarEnabled(link.id, "zzz", false);
    expect(await idsOf(link.id)).toEqual(["a", "c"]);
  });

  it("only touches the link it was given", async () => {
    const ada = await makeUser();
    const grace = await makeUser("Grace", "Hopper");
    const mine = await makeCalendarLink(ada.id, ["a"]);
    const theirs = await makeCalendarLink(grace.id, ["a"], "grace@example.edu");
    await setSubCalendarEnabled(mine.id, "b", true);
    await setSubCalendarEnabled(mine.id, "a", false);
    expect(await idsOf(mine.id)).toEqual(["b"]);
    expect(await idsOf(theirs.id)).toEqual(["a"]);
  });

  it("keeps every calendar when different ones are toggled on at once", async () => {
    const link = await makeCalendarLink((await makeUser()).id);
    const calendars = Array.from({ length: 12 }, (_, i) => `cal-${i}`);
    await Promise.all(calendars.map((c) => setSubCalendarEnabled(link.id, c, true)));
    expect([...(await idsOf(link.id))].sort()).toEqual([...calendars].sort());
  });

  it("adds a calendar once when the same enable races itself", async () => {
    const link = await makeCalendarLink((await makeUser()).id);
    await Promise.all(Array.from({ length: 8 }, () => setSubCalendarEnabled(link.id, "same", true)));
    expect(await idsOf(link.id)).toEqual(["same"]);
  });

  it("an enable and a disable of different calendars do not overwrite each other", async () => {
    const link = await makeCalendarLink((await makeUser()).id, ["old"]);
    await Promise.all([setSubCalendarEnabled(link.id, "new", true), setSubCalendarEnabled(link.id, "old", false)]);
    expect(await idsOf(link.id)).toEqual(["new"]);
  });
});
