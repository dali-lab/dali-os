// Dev-only: screenshot the Partner CRM surfaces against a local dev server.
// Usage: node scripts/crm-shots.mjs http://localhost:3001 /abs/out/dir
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const base = process.argv[2] ?? "http://localhost:3001";
const out = process.argv[3] ?? "/tmp/crm-shots";
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript(() => {
  try {
    localStorage.setItem("dali:theme", "light");
  } catch {}
});
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(`console: ${m.text().slice(0, 300)}`);
});

async function shot(path, name, waitFor) {
  await page.goto(base + path, { waitUntil: "domcontentloaded" });
  if (waitFor) await page.waitForSelector(waitFor, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(1500);
  try {
    await page.screenshot({ path: `${out}/${name}.png`, fullPage: false });
    console.log("shot", name, page.url());
  } catch (e) {
    console.log("FAILED shot", name, page.url(), String(e).slice(0, 200));
  }
}

// Core login.
await page.goto(`${base}/dev-login-as?daliEmail=admin@dali.dartmouth.edu&redirect=${encodeURIComponent(base + "/core/partners")}`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2000);

const from = Number(process.argv[4] ?? 0);
if (from <= 1) await shot("/core/partners", "01-board", '[data-testid="partner-card"]');
const firstCard = from <= 1 ? page.locator('[data-testid="partner-card"]').first() : { count: async () => 0 };
if (await firstCard.count()) {
  await firstCard.click();
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${out}/02-modal-activity.png` });
  console.log("shot 02-modal-activity");
  for (const [i, tab] of ["Details", "Meetings", "Evaluation", "Email"].entries()) {
    const dialog = page.locator('[role="dialog"]');
    const btn = dialog.getByRole("tab", { name: tab }).or(dialog.getByRole("button", { name: tab, exact: true }));
    if (await btn.count()) {
      await btn.first().click();
      await page.waitForTimeout(800);
      await page.screenshot({ path: `${out}/0${3 + i}-modal-${tab.toLowerCase()}.png` });
      console.log("shot modal", tab);
    }
  }
}
await shot("/core/partners/directory", "07-directory", "main");
await shot("/core/partners/applications/papp-hood-kiosk", "08-full-page", "main");
await shot("/core/partners/orgs/partner-hood-museum", "09-org", "main");
await shot("/core/partners/orgs/partner-hood-museum?tab=settings", "09b-org-settings", "main");
await shot("/core/partners/directory?view=contacts", "09c-directory-contacts", "main");
await shot("/core/partners/settings", "09d-settings", "main");

// Partner portal.
await page.goto(`${base}/dev-login-as?personalEmail=partner.tuck@example.com&redirect=${encodeURIComponent(base + "/partner")}`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2000);
await shot("/partner", "10-portal-home", "main");
await shot("/partner/applications/papp-tuck-mentor", "11-portal-application", "main");

console.log("errors:", errors.length);
for (const e of errors.slice(0, 20)) console.log(" ", e);
await browser.close();
