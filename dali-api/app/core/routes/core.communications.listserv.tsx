import type { Route } from "./+types/core.communications.listserv";
import { prisma } from "~/lib/db.server";
import { fullName } from "~/lib/display";
import { MEMBER_LIST_ORDER_BY } from "~/lib/prisma-shapes";
import { coreHandle } from "~/core/coreNav";
import { requireCommsViewer } from "~/core/lib/communications.server";
import { ListservDraftSchema, labToday } from "~/core/lib/listserv";
import {
  actOnListserv,
  checkDraft,
  getListservConfig,
  isListservLead,
  listListserv,
  markListservSent,
  setListservConfig,
  submitListserv,
} from "~/core/lib/listserv.server";
import { ListservPage } from "~/core/components/listserv/ListservPage";

export const handle = coreHandle("communications");

export const meta: Route.MetaFunction = () => [{ title: "Listserv · Core · DALI OS" }];

export async function loader({ request }: Route.LoaderArgs) {
  const viewer = await requireCommsViewer(request, "listserv");
  const [config, submissions] = await Promise.all([getListservConfig(), listListserv()]);
  const isAdmin = viewer.roles.isAdmin;
  const lead = config.leadUserId
    ? await prisma.user.findUnique({
        where: { id: config.leadUserId },
        select: { id: true, firstName: true, lastName: true },
      })
    : null;
  // Only an admin picks the lead, so only an admin needs the roster.
  const candidates = isAdmin
    ? await prisma.user.findMany({
        where: { daliMember: { isNot: null }, membershipStatus: "Active" },
        orderBy: MEMBER_LIST_ORDER_BY,
        select: { id: true, firstName: true, lastName: true },
      })
    : [];
  return {
    viewerId: viewer.userId,
    isAdmin,
    isLead: isListservLead(viewer.userId, config, isAdmin),
    lead: lead ? { id: lead.id, name: fullName(lead) } : null,
    fromAddress: config.fromAddress,
    candidates: candidates.map((c) => ({ id: c.id, name: fullName(c) })),
    submissions,
    today: labToday(),
  };
}

function parseDraft(form: FormData) {
  const raw = form.get("draft");
  if (typeof raw !== "string") return null;
  try {
    const parsed = ListservDraftSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export async function action({ request }: Route.ActionArgs) {
  const viewer = await requireCommsViewer(request, "listserv");
  const config = await getListservConfig();
  const isLead = isListservLead(viewer.userId, config, viewer.roles.isAdmin);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const id = String(form.get("id") ?? "");

  if (intent === "set-config") {
    if (!viewer.roles.isAdmin) return { ok: false as const, error: "Only admins can change this." };
    const leadUserId = String(form.get("leadUserId") ?? "") || null;
    const fromAddress = String(form.get("fromAddress") ?? "").trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fromAddress)) {
      return { ok: false as const, error: "Enter the address emails go out from." };
    }
    await setListservConfig({ leadUserId, fromAddress }, viewer.userId, request);
    return { ok: true as const, done: "config" };
  }

  if (intent === "submit" || intent === "edit") {
    const draft = parseDraft(form);
    if (!draft) return { ok: false as const, error: "Add a subject and write the email." };
    const problem = checkDraft(draft, labToday());
    if (problem) return { ok: false as const, error: problem.message };
    if (intent === "submit") {
      await submitListserv(draft, viewer.userId);
      return { ok: true as const, done: "submitted" };
    }
    const result = await actOnListserv({ id, action: "edit", actorId: viewer.userId, isLead, draft });
    return result.ok ? { ok: true as const, done: "edited" } : result;
  }

  if (intent === "mark-sent") {
    if (!isLead) return { ok: false as const, error: "Only the outreach lead can do that." };
    const ids = form.getAll("ids").map(String);
    const sentOn = String(form.get("sentOn") ?? "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(sentOn)) return { ok: false as const, error: "Pick the day they went out." };
    const result = await markListservSent(ids, sentOn, viewer.userId);
    return result.ok ? { ok: true as const, done: "sent", count: result.count, sentOn } : result;
  }

  if (
    intent === "approve" ||
    intent === "unapprove" ||
    intent === "request-changes" ||
    intent === "unmark-sent" ||
    intent === "withdraw"
  ) {
    const result = await actOnListserv({
      id,
      action: intent,
      actorId: viewer.userId,
      isLead,
      feedback: String(form.get("feedback") ?? ""),
    });
    return result.ok ? { ok: true as const, done: intent } : result;
  }

  return { ok: false as const, error: "Unknown action." };
}

export default function ListservRoute({ loaderData }: Route.ComponentProps) {
  return <ListservPage data={loaderData} />;
}
