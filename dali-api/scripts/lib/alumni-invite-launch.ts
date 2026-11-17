import { EMAIL_TEMPLATE_KEYS, emailTemplateDef, isEmailTemplateKey, type EmailTemplateKey } from "../../app/email/lib/registry.js";

export type LaunchArgs = {
  batch: string;
  send: boolean;
  only: string[] | null;
  limit: number | null;
  templateKey: EmailTemplateKey;
};

export type LaunchCandidate = {
  id: string;
  firstName: string;
  email: string | null;
  daliEmail: string | null;
  personalEmail: string | null;
};

export type LaunchTarget = { userId: string; firstName: string; address: string };

export const DEFAULT_TEMPLATE_KEY: EmailTemplateKey = "alumni.invite";

function flagValue(argv: string[], flag: string): string | null {
  const i = argv.indexOf(flag);
  return i === -1 ? null : (argv[i + 1] ?? "");
}

export function parseLaunchArgs(argv: string[]): LaunchArgs {
  const batch = flagValue(argv, "--batch")?.trim();
  if (!batch || batch.startsWith("--")) throw new Error("--batch <name> is required.");

  const only = flagValue(argv, "--only");
  const limitRaw = flagValue(argv, "--limit");
  const limit = limitRaw === null ? null : Number(limitRaw);
  if (limit !== null && (!Number.isInteger(limit) || limit < 1)) throw new Error("--limit must be a positive whole number.");

  const template = flagValue(argv, "--template") ?? DEFAULT_TEMPLATE_KEY;
  if (!isEmailTemplateKey(template)) {
    throw new Error(`Unknown template "${template}". Known: ${EMAIL_TEMPLATE_KEYS.filter((k) => !k.startsWith("notify:")).join(", ")}`);
  }
  if (!(emailTemplateDef(template).variables as readonly string[]).includes("inviteLink")) {
    throw new Error(`Template "${template}" does not offer {{inviteLink}}.`);
  }

  return {
    batch,
    send: argv.includes("--send"),
    only: only ? only.split(",").map((s) => s.trim()).filter(Boolean) : null,
    limit,
    templateKey: template,
  };
}

export function inviteAddress(u: Pick<LaunchCandidate, "email" | "daliEmail" | "personalEmail">): string | null {
  const address = [u.personalEmail, u.daliEmail, u.email].map((a) => a?.trim().toLowerCase()).find(Boolean);
  return address ?? null;
}

export function planLaunch(
  candidates: LaunchCandidate[],
  invitedInBatch: ReadonlySet<string>,
  opts: { only: string[] | null; limit: number | null },
): { targets: LaunchTarget[]; noAddress: string[]; withoutPersonal: string[]; alreadyInvited: number } {
  const only = opts.only ? new Set(opts.only) : null;
  const targets: LaunchTarget[] = [];
  const noAddress: string[] = [];
  const withoutPersonal: string[] = [];
  let alreadyInvited = 0;

  for (const u of candidates) {
    if (only && !only.has(u.id)) continue;
    if (invitedInBatch.has(u.id)) {
      alreadyInvited += 1;
      continue;
    }
    const address = inviteAddress(u);
    if (!address) {
      noAddress.push(u.id);
      continue;
    }
    if (!u.personalEmail?.trim()) withoutPersonal.push(u.id);
    targets.push({ userId: u.id, firstName: u.firstName, address });
  }

  return { targets: opts.limit === null ? targets : targets.slice(0, opts.limit), noAddress, withoutPersonal, alreadyInvited };
}

export type LaunchDeps = {
  loadCandidates: () => Promise<LaunchCandidate[]>;
  loadInvitedUserIds: (batch: string) => Promise<string[]>;
  send: (target: LaunchTarget, args: LaunchArgs) => Promise<{ queued: boolean }>;
  log: (line: string) => void;
};

export async function runLaunch(args: LaunchArgs, deps: LaunchDeps): Promise<{ queued: number }> {
  const [candidates, invited] = await Promise.all([deps.loadCandidates(), deps.loadInvitedUserIds(args.batch)]);
  const plan = planLaunch(candidates, new Set(invited), args);

  deps.log(args.send ? `Sending batch "${args.batch}".` : `Dry run for batch "${args.batch}". Pass --send to queue emails.`);
  deps.log(`Alumni not yet onboarded: ${candidates.length}`);
  deps.log(`Already invited in this batch: ${plan.alreadyInvited}`);
  deps.log(`No address at all (skipped): ${plan.noAddress.length}`);
  deps.log(`To invite: ${plan.targets.length}`);
  deps.log(`Without a personal email (invited at a Dartmouth address): ${plan.withoutPersonal.length}`);
  for (const id of plan.withoutPersonal) deps.log(`  ${id}`);

  if (!args.send) return { queued: 0 };

  let queued = 0;
  for (const target of plan.targets) {
    if ((await deps.send(target, args)).queued) queued += 1;
  }
  deps.log(`Queued ${queued} emails.`);
  return { queued };
}
