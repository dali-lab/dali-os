// Shared-inbox categories for the Email tab, managed on Admin → Email
// Senders. Admins create a category, add its inbox addresses, and pick who may
// subscribe (people and/or groups). People in that audience opt in from the
// Email tab's Inboxes panel and sign in to each inbox themselves — admins
// never connect an account here. Current-term project inboxes are automatic
// and never need a category.

import { prisma } from "~/lib/db";
import { logAuditEvent } from "~/lib/audit";
import { fullName } from "~/lib/display";
import { MEMBER_LIST_ORDER_BY } from "~/lib/prisma-shapes";
import { listAllGroups } from "~/lib/groups";
import { EMAIL_RE, MAX_CATEGORY_DESCRIPTION, MAX_CATEGORY_NAME } from "~/email/lib/categories";


export const CATEGORY_INTENTS = ["save-category", "delete-category"] as const;

export async function loadInboxCategories() {
  const [categories, members, groups] = await Promise.all([
    prisma.mailCategory.findMany({
      orderBy: { name: "asc" },
      include: {
        accounts: {
          include: {
            account: {
              select: { id: true, address: true, displayName: true, _count: { select: { connections: true } } },
            },
          },
        },
        _count: { select: { subscriptions: true } },
      },
    }),
    prisma.user.findMany({
      where: { daliMember: { isNot: null }, membershipStatus: "Active" },
      orderBy: MEMBER_LIST_ORDER_BY,
      select: { id: true, firstName: true, lastName: true, daliEmail: true },
    }),
    listAllGroups(),
  ]);

  return {
    members: members.map((m) => ({ id: m.id, name: fullName(m), email: m.daliEmail })),
    groups: groups
      .filter((g) => !g.archived)
      .map((g) => ({ id: g.id, name: g.name, systemKey: g.systemKey, memberCount: g.memberIds.length })),
    categories: categories.map((c) => ({
      id: c.id,
      name: c.name,
      description: c.description,
      audienceUserIds: c.audienceUserIds,
      audienceGroupIds: c.audienceGroupIds,
      subscribers: c._count.subscriptions,
      inboxes: c.accounts
        .map(({ account }) => ({
          id: account.id,
          address: account.address,
          signedIn: account._count.connections,
        }))
        .sort((a, b) => a.address.localeCompare(b.address)),
    })),
  };
}

const fail = (error: string, status = 400) => Response.json({ error }, { status });

// Drops everyone's sign-in to inboxes no longer in any category — nobody can
// open them, so their Google tokens shouldn't stay stored.
async function forgetOrphanedInboxes(accountIds: string[]) {
  if (accountIds.length === 0) return;
  const stillListed = await prisma.mailCategoryAccount.findMany({
    where: { accountId: { in: accountIds } },
    select: { accountId: true },
  });
  const listed = new Set(stillListed.map((r) => r.accountId));
  const orphaned = accountIds.filter((id) => !listed.has(id));
  if (orphaned.length) await prisma.mailAccountConnection.deleteMany({ where: { accountId: { in: orphaned } } });
}

/** Handles CATEGORY_INTENTS. The caller has already checked the user is an admin. */
export async function handleInboxCategoryAction(request: Request, form: FormData, userId: string) {
  const intent = String(form.get("intent") ?? "");
  const text = (name: string) => String(form.get(name) ?? "").trim();
  const list = (name: string) => [...new Set(form.getAll(name).map(String).filter(Boolean))];

  if (intent === "save-category") {
    const id = text("id");
    const name = text("name");
    const description = text("description");
    const addresses = list("inbox").map((a) => a.toLowerCase());
    if (!name) return fail("Give the category a name.");
    if (name.length > MAX_CATEGORY_NAME) return fail(`Keep the name under ${MAX_CATEGORY_NAME} characters.`);
    if (description.length > MAX_CATEGORY_DESCRIPTION) return fail(`Keep the description under ${MAX_CATEGORY_DESCRIPTION} characters.`);
    const bad = addresses.find((a) => !EMAIL_RE.test(a));
    if (bad) return fail(`${bad} isn't a valid email address.`);

    // Only real people and groups make it into the audience.
    const [users, groups] = await Promise.all([
      prisma.user.findMany({ where: { id: { in: list("userId") } }, select: { id: true } }),
      prisma.groupDefinition.findMany({ where: { id: { in: list("groupId") } }, select: { id: true } }),
    ]);
    const data = {
      name,
      description,
      audienceUserIds: users.map((u) => u.id),
      audienceGroupIds: groups.map((g) => g.id),
    };

    // Each address is one Shared inbox, reused across categories.
    const accounts = await Promise.all(
      addresses.map((address) =>
        prisma.mailAccount.upsert({
          where: { scopeKey_address: { scopeKey: "shared", address } },
          create: { kind: "Shared", scopeKey: "shared", address },
          update: {},
          select: { id: true },
        }),
      ),
    );
    const accountIds = accounts.map((a) => a.id);

    let categoryId = id;
    let removed: string[] = [];
    if (id) {
      const existing = await prisma.mailCategory.findUnique({
        where: { id },
        select: { accounts: { select: { accountId: true } } },
      });
      if (!existing) return fail("That category no longer exists.", 404);
      removed = existing.accounts.map((a) => a.accountId).filter((a) => !accountIds.includes(a));
      await prisma.$transaction([
        prisma.mailCategory.update({ where: { id }, data }),
        prisma.mailCategoryAccount.deleteMany({ where: { categoryId: id, accountId: { notIn: accountIds } } }),
        prisma.mailCategoryAccount.createMany({
          data: accountIds.map((accountId) => ({ categoryId: id, accountId })),
          skipDuplicates: true,
        }),
      ]);
    } else {
      const created = await prisma.mailCategory.create({
        data: { ...data, accounts: { create: accountIds.map((accountId) => ({ accountId })) } },
      });
      categoryId = created.id;
    }
    await forgetOrphanedInboxes(removed);
    await logAuditEvent({
      action: id ? "mail-category.update" : "mail-category.create",
      userId,
      targetId: categoryId,
      metadata: { name, inboxes: addresses, users: data.audienceUserIds.length, groups: data.audienceGroupIds.length },
      request,
    });
    return Response.json({ ok: true });
  }

  if (intent === "delete-category") {
    const id = text("id");
    const category = await prisma.mailCategory.findUnique({
      where: { id },
      select: { name: true, accounts: { select: { accountId: true } } },
    });
    if (!category) return fail("That category no longer exists.", 404);
    await prisma.mailCategory.delete({ where: { id } });
    await forgetOrphanedInboxes(category.accounts.map((a) => a.accountId));
    await logAuditEvent({ action: "mail-category.delete", userId, targetId: id, metadata: { name: category.name }, request });
    return Response.json({ ok: true });
  }

  return fail("Unknown action.");
}
