import { Form, Link, useActionData, useLoaderData, useNavigation } from "react-router";
import { Coffee } from "lucide-react";
import type { Route } from "./+types/coffee-chats.$id";
import { requireAuth, redirectApplicantToPortal } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { Button, buttonClasses } from "~/components/ui/Button";
import { loadCoffeeChat, respondToCoffeeChat } from "~/members/lib/coffee-chat.server";

export const meta: Route.MetaFunction = () => [{ title: "Coffee chat · DALI OS" }];

export const handle = {
  breadcrumb: () => "Coffee chat",
};

export async function loader({ request, params }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  const portalRedirect = redirectApplicantToPortal(auth);
  if (portalRedirect) return portalRedirect;
  const chat = await loadCoffeeChat(params.id, auth.user.sub);
  if (!chat) throw new Response("Not found", { status: 404 });
  return { chat };
}

export async function action({ request, params }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) {
    // A "log in as" session is read-only outside staging. Say so here rather
    // than bouncing through /login back to this page with nothing changed.
    if (auth.reason === "impersonated_write") {
      return { error: "You're viewing as this person, which is read-only. They have to answer from their own account." };
    }
    return redirectToLogin(request);
  }
  const form = await request.formData();
  return respondToCoffeeChat(params.id, auth.user.sub, form.get("answer") === "accept");
}

export default function CoffeeChat() {
  const { chat } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const busy = useNavigation().state !== "idle";

  let title: string;
  let detail: string;
  if (chat.role === "sender") {
    title =
      chat.status === "Accepted"
        ? `${chat.other?.name ?? "They"} accepted your coffee chat`
        : `Waiting on ${chat.other?.name ?? "them"}`;
    detail =
      chat.status === "Accepted"
        ? "They can see your name now. Reach out to pick a time."
        : "Your invite is anonymous. They'll see your name only if they accept.";
  } else if (chat.status === "Pending") {
    title = "Someone wants to grab coffee with you";
    detail = "You'll see who it is only if you accept. If you decline, they won't be told.";
  } else if (chat.status === "Accepted") {
    title = `Coffee chat with ${chat.other?.name ?? "a DALI member"}`;
    detail = "They've been told you accepted. Reach out to pick a time.";
  } else {
    title = "You declined this coffee chat";
    detail = "They weren't told.";
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-heading text-4xl font-medium text-foreground">Coffee chat</h1>
      <article className="flex flex-col gap-4 rounded-os-card bg-os-card p-6">
        <div className="flex items-start gap-3">
          <span className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[10px] bg-os-accent/15 text-os-accent">
            <Coffee className="h-[17px] w-[17px]" />
          </span>
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-foreground">{title}</h2>
            <p className="mt-1 text-sm text-os-grey">{detail}</p>
          </div>
        </div>

        {actionData?.error && (
          <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {actionData.error}
          </p>
        )}

        {chat.role === "recipient" && chat.status === "Pending" && (
          <Form method="post" className="flex gap-2">
            <Button type="submit" name="answer" value="accept" disabled={busy}>
              Accept
            </Button>
            <Button type="submit" name="answer" value="decline" variant="secondary" disabled={busy}>
              Decline
            </Button>
          </Form>
        )}

        {chat.status === "Accepted" && chat.other && (
          <div className="flex flex-wrap gap-2">
            <Link to={`/members/${chat.other.id}`} className={buttonClasses("primary", "md")}>
              View profile
            </Link>
            {chat.other.email && (
              <a href={`mailto:${chat.other.email}`} className={buttonClasses("secondary", "md")}>
                Email {chat.other.name.split(" ")[0]}
              </a>
            )}
          </div>
        )}
      </article>
    </div>
  );
}
