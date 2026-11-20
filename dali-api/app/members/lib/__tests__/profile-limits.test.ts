import { describe, expect, it } from "vitest";
import * as limits from "../profile-limits";

describe("profile limits", () => {
  it("pins the values the profile form and the update action share", () => {
    expect({ ...limits }).toEqual({
      MAX_LONG_TEXT: 300,
      MAX_ASK_ME_ABOUT: 10,
      MAX_ASK_ME_ABOUT_LENGTH: 40,
      MAX_STUDY_ITEMS: 4,
      MAX_STUDY_LENGTH: 60,
    });
  });
});
