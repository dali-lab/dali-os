import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server");
vi.mock("~/lib/auth", () => ({ requireMemberSession: vi.fn() }));
vi.mock("~/lib/ai.server", () => ({
  isAiEnabled: vi.fn(() => false),
  generateShortText: vi.fn(),
  stripJsonFences: (text: string) => text.trim(),
}));
vi.mock("~/lib/ai-quota.server", () => ({ claimAiQuota: vi.fn() }));
vi.mock("~/members/lib/contact-email.server", () => ({ chooseContactEmail: vi.fn() }));
vi.mock("~/alumni/lib/alumni-history.server", () => ({ reportHistoryCorrection: vi.fn() }));
vi.mock("~/members/lib/profile-update.server", async () => {
  const { BadRequestError, ConflictError } = await import("~/lib/http-error");
  class ProfileValidationError extends BadRequestError {
    constructor(
      public field: string,
      message: string,
    ) {
      super(message);
    }
  }
  class ProfileConflictError extends ConflictError {
    constructor(
      public field: string,
      message: string,
    ) {
      super(message);
    }
  }
  return { updateProfileFields: vi.fn(), ProfileValidationError, ProfileConflictError };
});

import { mockedPrisma } from "~/test-utils/prisma";
import { requireMemberSession } from "~/lib/auth";
import { isAiEnabled, generateShortText } from "~/lib/ai.server";
import { claimAiQuota } from "~/lib/ai-quota.server";
import { chooseContactEmail } from "~/members/lib/contact-email.server";
import { BadRequestError } from "~/lib/http-error";
import { reportHistoryCorrection } from "~/alumni/lib/alumni-history.server";
import {
  updateProfileFields,
  ProfileValidationError,
} from "~/members/lib/profile-update.server";
import { QUEST_FIELDS } from "~/alumni/lib/quest";
import { action } from "../api.alumni-game.quest";

const db = mockedPrisma();

const post = (body: unknown) =>
  action({
    request: new Request("https://os.example/api/alumni-game/quest", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    }),
  } as never) as Promise<Response>;

const emptyUser = {
  firstName: "Ada",
  lastName: "Lovelace",
  daliEmail: "ada@dali.dartmouth.edu",
  dartmouthEmail: null,
  personalEmail: null,
  preferredEmail: null,
  classYear: null,
  currentLocation: null,
  hometown: null,
  birthday: null,
  majors: [] as string[],
  minors: [] as string[],
  askMeAbout: [] as string[],
  funFact: null,
  outsideOfWork: null,
  dietaryRestrictions: null,
  linkedinUrl: null,
  personalSite: null,
};

const fullUser = {
  ...emptyUser,
  personalEmail: "ada@example.com",
  classYear: 2019,
  currentLocation: "Brooklyn, New York, United States",
  hometown: "Austin",
  birthday: new Date("2001-06-05T00:00:00Z"),
  majors: ["Computer Science"],
  minors: ["Studio Art"],
  askMeAbout: ["Grad school"],
  funFact: "Builds analog synths",
  outsideOfWork: "Climbing",
  dietaryRestrictions: "Vegetarian",
  linkedinUrl: "https://linkedin.com/in/x",
  personalSite: "https://x.dev",
};

const ALL_CONFIRMED = ["name", "email", "work", "pastWork", "history", "openTo"];

function mockState(user: object, confirmed: string[], workCount = 0) {
  db.user.findUniqueOrThrow.mockResolvedValue(user as never);
  db.pixelAvatar.findUnique.mockResolvedValue({ userId: "u1", confirmedFields: confirmed } as never);
  db.workExperience.count.mockResolvedValue(workCount as never);
  db.projectAssignment.findMany.mockResolvedValue([] as never);
  db.coreAssignment.findMany.mockResolvedValue([] as never);
  db.domainLeadAssignment.findMany.mockResolvedValue([] as never);
}

function aiReply(json: string) {
  vi.mocked(isAiEnabled).mockReturnValue(true);
  vi.mocked(claimAiQuota).mockResolvedValue({ ok: true, day: "2026-11-15", used: 1 } as never);
  vi.mocked(generateShortText).mockResolvedValue({
    text: json,
    inputTokens: 10,
    outputTokens: 20,
    stopReason: "end_turn",
  } as never);
  db.aiUsage.update.mockResolvedValue({} as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isAiEnabled).mockReturnValue(false);
  vi.mocked(requireMemberSession).mockResolvedValue({
    ok: true,
    auth: { user: { sub: "u1", firstName: "Ada" } },
  } as never);
  mockState(emptyUser, []);
  db.pixelAvatar.updateMany.mockResolvedValue({ count: 1 } as never);
  db.workExperience.create.mockResolvedValue({} as never);
  db.user.update.mockResolvedValue({} as never);
  db.alumniChatMessage.createMany.mockResolvedValue({ count: 2 } as never);
  vi.mocked(updateProfileFields).mockResolvedValue({ updated: {} });
});

describe("POST /api/alumni-game/quest", () => {
  it("rejects a caller without a member session", async () => {
    vi.mocked(requireMemberSession).mockResolvedValue({
      ok: false,
      response: new Response("no", { status: 403 }),
    } as never);
    const res = await post({ intent: "accept" });
    expect(res.status).toBe(403);
  });

  it("rejects an unknown intent", async () => {
    const res = await post({ intent: "cheat" });
    expect(res.status).toBe(400);
  });

  describe("accept", () => {
    it("requires an avatar before the quest can start", async () => {
      db.pixelAvatar.findUnique.mockResolvedValue(null as never);
      const res = await post({ intent: "accept" });
      expect(res.status).toBe(400);
      expect(db.pixelAvatar.updateMany).not.toHaveBeenCalled();
    });

    it("stamps questAcceptedAt and asks the name confirm with the name on file", async () => {
      const res = await post({ intent: "accept" });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.percent).toBe(0);
      expect(db.pixelAvatar.updateMany).toHaveBeenCalledWith({
        where: { userId: "u1", questAcceptedAt: null },
        data: { questAcceptedAt: expect.any(Date) },
      });
      expect(body.messages).toHaveLength(2);
      expect(body.messages[1].text).toContain("Ada Lovelace");
      expect(db.alumniChatMessage.createMany).toHaveBeenCalledWith({
        data: body.messages.map((m: { from: string; text: string }) => ({
          userId: "u1",
          from: m.from,
          text: m.text,
        })),
      });
    });
  });

  describe("answer", () => {
    it("rejects a field that is not part of the quest", async () => {
      const res = await post({ intent: "answer", field: "walletPassSecret", value: "x" });
      expect(res.status).toBe(400);
      expect(updateProfileFields).not.toHaveBeenCalled();
    });

    it("rejects an empty answer", async () => {
      const res = await post({ intent: "answer", field: "majors", value: "   " });
      expect(res.status).toBe(400);
      expect(updateProfileFields).not.toHaveBeenCalled();
    });

    it("writes a list answer through the shared profile updater", async () => {
      const res = await post({ intent: "answer", field: "majors", value: "  CS  " });
      expect(res.status).toBe(200);
      expect(updateProfileFields).toHaveBeenCalledWith(
        "u1",
        { majors: ["CS"] },
        { allowNetId: false },
      );
      const body = await res.json();
      expect(body.savedField).toBe("majors");
      expect(Object.keys(body.profile).sort()).toEqual(
        QUEST_FIELDS.map((f) => f.key).sort(),
      );
    });

    it("surfaces a validation error as the chat reply", async () => {
      vi.mocked(updateProfileFields).mockRejectedValue(
        new ProfileValidationError("classYear", "Class year must be a 4-digit year."),
      );
      const res = await post({ intent: "answer", field: "classYear", value: "1999" });
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("Class year must be a 4-digit year.");
    });

    it("confirms the name on a yes without rewriting it", async () => {
      const res = await post({ intent: "answer", field: "name", value: "yep!" });
      const body = await res.json();
      expect(body.savedField).toBe("name");
      expect(updateProfileFields).not.toHaveBeenCalled();
      expect(db.pixelAvatar.updateMany).toHaveBeenCalledWith({
        where: { userId: "u1", NOT: { confirmedFields: { has: "name" } } },
        data: { confirmedFields: { push: "name" } },
      });
    });

    it("saves a corrected name as first and last", async () => {
      await post({ intent: "answer", field: "name", value: "Ada King Lovelace" });
      expect(updateProfileFields).toHaveBeenCalledWith(
        "u1",
        { firstName: "Ada", lastName: "King Lovelace" },
        { allowNetId: false },
      );
    });

    it("probes instead of saving when a name answer has no full name", async () => {
      const res = await post({ intent: "answer", field: "name", value: "hmm" });
      const body = await res.json();
      expect(body.savedField).toBeNull();
      expect(updateProfileFields).not.toHaveBeenCalled();
      expect(body.say).toContain("full name");
    });

    it("starts verification for a new outside address and never writes personalEmail", async () => {
      vi.mocked(chooseContactEmail).mockResolvedValue({ status: "code_sent" });
      const res = await post({ intent: "answer", field: "email", value: "use Ada@New.com please" });
      const body = await res.json();
      expect(chooseContactEmail).toHaveBeenCalledWith(expect.objectContaining({ userId: "u1", address: "ada@new.com" }));
      expect(body.savedField).toBe("email");
      expect(body.say).toContain("ada@new.com");
      expect(body.say).toContain("check your inbox");
      expect(db.user.update).not.toHaveBeenCalled();
    });

    it("saves the preference once an outside address is already proven", async () => {
      vi.mocked(chooseContactEmail).mockResolvedValue({ status: "switched" });
      const res = await post({ intent: "answer", field: "email", value: "ada@new.com" });
      expect((await res.json()).savedField).toBe("email");
      expect(db.user.update).toHaveBeenCalledWith({ where: { id: "u1" }, data: { preferredEmail: "ada@new.com" } });
    });

    it("refuses an address that belongs to another account without a server error", async () => {
      vi.mocked(chooseContactEmail).mockRejectedValue(new BadRequestError("That email is on another DALI OS account. Ask DALI staff to merge them."));
      const res = await post({ intent: "answer", field: "email", value: "grace@example.com" });
      expect(res.status).toBe(400);
      expect((await res.json()).error).toContain("another DALI OS account");
      expect(db.user.update).not.toHaveBeenCalled();
    });

    it("sets an institutional address of their own directly, without verification", async () => {
      const res = await post({
        intent: "answer",
        field: "email",
        value: "ada@dali.dartmouth.edu works",
      });
      const body = await res.json();
      expect(body.savedField).toBe("email");
      expect(chooseContactEmail).not.toHaveBeenCalled();
      expect(db.user.update).toHaveBeenCalledWith({
        where: { id: "u1" },
        data: { preferredEmail: "ada@dali.dartmouth.edu" },
      });
    });

    it("probes when an email answer contains no address or confirmation", async () => {
      const res = await post({ intent: "answer", field: "email", value: "the blue one" });
      const body = await res.json();
      expect(body.savedField).toBeNull();
      expect(updateProfileFields).not.toHaveBeenCalled();
    });

    it("creates a work experience row from 'role at company'", async () => {
      const res = await post({ intent: "answer", field: "work", value: "designer at Google" });
      const body = await res.json();
      expect(body.savedField).toBe("work");
      expect(db.workExperience.create).toHaveBeenCalledWith({
        data: {
          userId: "u1",
          company: "Google",
          position: "designer",
          startDate: expect.any(Date),
        },
      });
    });

    it("confirms work without a row when they're between jobs", async () => {
      const res = await post({ intent: "answer", field: "work", value: "between jobs right now" });
      const body = await res.json();
      expect(body.savedField).toBe("work");
      expect(db.workExperience.create).not.toHaveBeenCalled();
    });

    it("confirms the DALI history on a yes without storing a note", async () => {
      const res = await post({ intent: "answer", field: "history", value: "looks right to me" });
      const body = await res.json();
      expect(body.savedField).toBe("history");
      expect(db.pixelAvatar.updateMany).toHaveBeenCalledWith({
        where: { userId: "u1", NOT: { confirmedFields: { has: "history" } } },
        data: { confirmedFields: { push: "history" } },
      });
      expect(reportHistoryCorrection).not.toHaveBeenCalled();
    });

    it("sends a history correction to Core, flags it, and still confirms", async () => {
      const res = await post({
        intent: "answer",
        field: "history",
        value: "I was never on the kiosk project",
      });
      const body = await res.json();
      expect(body.savedField).toBe("history");
      expect(reportHistoryCorrection).toHaveBeenCalledWith("u1", "I was never on the kiosk project");
      expect(db.pixelAvatar.updateMany).toHaveBeenCalledWith({
        where: { userId: "u1", NOT: { confirmedFields: { has: "history" } } },
        data: { confirmedFields: { push: "history" } },
      });
      expect(body.say).toContain("flagged");
    });

    it("sends the model's history note to Core when it reports a correction", async () => {
      aiReply(
        '{"field":"history","value":"confirmed","work":null,"openTo":null,"note":"missing the robotics project","reply":"aah noted, I flagged that for the team!"}',
      );
      const res = await post({ intent: "answer", field: "history", value: "the robotics one is missing" });
      const body = await res.json();
      expect(body.savedField).toBe("history");
      expect(reportHistoryCorrection).toHaveBeenCalledWith("u1", "missing the robotics project");
    });

    it("saves a parsed birthday as YYYY-MM-DD through the profile updater", async () => {
      const res = await post({ intent: "answer", field: "birthday", value: "June 5, 2001" });
      const body = await res.json();
      expect(body.savedField).toBe("birthday");
      expect(updateProfileFields).toHaveBeenCalledWith(
        "u1",
        { birthday: "2001-06-05" },
        { allowNetId: false },
      );
    });

    it("probes instead of saving an unparseable birthday", async () => {
      const res = await post({ intent: "answer", field: "birthday", value: "in the summer sometime" });
      const body = await res.json();
      expect(body.savedField).toBeNull();
      expect(updateProfileFields).not.toHaveBeenCalled();
    });

    it("sets the open-to toggles from the named reviews", async () => {
      const res = await post({
        intent: "answer",
        field: "openTo",
        value: "coffee chats and portfolio reviews!",
      });
      const body = await res.json();
      expect(body.savedField).toBe("openTo");
      expect(updateProfileFields).toHaveBeenCalledWith(
        "u1",
        {
          openTo: {
            coffeeChats: true,
            resumeReviews: true,
            portfolioReviews: true,
            partnerReferrals: false,
            mentoring: false,
            speaking: false,
          },
        },
        { allowNetId: false },
      );
    });

    it("turns every toggle off on a clear no", async () => {
      await post({ intent: "answer", field: "openTo", value: "none for now" });
      expect(updateProfileFields).toHaveBeenCalledWith(
        "u1",
        {
          openTo: {
            coffeeChats: false,
            resumeReviews: false,
            portfolioReviews: false,
            partnerReferrals: false,
            mentoring: false,
            speaking: false,
          },
        },
        { allowNetId: false },
      );
    });

    it("reads mentoring, speaking and partner referrals from the answer", async () => {
      await post({ intent: "answer", field: "openTo", value: "happy to mentor and give a talk, and refer a partner" });
      expect(vi.mocked(updateProfileFields).mock.calls[0][1]).toEqual({
        openTo: {
          coffeeChats: false,
          resumeReviews: false,
          portfolioReviews: false,
          partnerReferrals: true,
          mentoring: true,
          speaking: true,
        },
      });
    });

    it("splits an ask me about answer into topics", async () => {
      const res = await post({ intent: "answer", field: "askMeAbout", value: "grad school, moving to NYC; startups" });
      expect((await res.json()).savedField).toBe("askMeAbout");
      expect(updateProfileFields).toHaveBeenCalledWith(
        "u1",
        { askMeAbout: ["grad school", "moving to NYC", "startups"] },
        { allowNetId: false },
      );
    });

    it("saves the job before that with the year they left", async () => {
      const res = await post({ intent: "answer", field: "pastWork", value: "design intern at Etsy, 2023" });
      expect((await res.json()).savedField).toBe("pastWork");
      const left = new Date(Date.UTC(2023, 0, 1));
      expect(db.workExperience.create).toHaveBeenCalledWith({
        data: { userId: "u1", company: "Etsy", position: "design intern", startDate: left, endDate: left },
      });
      expect(db.pixelAvatar.updateMany).toHaveBeenCalledWith({
        where: { userId: "u1", NOT: { confirmedFields: { has: "pastWork" } } },
        data: { confirmedFields: { push: "pastWork" } },
      });
    });

    it("probes for the year instead of saving the job before that without one", async () => {
      const res = await post({ intent: "answer", field: "pastWork", value: "design intern at Etsy" });
      expect((await res.json()).savedField).toBeNull();
      expect(db.workExperience.create).not.toHaveBeenCalled();
    });

    it("marks onboarding done once no unskipped questions are left", async () => {
      mockState(emptyUser, ["name", "email"]);
      const skipped = QUEST_FIELDS.map((f) => f.key).filter((k) => k !== "hometown");
      await post({ intent: "answer", field: "hometown", value: "Austin", skipped });
      expect(db.user.updateMany).not.toHaveBeenCalled();
      vi.mocked(updateProfileFields).mockImplementation(async () => {
        mockState({ ...emptyUser, hometown: "Austin" }, ["name", "email"]);
        return { updated: {} };
      });
      await post({ intent: "answer", field: "hometown", value: "Austin", skipped });
      expect(db.user.updateMany).toHaveBeenCalledWith({
        where: { id: "u1", alumniOnboardedAt: null },
        data: { alumniOnboardedAt: expect.any(Date) },
      });
    });

    it("stamps questCompletedAt once every field is filled", async () => {
      mockState(fullUser, ALL_CONFIRMED, 1);
      const res = await post({ intent: "answer", field: "personalSite", value: "https://x.dev" });
      const body = await res.json();
      expect(body.percent).toBe(100);
      expect(db.pixelAvatar.updateMany).toHaveBeenCalledWith({
        where: { userId: "u1", questCompletedAt: null },
        data: { questCompletedAt: expect.any(Date) },
      });
      expect(db.user.updateMany).toHaveBeenCalledWith({
        where: { id: "u1", alumniOnboardedAt: null },
        data: { alumniOnboardedAt: expect.any(Date) },
      });
    });

    it("does not stamp completion while fields remain empty", async () => {
      const res = await post({ intent: "answer", field: "majors", value: "CS" });
      expect((await res.json()).percent).toBe(0);
      expect(db.pixelAvatar.updateMany).not.toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: "u1", questCompletedAt: null } }),
      );
    });

    it("composes a scripted reply and stores the exchange when AI is off", async () => {
      const res = await post({ intent: "answer", field: "majors", value: "CS" });
      const body = await res.json();
      expect(body.say).toContain("aah interesting!");
      expect(body.savedField).toBe("majors");
      expect(generateShortText).not.toHaveBeenCalled();
      expect(db.alumniChatMessage.createMany).toHaveBeenCalledWith({
        data: [
          { userId: "u1", from: "you", text: "CS" },
          { userId: "u1", from: "tim", text: body.say },
        ],
      });
    });

    it("uses the model's reply and saves the field it chose, including corrections", async () => {
      aiReply(
        '{"field":"hometown","value":"Austin","work":null,"openTo":null,"reply":"aah austin! and what did you major in?"}',
      );
      const res = await post({
        intent: "answer",
        field: "majors",
        value: "actually my hometown is Austin",
        history: [{ from: "you", text: "hi" }],
      });
      const body = await res.json();
      expect(body.say).toBe("aah austin! and what did you major in?");
      expect(body.savedField).toBe("hometown");
      expect(updateProfileFields).toHaveBeenCalledWith(
        "u1",
        { hometown: "Austin" },
        { allowNetId: false },
      );
      expect(generateShortText).toHaveBeenCalledWith(
        expect.objectContaining({ task: "alumniChat" }),
      );
    });

    it("saves the model's work object as a work experience row", async () => {
      aiReply(
        '{"field":"work","value":null,"work":{"company":"Figma","position":"product designer"},"openTo":null,"reply":"aah figma, so cool!!"}',
      );
      const res = await post({
        intent: "answer",
        field: "work",
        value: "i've been doing product design over at figma",
      });
      const body = await res.json();
      expect(body.savedField).toBe("work");
      expect(db.workExperience.create).toHaveBeenCalledWith({
        data: {
          userId: "u1",
          company: "Figma",
          position: "product designer",
          startDate: expect.any(Date),
        },
      });
    });

    it("saves nothing when the model probes a weird answer, and Tim re-asks", async () => {
      aiReply(
        '{"field":null,"value":null,"work":null,"openTo":null,"reply":"haha the moon! but really, where are you based?"}',
      );
      const res = await post({ intent: "answer", field: "currentLocation", value: "the moon" });
      const body = await res.json();
      expect(body.say).toBe("haha the moon! but really, where are you based?");
      expect(body.savedField).toBeNull();
      expect(updateProfileFields).not.toHaveBeenCalled();
    });

    it("saves nothing when the model rejects a deflection like idk", async () => {
      aiReply(
        '{"field":null,"value":null,"work":null,"openTo":null,"reply":"haha all good!  you can hit skip, but I would love a fun fact!"}',
      );
      const res = await post({ intent: "answer", field: "funFact", value: "idk" });
      const body = await res.json();
      expect(body.savedField).toBeNull();
      expect(updateProfileFields).not.toHaveBeenCalled();
      const [call] = vi.mocked(generateShortText).mock.calls;
      expect((call[0] as { system?: string }).system).toContain("NEVER save a deflection");
    });

    it("falls back to the scripted reply when the daily quota is spent", async () => {
      vi.mocked(isAiEnabled).mockReturnValue(true);
      vi.mocked(claimAiQuota).mockResolvedValue({
        ok: false,
        error: "limit",
        retryAfterSeconds: 60,
      } as never);
      const res = await post({ intent: "answer", field: "majors", value: "CS" });
      const body = await res.json();
      expect(body.say).toContain("aah interesting!");
      expect(body.savedField).toBe("majors");
      expect(generateShortText).not.toHaveBeenCalled();
    });

    it("falls back to the scripted parser when the model returns junk", async () => {
      aiReply("not json at all");
      const res = await post({ intent: "answer", field: "majors", value: "CS" });
      const body = await res.json();
      expect(body.savedField).toBe("majors");
      expect(updateProfileFields).toHaveBeenCalledWith("u1", { majors: ["CS"] }, { allowNetId: false });
      expect(body.say).toContain("aah interesting!");
    });
  });

  describe("finish", () => {
    it("refuses while a required question is unanswered", async () => {
      const res = await post({ intent: "finish", skipped: QUEST_FIELDS.map((f) => f.key) });
      expect(res.status).toBe(400);
      expect(db.user.updateMany).not.toHaveBeenCalled();
    });

    it("marks onboarding done when every remaining question was skipped", async () => {
      mockState(emptyUser, ["name", "email"]);
      const res = await post({ intent: "finish", skipped: QUEST_FIELDS.map((f) => f.key) });
      expect(res.status).toBe(200);
      expect(db.user.updateMany).toHaveBeenCalledWith({
        where: { id: "u1", alumniOnboardedAt: null },
        data: { alumniOnboardedAt: expect.any(Date) },
      });
    });
  });
});
