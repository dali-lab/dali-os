import { prisma } from "~/lib/db.server";
import { isFeatureEnabled } from "~/lib/feature-flags.server";
import { currentTerm, type UserRoles } from "~/lib/roles";
import { getInternalCycleApplyTasks } from "~/lib/tasks.server";
import { canFileOnCard } from "~/expenses/lib/access";
import { listCards } from "~/expenses/lib/cards.server";
import { listExpenses } from "~/expenses/lib/expenses.server";
import { loadExpenseViewer } from "~/expenses/lib/viewer.server";
import { walletAppleConfigured } from "~/wallet/lib/wallet-apple.server";
import { walletGoogleConfigured } from "~/wallet/lib/wallet-google.server";
import { listMemberStaffingForms } from "~/projects/lib/member-staffing.server";
import { listMySignedDocuments, listOutstandingBindings } from "~/signing/lib/state.server";
import {
  buildPaperwork,
  graduatingClassYear,
  isDartmouthAddress,
  termLabel,
  type Paperwork,
  type PaperworkInput,
} from "./paperwork";

async function expenseInputs(userId: string, request: Request, enabled: boolean) {
  if (!enabled) return { returnedExpenses: [], unpaidExpenseCount: 0, fileableCards: [] };
  const viewer = await loadExpenseViewer(userId, request);
  const [returned, unpaid, cards] = await Promise.all([
    listExpenses(viewer, "mine", { status: ["RETURNED"] }),
    listExpenses(viewer, "mine", { outstanding: true }),
    listCards(viewer),
  ]);
  return {
    returnedExpenses: returned.map((e) => ({ id: e.id, merchant: e.merchant, totalCents: e.totalCents, decisionNote: e.decisionNote })),
    unpaidExpenseCount: unpaid.length,
    fileableCards: cards.filter((c) => canFileOnCard(viewer, c)).map((c) => ({ nickname: c.nickname, last4: c.last4 })),
  };
}

async function accountInputs(userId: string, roles: UserRoles, now: Date) {
  const [user, appleRegistration, pairing] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        email: true,
        classYear: true,
        graduatedAt: true,
        googleWalletSavedAt: true,
        daliMember: { select: { onboardedAt: true } },
      },
    }),
    prisma.walletPassRegistration.findFirst({ where: { serialNumber: userId }, select: { id: true } }),
    prisma.devicePairing.findFirst({ where: { userId, status: "Consumed" }, select: { id: true } }),
  ]);
  const walletConfigured = walletAppleConfigured() || walletGoogleConfigured();
  const senior = !!user?.classYear && user.classYear <= graduatingClassYear(now) && !user.graduatedAt;
  return {
    wallet: walletConfigured ? { done: !!appleRegistration || !!user?.googleWalletSavedAt } : null,
    graduationEmail: senior ? { done: !!user?.email && !isDartmouthAddress(user.email) } : null,
    onboarding: roles.isStaff ? null : { done: !!user?.daliMember?.onboardedAt },
    desktop: { done: !!pairing },
  };
}

export async function loadPaperworkInput(
  userId: string,
  roles: UserRoles,
  request: Request,
  now = new Date(),
): Promise<PaperworkInput> {
  const [expensesEnabled, referEnabled, term] = await Promise.all([
    isFeatureEnabled("expenses", userId, roles, request),
    isFeatureEnabled("refer-a-partner", userId, roles, request),
    currentTerm(request),
  ]);
  const [expenses, outstanding, signed, staffingForms, classCount, applications, referralCount, certificateCount, account] =
    await Promise.all([
      expenseInputs(userId, request, expensesEnabled),
      listOutstandingBindings(userId, { request }),
      listMySignedDocuments(userId),
      listMemberStaffingForms(userId),
      term ? prisma.memberClass.count({ where: { userId, termId: term.id } }) : Promise.resolve(null),
      getInternalCycleApplyTasks(userId, request),
      referEnabled ? prisma.partnerReferral.count({ where: { referredByUserId: userId } }) : Promise.resolve(0),
      prisma.educationCertificate.count({ where: { application: { applicantUserId: userId } } }),
      accountInputs(userId, roles, now),
    ]);
  return {
    termLabel: termLabel(term),
    ...expenses,
    expensesEnabled,
    outstandingSignatures: outstanding.map((b) => ({ bindingId: b.bindingId, documentName: b.documentName })),
    signedCount: signed.length,
    staffingForms,
    classCount,
    applications,
    referEnabled,
    referralCount,
    feedbackEnabled: roles.isLabMemberOrAlum || roles.isCore,
    certificateCount,
    ...account,
  };
}

export async function loadPaperwork(userId: string, roles: UserRoles, request: Request): Promise<Paperwork> {
  return buildPaperwork(await loadPaperworkInput(userId, roles, request));
}

export async function loadPaperworkCount(userId: string, roles: UserRoles, request: Request): Promise<number> {
  const expensesEnabled = await isFeatureEnabled("expenses", userId, roles, request);
  const [returned, outstanding, staffingForms] = await Promise.all([
    expensesEnabled ? prisma.expense.count({ where: { submitterId: userId, status: "RETURNED" } }) : Promise.resolve(0),
    listOutstandingBindings(userId, { request }),
    listMemberStaffingForms(userId),
  ]);
  return returned + outstanding.length + staffingForms.filter((f) => !f.submitted).length;
}
