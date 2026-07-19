import { JWT } from "google-auth-library";
import { retry } from "./retry";

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
const DIRECTORY_GROUPS_URL =
  "https://admin.googleapis.com/admin/directory/v1/groups";
const SCOPES = [
  "https://www.googleapis.com/auth/admin.directory.user",
  "https://www.googleapis.com/auth/admin.directory.group",
];

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

// Project name -> { userEmail, groupEmail } under <domain>. The local part is a
// hyphen-slug of the name (e.g. "Project Alpha!" -> "project-alpha"); the group
// appends "-team". Empty/punctuation-only names fall back to "project".
export function deriveProjectEmails(projectName: string): {
  userEmail: string;
  groupEmail: string;
} {
  const slug =
    projectName
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "project";
  return {
    userEmail: `${slug}@${WORKSPACE_DOMAIN}`,
    groupEmail: `${slug}-team@${WORKSPACE_DOMAIN}`,
  };
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
  return createDirectoryUser({
    email,
    givenName: args.firstName,
    familyName: args.lastName || args.firstName,
    recoveryEmail: args.recoveryEmail,
  });
}

// Shared Directory API user-create. Idempotent: a 409 (already exists) is
// reported as { created: false } success. The caller is responsible for the
// configured-gate; this assumes it's already checked.
async function createDirectoryUser(args: {
  email: string;
  givenName: string;
  familyName: string;
  recoveryEmail?: string | null;
}): Promise<WorkspaceResult> {
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
        primaryEmail: args.email,
        name: { givenName: args.givenName, familyName: args.familyName },
        password,
        changePasswordAtNextLogin: true,
        ...(args.recoveryEmail ? { recoveryEmail: args.recoveryEmail } : {}),
      }),
    });

    if (res.status === 409) {
      // Already exists — fine.
      return { status: "ok", email: args.email, created: false };
    }
    if (!res.ok) {
      const body = await res.text();
      return { status: "error", message: `Directory API ${res.status}: ${body.slice(0, 300)}` };
    }
    return { status: "ok", email: args.email, created: true, tempPassword: password };
  } catch (err) {
    return {
      status: "error",
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

// Create a project-owned Workspace user at an EXPLICIT email (e.g.
// "project-alpha@dali.dartmouth.edu"). Unlike a member account, the name is the
// project name (givenName), and there's no recovery email. Idempotent via 409.
export async function provisionProjectUser(args: {
  email: string;
  projectName: string;
}): Promise<WorkspaceResult> {
  if (!workspaceConfigured()) {
    return {
      status: "skipped",
      message: "Google Workspace provisioning is not configured.",
    };
  }
  return createDirectoryUser({
    email: args.email,
    givenName: args.projectName,
    // Directory API requires a non-empty familyName; reuse the project name.
    familyName: args.projectName,
  });
}

export type GroupResult =
  | { status: "ok"; email: string; created: boolean }
  | { status: "skipped"; message: string }
  | { status: "error"; message: string };

// Get-or-create a Workspace group at an explicit email. Idempotent: a 409 is
// reported as { created: false }. The group name defaults to `name` (the
// project name + " Team") so it's recognizable in the Admin console.
export async function ensureWorkspaceGroup(args: {
  email: string;
  name: string;
}): Promise<GroupResult> {
  if (!workspaceConfigured()) {
    return {
      status: "skipped",
      message: "Google Workspace provisioning is not configured.",
    };
  }
  try {
    const token = await getAccessToken();
    const res = await fetch(DIRECTORY_GROUPS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email: args.email, name: args.name }),
    });
    if (res.status === 409) {
      return { status: "ok", email: args.email, created: false };
    }
    if (!res.ok) {
      const body = await res.text();
      return { status: "error", message: `Directory API ${res.status}: ${body.slice(0, 300)}` };
    }
    return { status: "ok", email: args.email, created: true };
  } catch (err) {
    return {
      status: "error",
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

export type GroupMemberResult =
  | { status: "ok"; added: boolean }
  | { status: "error"; message: string };

// Add a member (by email) to a group. Idempotent: a 409 (already a member) is
// reported as { added: false } success.
//
// A freshly-created group isn't immediately addressable by its email
// (groupKey) — Google Directory propagates it over a few seconds, so the FIRST
// finalize (which created the group) would 404 ("Resource Not Found: groupKey")
// when adding members. We retry the 404 a few times with backoff to ride out
// that propagation lag; a persistent 404 (or any other error) is returned so the
// caller can report it.
export async function addGroupMember(args: {
  groupEmail: string;
  memberEmail: string;
}): Promise<GroupMemberResult> {
  // ~0.5 + 1 + 2 + 4 + 8 = 15.5s of total backoff across the retries — enough to
  // cover typical group-propagation lag without hanging the finalize for long.
  try {
    const token = await getAccessToken();
    return await retry(
      async (): Promise<GroupMemberResult> => {
        const res = await fetch(
          `${DIRECTORY_GROUPS_URL}/${encodeURIComponent(args.groupEmail)}/members`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ email: args.memberEmail, role: "MEMBER" }),
          },
        );
        if (res.status === 409) {
          return { status: "ok", added: false };
        }
        if (res.ok) {
          return { status: "ok", added: true };
        }
        const body = await res.text();
        // Throw the group-not-yet-propagated 404 so retry() can ride out propagation lag.
        if (res.status === 404 && /groupKey/i.test(body)) {
          throw new GroupPropagation404(body);
        }
        return { status: "error", message: `Directory API ${res.status}: ${body.slice(0, 200)}` };
      },
      {
        backoffsMs: [500, 1000, 2000, 4000, 8000],
        shouldRetry: (err) => err instanceof GroupPropagation404,
      },
    );
  } catch (err) {
    if (err instanceof GroupPropagation404) {
      return { status: "error", message: `Directory API 404: ${err.body.slice(0, 200)}` };
    }
    return {
      status: "error",
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

class GroupPropagation404 extends Error {
  constructor(public body: string) {
    super("group propagation 404");
  }
}
