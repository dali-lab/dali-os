import { describe, expect, it, vi } from "vitest";

vi.mock("~/lib/db.server", () => ({ prisma: {} }));
vi.mock("~/core/components/AnnouncementsPage", () => ({ AnnouncementsPage: () => null }));

import { audienceLabel, estimateRecipients } from "~/admin/routes/admin.announcements";

const groups = new Map([
  ["g1", { name: "Design domain", memberIds: ["a", "b"] }],
  ["g2", { name: "Core", memberIds: ["b", "c"] }],
]);

describe("audienceLabel", () => {
  it("names the whole lab, the groups, and how many people were picked", () => {
    expect(audienceLabel({ allMembers: true, groupIds: ["g1"], userIds: ["x"] }, groups)).toBe("Whole lab");
    expect(audienceLabel({ allMembers: false, groupIds: ["g1", "g2"], userIds: [] }, groups)).toBe("Design domain, Core");
    expect(audienceLabel({ allMembers: false, groupIds: ["gone"], userIds: ["x", "y"] }, groups)).toBe("A group, 2 people");
    expect(audienceLabel({ allMembers: false, groupIds: [], userIds: ["x"] }, groups)).toBe("1 person");
  });
});

describe("estimateRecipients", () => {
  it("counts each person once across the lab, groups and picks", () => {
    expect(estimateRecipients({ allMembers: false, groupIds: ["g1", "g2"], userIds: ["a", "z"] }, ["a", "b", "c"], groups)).toBe(4);
    expect(estimateRecipients({ allMembers: true, groupIds: ["g1"], userIds: ["z"] }, ["a", "b", "c"], groups)).toBe(4);
    expect(estimateRecipients({ allMembers: false, groupIds: ["gone"], userIds: [] }, [], groups)).toBe(0);
  });
});
