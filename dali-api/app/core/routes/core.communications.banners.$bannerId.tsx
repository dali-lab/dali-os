import { redirect } from "react-router";
import type { Route } from "./+types/core.communications.banners.$bannerId";
import { listAllGroups } from "~/lib/groups";
import { orderGroupsForPicker } from "~/lib/group-kind";
import { fullName } from "~/lib/display";
import { prisma } from "~/lib/db";
import { logAuditEvent } from "~/lib/audit";
import { coreHandle } from "~/core/coreNav";
import { requireCommsViewer } from "~/core/lib/communications.server";
import { BannerInputSchema, validateForPublish } from "~/core/lib/banners";
import { createBanner, deleteBanner, getBanner, updateBanner } from "~/core/lib/banners.server";
import { BannerEditor } from "~/core/components/banners/BannerEditor";

export const handle = coreHandle("communications");

export const meta: Route.MetaFunction = ({ data }) => [
  { title: `${data?.banner?.name ?? "New banner"} · Banners · Core · DALI OS` },
];

const LIST = "/core/communications/banners";

export async function loader({ request, params }: Route.LoaderArgs) {
  const viewer = await requireCommsViewer(request, "banners");
  const isNew = params.bannerId === "new";
  const banner = isNew ? null : await getBanner(params.bannerId);
  if (!isNew && !banner) throw new Response("Not found", { status: 404 });
  const [groups, me, media] = await Promise.all([
    listAllGroups(request),
    prisma.user.findUnique({ where: { id: viewer.userId }, select: { firstName: true, lastName: true } }),
    prisma.banner.findMany({
      where: { mediaUrl: { not: null } },
      orderBy: { updatedAt: "desc" },
      select: { mediaUrl: true },
      take: 12,
    }),
  ]);
  return {
    banner,
    author: (me && fullName(me)) || "Core",
    groups: orderGroupsForPicker(
      groups.filter((g) => !g.archived),
      banner?.groupIds,
    ).map((g) => ({ id: g.id, name: g.name, memberCount: g.memberIds.length })),
    recentMedia: [...new Set(media.map((m) => m.mediaUrl!))].slice(0, 6),
  };
}

export async function action({ request, params }: Route.ActionArgs) {
  const viewer = await requireCommsViewer(request, "banners");
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  if (intent === "delete") {
    await deleteBanner(params.bannerId);
    await logAuditEvent({ action: "banner.delete", userId: viewer.userId, targetId: params.bannerId, request });
    return redirect(LIST);
  }

  if (intent !== "save") return { ok: false as const, error: "Unknown action." };
  let raw: unknown;
  try {
    raw = JSON.parse(String(form.get("banner") ?? ""));
  } catch {
    return { ok: false as const, error: "Couldn't read that banner." };
  }
  const parsed = BannerInputSchema.safeParse(raw);
  if (!parsed.success) return { ok: false as const, error: "Some fields aren't valid." };
  const input = parsed.data;
  if (input.published) {
    const errors = validateForPublish(input);
    if (Object.keys(errors).length) return { ok: false as const, error: "Fix the highlighted sections first.", errors };
  }
  let id = params.bannerId;
  if (id === "new") {
    id = await createBanner(input, viewer.userId);
  } else if (!(await updateBanner(id, input))) {
    throw new Response("Not found", { status: 404 });
  }
  await logAuditEvent({
    action: "banner.save",
    userId: viewer.userId,
    targetId: id,
    metadata: { name: input.name, published: input.published, startsAt: input.startsAt, endsAt: input.endsAt },
    request,
  });
  return redirect(LIST);
}

export default function BannerEditorRoute({ loaderData }: Route.ComponentProps) {
  return <BannerEditor data={loaderData} />;
}
