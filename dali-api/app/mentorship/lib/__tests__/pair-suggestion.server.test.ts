import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server", () => ({ prisma: { mentorshipPair: { findMany: vi.fn(), findFirst: vi.fn() } } }));
vi.mock("~/lib/roles", () => ({ currentTerm: vi.fn() }));

import { prisma } from "~/lib/db.server";
import { currentTerm } from "~/lib/roles";
import { findMentorPair, listMentorPairs } from "../pair-suggestion.server";

const m = prisma as any;

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(currentTerm).mockResolvedValue({ id: "t1" } as never);
});

describe("listMentorPairs", () => {
  it("lists the viewer's mentees this term by name", async () => {
    m.mentorshipPair.findMany.mockResolvedValue([
      { menteeUserId: "mia", mentee: { firstName: "Mia", lastName: "Chen" } },
      { menteeUserId: "noa", mentee: { firstName: "Noa", lastName: "Park" } },
    ]);

    expect(await listMentorPairs("me")).toEqual([
      { menteeId: "mia", menteeName: "Mia Chen" },
      { menteeId: "noa", menteeName: "Noa Park" },
    ]);
    expect(m.mentorshipPair.findMany.mock.calls[0][0].where).toEqual({ mentorUserId: "me", termId: "t1" });
  });

  it("names a mentee once when the pair spans several projects or domains", async () => {
    const row = { menteeUserId: "mia", mentee: { firstName: "Mia", lastName: "Chen" } };
    m.mentorshipPair.findMany.mockResolvedValue([row, row]);

    expect(await listMentorPairs("me")).toHaveLength(1);
  });

  it("is empty with no term, and asks nothing", async () => {
    vi.mocked(currentTerm).mockResolvedValue(null as never);

    expect(await listMentorPairs("me")).toEqual([]);
    expect(m.mentorshipPair.findMany).not.toHaveBeenCalled();
  });
});

describe("findMentorPair", () => {
  it("finds the pair as the mentor, in the current term", async () => {
    m.mentorshipPair.findFirst.mockResolvedValue({
      mentorUserId: "me",
      menteeUserId: "mia",
      projectId: "p1",
      termId: "t1",
      domainId: "d1",
    });

    expect(await findMentorPair("me", "mia")).toEqual({
      mentorId: "me",
      menteeId: "mia",
      projectId: "p1",
      termId: "t1",
      domainId: "d1",
    });
    expect(m.mentorshipPair.findFirst.mock.calls[0][0].where).toEqual({
      mentorUserId: "me",
      menteeUserId: "mia",
      termId: "t1",
    });
  });

  it("does not find a pair where the viewer is the mentee", async () => {
    m.mentorshipPair.findFirst.mockResolvedValue(null);

    expect(await findMentorPair("mia", "me")).toBeNull();
  });

  it("is null with no term", async () => {
    vi.mocked(currentTerm).mockResolvedValue(null as never);

    expect(await findMentorPair("me", "mia")).toBeNull();
    expect(m.mentorshipPair.findFirst).not.toHaveBeenCalled();
  });
});
