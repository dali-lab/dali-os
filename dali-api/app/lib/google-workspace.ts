import { JWT } from "google-auth-library";

// Google Workspace account provisioning via the Admin SDK Directory API. Used
// to create a member's @dali.dartmouth.edu account when they're accepted.
//
// Auth model: a Google Cloud SERVICE ACCOUNT with DOMAIN-WIDE DELEGATION,
// impersonating a Workspace super-admin (GOOGLE_WORKSPACE_ADMIN_EMAIL) for the
// admin.directory.user scope. This is the only way to call the Directory API
// for a Workspace domain. See dali-api/docs/ONBOARDING_PROVISIONING.md for the
// one-time setup (service account, delegation, env vars).
//
// We call the REST endpoint directly with a JWT access token (google-auth-
// library is already a dependency; googleapis is not, and we avoid adding it).
// Everything is gated on the env being present — when unconfigured the caller
// gets { status: "skipped" } and nothing happens, mirroring the staffing-
// finalize stub precedent.

const DIRECTORY_USERS_URL =
  "https://admin.googleapis.com/admin/directory/v1/users";
const SCOPES = ["https://www.googleapis.com/auth/admin.directory.user"];

export const WORKSPACE_DOMAIN =
  process.env.GOOGLE_WORKSPACE_DOMAIN ?? "dali.dartmouth.edu";

export type WorkspaceResult =
  | { status: "ok"; email: string; created: boolean; tempPassword?: string }
  | { status: "skipped"; message: string }
  | { status: "error"; message: string };

// Whether the Workspace integration is configured. Cheap; no network.
export function workspaceConfigured(): boolean {
  return !!(
    process.env.GOOGLE_WORKSPACE_SA_EMAIL &&
    process.env.GOOGLE_WORKSPACE_SA_PRIVATE_KEY &&
    process.env.GOOGLE_WORKSPACE_ADMIN_EMAIL
  );
}

// firstName + lastName -> first.last@<domain>, lowercased, punctuation stripped.
export function deriveDaliEmail(firstName: string, lastName: string): string {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "")
      .trim();
  const first = norm(firstName) || "member";
  const last = norm(lastName);
  const local = last ? `${first}.${last}` : first;
  return `${local}@${WORKSPACE_DOMAIN}`;
}

// 16 url-safe random chars — a throwaway initial password (the account is set
// to force a password change on first login).
function tempPassword(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function getAccessToken(): Promise<string> {
  // SA private key often arrives with escaped newlines from env; restore them.
  const key = process.env.GOOGLE_WORKSPACE_SA_PRIVATE_KEY!.replace(/\\n/g, "\n");
  const jwt = new JWT({
    email: process.env.GOOGLE_WORKSPACE_SA_EMAIL!,
    key,
    scopes: SCOPES,
    // Domain-wide delegation: act as this Workspace admin.
    subject: process.env.GOOGLE_WORKSPACE_ADMIN_EMAIL!,
  });
  const { access_token } = await jwt.authorize();
  if (!access_token) throw new Error("No access token from service account.");
  return access_token;
}

// Create the member's Workspace account. Idempotent-ish: if the account
// already exists (409), we treat it as success (created: false). Returns the
// resolved email so callers can store it / put it in the welcome message.
export async function provisionWorkspaceAccount(args: {
  firstName: string;
  lastName: string;
  // Optional recovery email (e.g. their Dartmouth address).
  recoveryEmail?: string | null;
}): Promise<WorkspaceResult> {
  if (!workspaceConfigured()) {
    return {
      status: "skipped",
      message: "Google Workspace provisioning is not configured.",
    };
  }

  const email = deriveDaliEmail(args.firstName, args.lastName);
  const password = tempPassword();

  try {
    const token = await getAccessToken();
    const res = await fetch(DIRECTORY_USERS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        primaryEmail: email,
        name: { givenName: args.firstName, familyName: args.lastName || args.firstName },
        password,
        changePasswordAtNextLogin: true,
        ...(args.recoveryEmail ? { recoveryEmail: args.recoveryEmail } : {}),
      }),
    });

    if (res.status === 409) {
      // Already exists — fine.
      return { status: "ok", email, created: false };
    }
    if (!res.ok) {
      const body = await res.text();
      return { status: "error", message: `Directory API ${res.status}: ${body.slice(0, 300)}` };
    }
    return { status: "ok", email, created: true, tempPassword: password };
  } catch (err) {
    return {
      status: "error",
      message: err instanceof Error ? err.message : String(err),
    };
  }
}
