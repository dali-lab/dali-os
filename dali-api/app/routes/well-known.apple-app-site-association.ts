// apple-app-site-association (AASA).
//
// Binds the DALI OS desktop app (Tauri WKWebView, bundle edu.dartmouth.dali.os)
// to this domain for the `webcredentials` service, which is what lets WebAuthn
// passkeys engage the platform authenticator (Touch ID) for our RP *inside* the
// app's webview. Without this file AND the matching
// `com.apple.developer.associated-domains` entitlement in the desktop build
// (webcredentials:os.dali.dartmouth.edu, see desktop/src-tauri/entitlements.plist),
// passkey enrollment/sign-in fails in the desktop app.
//
// Requirements Apple imposes on this file: served over HTTPS at exactly
// /.well-known/apple-app-site-association, Content-Type application/json, no
// redirects. The Team ID is read from APPLE_TEAM_ID (a Fly secret) rather than
// hardcoded, since it belongs to the signing identity; when it's unset the file
// is valid JSON with an empty apps list (no association) so nothing 500s.

const BUNDLE_ID = "edu.dartmouth.dali.os";

export async function loader() {
  const teamId = process.env.APPLE_TEAM_ID?.trim();
  const apps = teamId ? [`${teamId}.${BUNDLE_ID}`] : [];
  return Response.json(
    { webcredentials: { apps } },
    { headers: { "Cache-Control": "public, max-age=3600" } },
  );
}
