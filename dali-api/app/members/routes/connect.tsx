import { data, useLoaderData } from "react-router";
import type { Route } from "./+types/connect";
import { requireAuth, redirectNonMemberToPortal } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { prisma } from "~/lib/db.server";
import { resolveUserTimeZone } from "~/lib/timezone";
import { ConnectView } from "~/members/components/ConnectView";
import { loadConnect } from "~/members/lib/connect.server";
import { cancelEvent, createEvent, setRsvp, updateEvent } from "~/members/lib/community-events.server";
import { eventInputFromForm } from "~/members/lib/connect-view";

export const meta: Route.MetaFunction = ({ data }) => [{ title: `${data?.title ?? "Connect"} · DALI OS` }];

export const handle = {
  breadcrumb: (data: unknown) => (data as { title?: string } | undefined)?.title ?? "Connect",
  fitViewport: true,
  bleedPane: true,
};

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  const portalRedirect = await redirectNonMemberToPortal(auth, request);
  if (portalRedirect) return portalRedirect;

  const [connect, me] = await Promise.all([
    loadConnect(auth.user.sub),
    prisma.user.findUnique({
      where: { id: auth.user.sub },
      select: { timeZone: true, openToCoffeeChats: true, openToResumeReviews: true },
    }),
  ]);
  const { viewer } = connect;
  return {
    ...connect,
    events: viewer.isAlumni ? connect.events : connect.events.filter((e) => e.source !== "dali"),
    title: viewer.isAlumni ? "Home" : "Connect",
    tz: resolveUserTimeZone(me),
    openTo: { coffeeChats: me?.openToCoffeeChats ?? false, resumeReviews: me?.openToResumeReviews ?? false },
  };
}

const OPEN_TO_FIELDS = {
  coffeeChats: "openToCoffeeChats",
  resumeReviews: "openToResumeReviews",
} as const;

type EventOutcome = { ok: true; id: string } | { ok: false; status: number; error: string };

const respond = (result: EventOutcome) =>
  result.ok ? { ok: true as const, id: result.id } : data({ ok: false as const, error: result.error }, { status: result.status });

export async function action({ request }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  const userId = auth.user.sub;
  const form = await request.formData();
  const intent = String(form.get("intent"));
  const eventId = String(form.get("eventId") ?? "");

  switch (intent) {
    case "open-to": {
      const field = OPEN_TO_FIELDS[String(form.get("field")) as keyof typeof OPEN_TO_FIELDS];
      if (!field) throw new Response("Bad request", { status: 400 });
      await prisma.user.update({ where: { id: userId }, data: { [field]: form.get("value") === "on" } });
      return { ok: true as const };
    }
    case "create-event":
    case "update-event": {
      const me = await prisma.user.findUnique({ where: { id: userId }, select: { timeZone: true } });
      const parsed = eventInputFromForm(form, resolveUserTimeZone(me));
      if (!parsed.ok) return data({ ok: false as const, error: parsed.error }, { status: 400 });
      return respond(
        intent === "create-event"
          ? await createEvent(userId, parsed.input, request)
          : await updateEvent(userId, eventId, parsed.input, request),
      );
    }
    case "cancel-event":
      return respond(await cancelEvent(userId, eventId, request));
    case "rsvp":
      return respond(await setRsvp(userId, eventId, form.get("going") === "true"));
    default:
      throw new Response("Bad request", { status: 400 });
  }
}

export default function Connect() {
  return <ConnectView data={useLoaderData<typeof loader>()} />;
}
