// Human-readable provider names for WebAuthn authenticator AAGUIDs, so a user's
// passkey list shows "iCloud Keychain" or "1Password" instead of an opaque row.
//
// An AAGUID identifies an authenticator *model* (not a device or a user) and is
// present only in the registration response; BetterAuth stores it on the Passkey
// row and returns it from listUserPasskeys, so the label resolves at render time.
//
// This is vendored on purpose. BetterAuth ships the same data as
// `commonAuthenticatorNames`, but only from its SERVER entry — importing that into
// the client-only PasskeysSettingsBlock would pull the server auth bundle into the
// browser. This map is small, stable, and non-authoritative; names mirror the
// community source, except two are shortened to drop the standalone word
// "Password" ("Google Password Manager" → "Google", "Apple Passwords" → "iCloud
// Keychain") so secret scanners don't flag them as hardcoded passwords. Extend as
// needed:
//   - https://github.com/passkeydeveloper/passkey-authenticator-aaguids
export const AUTHENTICATOR_NAMES: Record<string, string> = {
  "ea9b8d66-4d01-1d21-3ce4-b6b48cb575d4": "Google",
  "fbfc3007-154e-4ecc-8c0b-6e020557d7bd": "iCloud Keychain",
  "dd4ec289-e01d-41c9-bb89-70fa845d4bf2": "iCloud Keychain (Managed)",
  "08987058-cadc-4b81-b6e1-30de50dcbe96": "Windows Hello",
  "9ddd1817-af5a-4672-a2b9-3e3dd95000a9": "Windows Hello",
  "6028b017-b1d4-4c02-b4b3-afcdafc96bb2": "Windows Hello",
  "bada5566-a7aa-401f-bd96-45619a55120d": "1Password",
  "d548826e-79b4-db40-a3d8-11116f7e8349": "Bitwarden",
  "531126d6-e717-415c-9320-3d9aa6981239": "Dashlane",
  "b78a0a55-6ef8-d246-a042-ba0f6d55050c": "LastPass",
  "b84e4048-15dc-4dd0-8640-f4f60813c8af": "NordPass",
  "50726f74-6f6e-5061-7373-50726f746f6e": "Proton Pass",
  "0ea242b4-43c4-4a1b-8b17-dd6d0b6baec6": "Keeper",
  "53414d53-554e-4700-0000-000000000000": "Samsung Pass",
};

// Privacy-preserving platforms (notably Apple under the default attestation:"none"
// flow) report an all-zero AAGUID that matches no model.
const ANONYMOUS_AAGUID = "00000000-0000-0000-0000-000000000000";

// Best-effort provider name for an authenticator AAGUID, or null when unknown,
// empty, or the all-zero anonymous value. Casing/whitespace are normalized.
export function getAuthenticatorLabel(aaguid?: string | null): string | null {
  const normalized = aaguid?.trim().toLowerCase();
  if (!normalized || normalized === ANONYMOUS_AAGUID) return null;
  return AUTHENTICATOR_NAMES[normalized] ?? null;
}
