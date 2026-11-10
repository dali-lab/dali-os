import { data, Link, redirect } from "react-router";
import { requireAuth, isNonMember } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { getUserRoles } from "~/lib/roles";
import { findHelpArticle } from "~/help/library.server";
import { Markdown } from "~/components/Markdown";
import type { Route } from "./+types/help.articles.$slug";

export const meta: Route.MetaFunction = ({ data }) => [
  { title: data && "title" in data ? `${data.title} · Help · DALI OS` : "Help · DALI OS" },
];

export async function loader({ request, params }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  if (await isNonMember(auth, request)) return redirect("/portal");
  const roles = await getUserRoles(auth.user.sub, request);
  const article = await findHelpArticle({ userId: auth.user.sub, roles, request }, params.slug);
  if (!article) throw data("Not found", { status: 404 });
  if (article.url !== new URL(request.url).pathname) return redirect(article.url);
  return { title: article.title, summary: article.summary, body: article.body };
}

export default function HelpArticlePage({ loaderData }: Route.ComponentProps) {
  return (
    <main className="max-w-3xl">
      <Link to="/help/articles" className="text-sm text-muted-foreground hover:text-foreground">
        All guides
      </Link>
      <h1 className="mt-1 text-2xl font-semibold">{loaderData.title}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{loaderData.summary}</p>
      <div className="mt-6">
        <Markdown internalLinks>{loaderData.body}</Markdown>
      </div>
    </main>
  );
}
