import { describe, it, expect, afterEach } from "vitest";
import { externalFinalizeAllowed } from "~/projects/lib/finalize-external.server";

const origAppEnv = process.env.DALI_APP_ENV;
const origOverride = process.env.FINALIZE_EXTERNAL_OVERRIDE;

afterEach(() => {
  if (origAppEnv === undefined) delete process.env.DALI_APP_ENV;
  else process.env.DALI_APP_ENV = origAppEnv;
  if (origOverride === undefined) delete process.env.FINALIZE_EXTERNAL_OVERRIDE;
  else process.env.FINALIZE_EXTERNAL_OVERRIDE = origOverride;
});

describe("externalFinalizeAllowed", () => {
  it("allows the external finalize steps in prod", () => {
    process.env.DALI_APP_ENV = "prod";
    delete process.env.FINALIZE_EXTERNAL_OVERRIDE;
    expect(externalFinalizeAllowed()).toBe(true);
  });

  it("blocks them on staging by default", () => {
    process.env.DALI_APP_ENV = "staging";
    delete process.env.FINALIZE_EXTERNAL_OVERRIDE;
    expect(externalFinalizeAllowed()).toBe(false);
  });

  it("blocks them on dev by default", () => {
    process.env.DALI_APP_ENV = "dev";
    delete process.env.FINALIZE_EXTERNAL_OVERRIDE;
    expect(externalFinalizeAllowed()).toBe(false);
  });

  it("allows a non-prod env to opt in with FINALIZE_EXTERNAL_OVERRIDE=1", () => {
    process.env.DALI_APP_ENV = "staging";
    process.env.FINALIZE_EXTERNAL_OVERRIDE = "1";
    expect(externalFinalizeAllowed()).toBe(true);
  });
});
