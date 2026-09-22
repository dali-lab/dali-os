import { useState } from "react";
import { redirect, useLoaderData } from "react-router";
import { Check, Pencil } from "lucide-react";
import type { Route } from "./+types/resources";
import { DocEditor } from "~/components/doc";
import { RESOURCES_ROOM } from "~/collab/roomName";
import { requireAuth, redirectPartnerToPortal } from "~/lib/auth";
import { parseSessionCookie } from "~/lib/cookies";
import { redirectToLogin } from "~/lib/login-next";
import { getUserRoles, isCore, isLabMember } from "~/lib/roles";
import { isFeatureEnabled } from "~/lib/feature-flags.server";

export const meta: Route.MetaFunction = () => [{ title: "Resources · DALI OS" }];

// Edge to edge: the document IS the page here, so there is no view gutter and
// no paper card floating on a tinted wash — the two pieces of chrome the
// /documents viewer adds around the same editor.
export const handle = { bleedPane: true };

// The lab's shared reference document: one fixed collab room (RESOURCES_ROOM),
// not a Drive page. Every lab member reads it; Core/Admin write. The socket
// enforces the same split (collabAuth's `resources` branch) — `canEdit` here
// only decides whether the Edit button appears.
export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  if (auth.user.type === "applicant") return redirect("/portal");
  const partnerRedirect = await redirectPartnerToPortal(auth);
  if (partnerRedirect) return partnerRedirect;

  // Behind the `resources` flag; 404 (not redirect) so a disabled feature isn't
  // reachable by URL and its existence isn't leaked.
  const roles = await getUserRoles(auth.user.sub);
  if (!(await isFeatureEnabled("resources", auth.user.sub, roles, request))) {
    throw new Response("Not found", { status: 404 });
  }

  const [core, labMember] = await Promise.all([
    isCore(auth.user.sub, request),
    isLabMember(auth.user.sub, request),
  ]);
  if (!core && !labMember) throw new Response("Not found", { status: 404 });

  return {
    canEdit: core,
    collabToken: parseSessionCookie(request),
    currentUserId: auth.user.sub,
    userName:
      [auth.user.firstName, auth.user.lastName].filter(Boolean).join(" ") ||
      auth.user.email,
  };
}

export default function ResourcesPage() {
  const { canEdit, collabToken, currentUserId, userName } = useLoaderData() as Exclude<
    Awaited<ReturnType<typeof loader>>,
    Response
  >;
  // Read mode by default, for Core too: this is the page the whole lab opens to
  // look something up, so a stray keystroke should not change it. Toggling the
  // prop is safe mid-session — BlockNote remounts the view, not the collab doc.
  const [editing, setEditing] = useState(false);

  if (!collabToken) {
    return (
      <p className="px-5 py-8 text-sm italic text-muted-foreground">
        Sign in again to open Resources.
      </p>
    );
  }

  return (
    <div className="min-h-dvh bg-card pb-10">
      {/* Always rendered: with no button in it the row is simply the page's top
          gutter, which a read-only viewer needs anyway. */}
      <div className="sticky top-0 z-20 flex justify-end bg-card px-6 py-5">
        {canEdit && (
          <button
            type="button"
            onClick={() => setEditing((on) => !on)}
            aria-pressed={editing}
            className="os-btn-primary os-btn-primary--sm"
          >
            {editing ? <Check className="h-4 w-4" /> : <Pencil className="h-4 w-4" />}
            {editing ? "Done" : "Edit"}
          </button>
        )}
      </div>
      <DocEditor
        features="document"
        editable={canEdit && editing}
        collab={{
          documentName: RESOURCES_ROOM,
          token: collabToken,
          userName,
          userId: currentUserId,
        }}
        placeholder="Write something, or press '/' for commands"
        className="min-h-[70vh]"
      />
    </div>
  );
}
