import { Link, redirect } from "react-router";
import { requireAuth, isNonMember } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { getUserRoles } from "~/lib/roles";
import { visibleHelpArticles } from "~/help/library.server";
import type { Route } from "./+types/help.articles._index";

export const meta: Route.MetaFunction = () => [{ title: "All guides · Help · DALI OS" }];

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  if (await isNonMember(auth, request)) return redirect("/portal");
  const roles = await getUserRoles(auth.user.sub, request);
  const articles = await visibleHelpArticles({ userId: auth.user.sub, roles, request });
  return { articles: articles.map(({ slug, title, summary, url }) => ({ slug, title, summary, url })) };
}

export default function HelpArticlesIndex({ loaderData }: Route.ComponentProps) {
  return (
    <main className="max-w-3xl">
      <Link to="/help" className="text-sm text-muted-foreground hover:text-foreground">
        Help
      </Link>
      <h1 className="mt-1 text-2xl font-semibold">All guides</h1>
      <ul className="mt-6 divide-y divide-border rounded-lg border border-border bg-card">
        {loaderData.articles.map((a) => (
          <li key={a.slug}>
            <Link to={a.url} className="block px-4 py-3 transition hover:bg-muted/50">
              <span className="font-medium text-foreground">{a.title}</span>
              <span className="mt-0.5 block text-sm text-muted-foreground">{a.summary}</span>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
