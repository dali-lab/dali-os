/**
 * One-off: (re)send the instant email for announcement Notification rows that
 * never got one — e.g. the whole-lab announcement whose emails all failed while
 * the General Gmail sender was misconfigured (rows landed in-app with
 * emailedAt = null). This emails the EXISTING rows and stamps emailedAt; it does
 * NOT create new Notification rows, so nobody gets a duplicate in-app entry.
 *
 * Reuses the app's fixed send path (getSender + sendEmail with the sender's own
 * `from`), so it only works correctly on this branch / once #1222 is deployed.
 *
 * Targets rows: eventType='announcement', emailedAt IS NULL, unread or not,
 * optionally narrowed by --since / --until (createdAt window) or --title.
 * Dry-run by default — prints exactly who would be emailed. Pass --commit to send.
 *
 * Runs against DATABASE_URL (point .env at prod, same creds you use for psql).
 * sendEmail honors DALI_APP_ENV: dev skips, staging redirects to systems@, prod
 * sends for real — so set DALI_APP_ENV=prod to actually deliver.
 *
 * Usage:
 *   DALI_APP_ENV=prod tsx --env-file .env scripts/resend-announcement-emails.ts \
 *     --since=2026-08-12T21:00:00Z --until=2026-08-12T21:30:00Z            # dry run
 *   DALI_APP_ENV=prod tsx --env-file .env scripts/resend-announcement-emails.ts \
 *     --since=2026-08-12T21:00:00Z --until=2026-08-12T21:30:00Z --commit   # send
 */
import { prisma } from "../app/lib/db";
import { sendEmail } from "../app/lib/gmail";
import { getSender, noteSenderHealth } from "../app/lib/gmail-integration";
import { renderNotificationEmail } from "../app/lib/notify.server";
import { getAppEnv, getFrontendUrl } from "../app/lib/app-env";
import { notificationRecipientEmails } from "../app/lib/email";

const COMMIT = process.argv.includes("--commit");
const arg = (name: string) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");

const since = arg("since");
const until = arg("until");
const titleContains = arg("title");

function absoluteLink(link: string | null): string | null {
  if (!link) return null;
  if (/^https?:\/\//.test(link)) return link;
  return `${getFrontendUrl()}${link.startsWith("/") ? "" : "/"}${link}`;
}

async function main() {
  if (!since && !until && !titleContains) {
    console.error(
      "Refusing to run unfiltered. Pass --since / --until (createdAt window) or --title to scope the announcement.",
    );
    process.exit(1);
  }

  const env = getAppEnv();
  console.log(`DALI_APP_ENV=${env}  mode=${COMMIT ? "COMMIT" : "dry-run"}`);
  if (env === "dev") {
    console.log("⚠ dev — sendEmail skips real delivery. Set DALI_APP_ENV=prod to send.");
  } else if (env === "staging") {
    console.log("⚠ staging — every email redirects to systems@dali.dartmouth.edu.");
  }

  const rows = await prisma.notification.findMany({
    where: {
      eventType: "announcement",
      emailedAt: null,
      ...(since || until
        ? { createdAt: { ...(since ? { gte: new Date(since) } : {}), ...(until ? { lte: new Date(until) } : {}) } }
        : {}),
      ...(titleContains ? { title: { contains: titleContains } } : {}),
    },
    select: { id: true, recipientUserId: true, title: true, body: true, link: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });

  if (rows.length === 0) {
    console.log("No matching un-emailed announcement rows.");
    return;
  }

  const users = await prisma.user.findMany({
    where: { id: { in: [...new Set(rows.map((r) => r.recipientUserId))] } },
    select: { id: true, firstName: true, daliEmail: true, dartmouthEmail: true, personalEmail: true, netId: true },
  });
  const userById = new Map(users.map((u) => [u.id, u]));

  const recipientEmail = (u: (typeof users)[number]) => notificationRecipientEmails(u).join(", ") || null;

  console.log(`\n${rows.length} un-emailed row(s):`);
  for (const r of rows) {
    const u = userById.get(r.recipientUserId);
    const to = u ? recipientEmail(u) : null;
    console.log(`  ${r.createdAt.toISOString()}  ${to ?? "<no email>"}  «${r.title}»`);
  }

  if (!COMMIT) {
    console.log("\nDry run — pass --commit to send.");
    return;
  }

  const sender = await getSender("General");
  if (!sender) {
    console.error("No General/Hiring Gmail sender connected — nothing to send from.");
    process.exit(1);
  }
  console.log(`\nSending as ${sender.sendAsEmail} …`);

  let emailed = 0;
  let lastError: string | null = null;
  for (const r of rows) {
    const u = userById.get(r.recipientUserId);
    const to = u ? recipientEmail(u) : null;
    if (!u || !to) {
      console.log(`  skip ${r.recipientUserId}: no email`);
      continue;
    }
    try {
      await sendEmail({
        refreshToken: sender.refreshToken,
        from: sender.sendAsEmail,
        to,
        subject: r.title,
        html: renderNotificationEmail({
          firstName: u.firstName,
          title: r.title,
          body: r.body,
          link: absoluteLink(r.link),
        }),
      });
      await prisma.notification.update({ where: { id: r.id }, data: { emailedAt: new Date() } });
      emailed++;
      console.log(`  sent ${to}`);
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      console.error(`  FAILED ${to}: ${lastError}`);
    }
  }

  await noteSenderHealth(sender.id, emailed === 0 ? lastError : null);
  console.log(`\nDone: ${emailed}/${rows.length} emailed.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
