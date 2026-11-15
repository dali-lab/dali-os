import { afterEach, describe, expect, it } from "vitest";
import { slackSendAllowed } from "../send-gate";

afterEach(() => {
  delete process.env.DALI_APP_ENV;
  delete process.env.NOTIFY_SLACK_DM_OVERRIDE;
});

describe("slackSendAllowed", () => {
  it("allows prod", () => {
    process.env.DALI_APP_ENV = "prod";
    expect(slackSendAllowed()).toBe(true);
  });

  it.each(["staging", "dev"])("blocks %s", (env) => {
    process.env.DALI_APP_ENV = env;
    expect(slackSendAllowed()).toBe(false);
  });

  it("allows non-prod with the override set to 1", () => {
    process.env.DALI_APP_ENV = "staging";
    process.env.NOTIFY_SLACK_DM_OVERRIDE = "1";
    expect(slackSendAllowed()).toBe(true);
  });

  it("ignores other override values", () => {
    process.env.DALI_APP_ENV = "staging";
    process.env.NOTIFY_SLACK_DM_OVERRIDE = "true";
    expect(slackSendAllowed()).toBe(false);
  });
});
