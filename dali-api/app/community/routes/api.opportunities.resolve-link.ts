import { requireLabViewer } from "~/lib/lab-viewer.server";
import { requireCommunityViewer } from "~/community/lib/community.server";
import { checkRateLimit } from "~/lib/rate-limit";
import { copyLogoToS3, logoUrlForKey, resolveJobLink } from "~/community/lib/job-link.server";

export async function action({ request }: { request: Request }) {
  const { user } = await requireCommunityViewer(request);
  await requireLabViewer(request, { flag: "alumni-opportunities" });
  const limited = checkRateLimit(request, { max: 20, windowMs: 60_000 }, `opp-resolve:${user.sub}`);
  if (limited) return limited;

  const url = String((await request.formData()).get("url") ?? "").trim();
  const resolved = url ? await resolveJobLink(url) : null;
  if (!resolved) return Response.json({ ok: false }, { status: 400 });

  const logoKey = resolved.logoSourceUrl ? await copyLogoToS3(resolved.logoSourceUrl) : null;
  const { logoSourceUrl: _source, ...fields } = resolved;
  return Response.json({ ok: true, link: { ...fields, logoKey, logoUrl: logoUrlForKey(logoKey) } });
}
