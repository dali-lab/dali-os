import { prisma } from "~/lib/db.server";
import { fullName, primaryEmail } from "~/lib/display";
import type { Question } from "~/types";
import {
  fillersForSharing,
  isPrefillFieldKey,
  prefillFieldFits,
  type FillerKind,
  type PrefillFieldKey,
} from "./prefill-fields";
import { resolveReferenceOptions } from "./reference-sources";

type Subject = "me" | "partner" | "partnerOrg";

function subjectOf(key: PrefillFieldKey): Subject {
  return key.slice(0, key.indexOf(".")) as Subject;
}

type Loaded = {
  user: { firstName: string; lastName: string; email: string | null; daliEmail: string | null; dartmouthEmail: string | null; personalEmail: string | null } | null;
  contact: {
    title: string | null;
    phone: string | null;
    memberships: { org: { name: string; legalEntityName: string | null; address: string | null; website: string | null } }[];
  } | null;
};

async function load(userId: string, subjects: Set<Subject>): Promise<Loaded> {
  const [user, contact] = await Promise.all([
    subjects.has("me")
      ? prisma.user.findUnique({
          where: { id: userId },
          select: { firstName: true, lastName: true, email: true, daliEmail: true, dartmouthEmail: true, personalEmail: true },
        })
      : null,
    subjects.has("partner") || subjects.has("partnerOrg")
      ? prisma.partnerContact.findUnique({
          where: { userId },
          select: {
            title: true,
            phone: true,
            memberships: {
              where: { endedAt: null },
              select: { org: { select: { name: true, legalEntityName: true, address: true, website: true } } },
            },
          },
        })
      : null,
  ]);
  return { user, contact };
}

function valueFor(key: Exclude<PrefillFieldKey, "partnerOrg.project">, loaded: Loaded): string | null | undefined {
  const { user, contact } = loaded;
  const org = contact?.memberships.length === 1 ? contact.memberships[0].org : null;
  switch (key) {
    case "me.name":
      return user ? fullName(user) : null;
    case "me.email":
      return user ? primaryEmail(user) ?? user.email : null;
    case "partner.title":
      return contact?.title;
    case "partner.phone":
      return contact?.phone;
    case "partnerOrg.name":
      return org?.name;
    case "partnerOrg.legalEntityName":
      return org?.legalEntityName;
    case "partnerOrg.address":
      return org?.address;
    case "partnerOrg.website":
      return org?.website;
  }
}

export async function resolvePrefill(questions: Question[], userId: string | null): Promise<Record<string, string>> {
  if (!userId) return {};
  const wanted = questions.flatMap((q) => {
    const key = q.data.prefill;
    return isPrefillFieldKey(key) && prefillFieldFits(key, q) ? [{ q, key }] : [];
  });
  if (wanted.length === 0) return {};

  const loaded = await load(userId, new Set(wanted.map((w) => subjectOf(w.key))));
  const prefill: Record<string, string> = {};
  for (const { q, key } of wanted) {
    let value: string | null | undefined;
    if (key === "partnerOrg.project") {
      const options = q.data.referenceOptions ?? (await resolveReferenceOptions(q.data.referenceSource, { userId }));
      value = options.length === 1 ? options[0].value : null;
    } else {
      value = valueFor(key, loaded)?.trim();
    }
    if (value) prefill[q.key] = value;
  }
  return prefill;
}

export async function formFillers(formId: string): Promise<FillerKind[]> {
  const page = await prisma.page.findUnique({
    where: { id: formId },
    select: { linkAccess: true, shares: { select: { principalType: true, principalId: true } } },
  });
  if (!page) return ["member"];
  const userIds = page.shares.filter((s) => s.principalType === "User").map((s) => s.principalId);
  const kinds = new Set<FillerKind>();
  if (page.shares.some((s) => s.principalType === "Group")) kinds.add("member");
  if (userIds.length) {
    const [members, contacts] = await Promise.all([
      prisma.dALIMember.findMany({ where: { userId: { in: userIds } }, select: { userId: true } }),
      prisma.partnerContact.findMany({ where: { userId: { in: userIds } }, select: { userId: true } }),
    ]);
    const known = new Set<string>();
    if (members.length) kinds.add("member");
    if (contacts.length) kinds.add("partner");
    for (const r of [...members, ...contacts]) if (r.userId) known.add(r.userId);
    if (userIds.some((id) => !known.has(id))) kinds.add("other");
  }
  return fillersForSharing(page.linkAccess ?? "Restricted", [...kinds]);
}
