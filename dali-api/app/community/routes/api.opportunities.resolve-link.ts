import { requireCommunityViewer } from "~/community/lib/community.server";
import { checkRateLimit } from "~/lib/rate-limit";
import { inlineLogoDataUrl, logoUrlForKey, resolveJobLink, storeLogo } from "~/community/lib/job-link.server";

export async function action({ request }: { request: Request }) {
  const { user } = await requireCommunityViewer(request);
  const limited = checkRateLimit(request, { max: 20, windowMs: 60_000 }, `opp-resolve:${user.sub}`);
  if (limited) return limited;

  const url = String((await request.formData()).get("url") ?? "").trim();
  const resolved = url ? await resolveJobLink(url) : null;
  if (!resolved) return Response.json({ ok: false }, { status: 400 });

  const logo = resolved.logoSourceUrl ? await storeLogo(resolved.logoSourceUrl) : null;
  const logoKey = logo?.key ?? null;
  const { logoSourceUrl: _source, ...fields } = resolved;
  return Response.json({
    ok: true,
    link: { ...fields, logoKey, logoUrl: logoUrlForKey(logoKey), logoDataUrl: logo ? inlineLogoDataUrl(logo) : null },
  });
}
