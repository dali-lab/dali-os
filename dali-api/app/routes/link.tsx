// /link — the desktop device-pairing approval page, opened in the system
// browser (NOT the Tauri webview). Shows the device label + userCode for the
// user to eyeball-compare against the app, and an Approve/Cancel action tied to
// their authenticated web session. Standalone page (no app layout). All login
// happens through the unmodified /login flow; this is the only new web surface.
// Copy follows TAURI_DESKTOP_PLAN.md.

import { Form, Link, redirect } from "react-router";
import type { Route } from "./+types/link";
import { requireAuth } from "~/lib/auth";
import { prisma } from "~/lib/db";
import { formatUserCode, normalizeUserCode } from "~/lib/pairing";
import { buttonClasses } from "~/components/ui/Button";

export const meta: Route.MetaFunction = () => [
  { title: "Link a device · DALI OS" },
];

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const codeParam = url.searchParams.get("code");
  const result = url.searchParams.get("result");

  // Terminal screens set by /auth/pair/approve after the user acts.
  if (result === "approved") return { view: "approved" as const };
  if (result === "cancelled") return { view: "cancelled" as const };
  if (result === "stale") return { view: "expired" as const };

  const auth = await requireAuth(request);
  const email = auth.ok ? auth.user.email : null;

  const normalized = codeParam ? normalizeUserCode(codeParam) : "";
  if (!normalized) return { view: "no_code" as const, signedIn: Boolean(email) };

  const row = await prisma.devicePairing.findUnique({ where: { userCode: normalized } });
  if (!row) return { view: "not_found" as const };
  if (row.status === "Consumed") return { view: "already_used" as const };
  if (row.status === "Cancelled") return { view: "cancelled" as const };
  if (row.status === "Expired" || row.expiresAt < new Date()) {
    return { view: "expired" as const };
  }
  if (row.status === "Approved") return { view: "approved" as const };

  // Pending.
  if (!email) {
    return { view: "pending_unauthenticated" as const, userCode: formatUserCode(normalized) };
  }
  return {
    view: "pending_authenticated" as const,
    userCode: formatUserCode(normalized),
    rawUserCode: normalized,
    deviceLabel: row.deviceLabel,
    email,
  };
}

// Manual code-entry fallback (the "no code" view) → redirect to /link?code=.
export async function action({ request }: Route.ActionArgs) {
  const form = await request.formData();
  const code = form.get("code");
  if (typeof code === "string" && normalizeUserCode(code)) {
    const display = formatUserCode(normalizeUserCode(code));
    return redirect(`/link?code=${encodeURIComponent(display)}`);
  }
  return redirect("/link");
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-zinc-50 flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <img src="/logo-blue.svg" alt="DALI Lab" className="mx-auto h-12 w-auto" />
        <div className="mt-6 rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm">
          {children}
        </div>
        <p className="mt-6 text-center text-xs text-zinc-400">
          Manage paired devices under Settings → Your devices.
        </p>
      </div>
    </div>
  );
}

function CodeChip({ code }: { code: string }) {
  return (
    <span className="rounded-md bg-zinc-100 px-2.5 py-1 font-mono text-lg font-semibold tracking-widest text-zinc-900">
      {code}
    </span>
  );
}

export default function LinkPage({ loaderData }: Route.ComponentProps) {
  const data = loaderData;

  if (data.view === "approved") {
    return (
      <Shell>
        <h1 className="text-xl font-semibold text-zinc-900">✅ Device approved</h1>
        <p className="mt-3 text-sm text-zinc-600">
          Head back to <strong>DALI OS Desktop</strong> — it'll finish signing in
          automatically. You can close this tab.
        </p>
      </Shell>
    );
  }

  if (data.view === "cancelled") {
    return (
      <Shell>
        <h1 className="text-xl font-semibold text-zinc-900">Pairing cancelled</h1>
        <p className="mt-3 text-sm text-zinc-600">
          No device was linked to your account. You can close this tab.
        </p>
      </Shell>
    );
  }

  if (data.view === "expired") {
    return (
      <Shell>
        <h1 className="text-xl font-semibold text-zinc-900">This pairing request expired</h1>
        <p className="mt-3 text-sm text-zinc-600">
          For your security, pairing codes expire after a few minutes. Open{" "}
          <strong>DALI OS Desktop</strong> and choose <strong>Sign in</strong>{" "}
          again to get a fresh code.
        </p>
      </Shell>
    );
  }

  if (data.view === "already_used") {
    return (
      <Shell>
        <h1 className="text-xl font-semibold text-zinc-900">This request was already used</h1>
        <p className="mt-3 text-sm text-zinc-600">
          This pairing code has already approved a device. If that wasn't you, go
          to <strong>Settings → Your devices</strong> and revoke any device you
          don't recognize.
        </p>
      </Shell>
    );
  }

  if (data.view === "not_found") {
    return (
      <Shell>
        <h1 className="text-xl font-semibold text-zinc-900">Pairing code not found</h1>
        <p className="mt-3 text-sm text-zinc-600">
          We couldn't find that pairing code. Open <strong>DALI OS Desktop</strong>{" "}
          and choose <strong>Sign in</strong> to get a fresh code, then enter it
          here.
        </p>
      </Shell>
    );
  }

  if (data.view === "no_code") {
    return (
      <Shell>
        <h1 className="text-xl font-semibold text-zinc-900">Link a desktop device</h1>
        <p className="mt-3 text-sm text-zinc-600">
          Enter the code shown in <strong>DALI OS Desktop</strong>.
        </p>
        <Form method="post" className="mt-4 flex gap-2">
          <input
            name="code"
            autoFocus
            placeholder="WXYZ-1234"
            className="flex-1 rounded-md border border-zinc-300 px-3 py-2 font-mono uppercase tracking-widest placeholder:tracking-normal focus:border-zinc-500 focus:outline-none"
          />
          <button
            type="submit"
            className={buttonClasses("primary", "sm")}
          >
            Continue
          </button>
        </Form>
        {!data.signedIn && (
          <p className="mt-4 text-xs text-zinc-500">
            Don't have the app open? Launch DALI OS Desktop and choose{" "}
            <strong>Sign in</strong> first.
          </p>
        )}
      </Shell>
    );
  }

  if (data.view === "pending_unauthenticated") {
    return (
      <Shell>
        <div className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <strong>Sign in to approve a device.</strong> You're linking the DALI OS
          desktop app. Sign in to continue, then you'll confirm the device.
        </div>
        <p className="mt-4 text-sm text-zinc-600">
          Pairing code <CodeChip code={data.userCode} /> — after signing in,
          return to this page to approve.
        </p>
        <div className="mt-5 flex flex-col gap-3">
          <Form method="post" action="/login">
            <input type="hidden" name="provider" value="google" />
            <button
              type="submit"
              className="w-full rounded-lg border border-zinc-300 px-4 py-3 text-left text-sm font-semibold text-zinc-900 hover:bg-zinc-50"
            >
              Current Member
              <span className="block text-xs font-normal text-zinc-500">
                @dali.dartmouth.edu Google account
              </span>
            </button>
          </Form>
          <Form method="post" action="/login">
            <input type="hidden" name="provider" value="cas" />
            <button
              type="submit"
              className="w-full rounded-lg border border-zinc-300 px-4 py-3 text-left text-sm font-semibold text-zinc-900 hover:bg-zinc-50"
            >
              Applicant
              <span className="block text-xs font-normal text-zinc-500">
                Dartmouth single sign-on
              </span>
            </button>
          </Form>
        </div>
      </Shell>
    );
  }

  // pending_authenticated
  return (
    <Shell>
      <h1 className="text-xl font-semibold text-zinc-900">Approve this device?</h1>
      <p className="mt-2 text-sm text-zinc-600">
        <strong>DALI OS Desktop</strong> wants to sign in to your account.
      </p>
      <dl className="mt-4 space-y-2 text-sm">
        <div className="flex items-center justify-between gap-3">
          <dt className="text-zinc-500">Device</dt>
          <dd className="font-medium text-zinc-900">{data.deviceLabel}</dd>
        </div>
        <div className="flex items-center justify-between gap-3">
          <dt className="text-zinc-500">Pairing code</dt>
          <dd>
            <CodeChip code={data.userCode} />
          </dd>
        </div>
      </dl>
      <p className="mt-4 rounded-lg bg-amber-50 px-4 py-3 text-xs text-amber-900">
        ⚠️ Confirm this code matches the one shown in the app. Only approve if{" "}
        <em>you</em> just opened DALI OS Desktop on this computer. Approving keeps
        the app signed in to your account until you sign out or revoke it.
      </p>
      <p className="mt-3 text-xs text-zinc-500">
        Approving as <strong>{data.email}</strong> —{" "}
        <Link to="/logout" className="underline hover:text-zinc-700">
          not you? Switch account
        </Link>
      </p>
      <Form method="post" action="/auth/pair/approve" className="mt-5 flex gap-3">
        <input type="hidden" name="userCode" value={data.rawUserCode} />
        <button
          type="submit"
          name="intent"
          value="approve"
          className={buttonClasses("primary", "md", "flex-1")}
        >
          Approve device
        </button>
        <button
          type="submit"
          name="intent"
          value="cancel"
          className="rounded-lg border border-zinc-300 px-4 py-2.5 text-sm font-semibold text-zinc-700 hover:bg-zinc-50"
        >
          Cancel
        </button>
      </Form>
    </Shell>
  );
}
