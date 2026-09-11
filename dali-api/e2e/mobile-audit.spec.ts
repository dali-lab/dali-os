import { test } from './fixtures';
import { assertNoHorizontalOverflow } from './helpers';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Mobile UX audit @mobile. Loads every internal route under a Pixel 7 UA
 * (Android / tabless shell), screenshots full-page, and flags routes whose
 * document or any iframe overflows the viewport horizontally.
 *
 * The mobile project in playwright.config.ts drives this spec:
 *   npx playwright test --project=mobile-pixel7
 *
 * All overflow checks are SOFT (report-only). To make them blocking, change
 * the `{ soft: true }` in the assertNoHorizontalOverflow call to
 * `{ soft: false }` (or omit opts) after verifying the routes pass.
 *
 * Output: e2e/.mobile-audit/ — one PNG per route + report.json.
 */

const OUTPUT_DIR = path.join(__dirname, '.mobile-audit');

// Admin account has access to every internal route. Detail pages with `:id`
// parameters are intentionally omitted from this static list — they can be
// added once we want per-detail-page audits.
const AUDIT_USER = 'kiran.jones@dali.dartmouth.edu';

const ROUTES: Array<{ path: string; label: string }> = [
  // --- original 15 routes ---
  { path: '/', label: 'home' },
  { path: '/calendar', label: 'calendar' },
  { path: '/hiring/reviewer', label: 'hiring-reviewer' },
  { path: '/hiring/domain-lead', label: 'hiring-domain-lead' },
  { path: '/hiring/lead', label: 'hiring-lead' },
  { path: '/hiring/library', label: 'hiring-library' },
  { path: '/admin/email-templates', label: 'admin-email-templates' },
  { path: '/hiring', label: 'hiring-hub' },
  { path: '/hiring/interviews', label: 'hiring-interviews' },
  { path: '/admin/members', label: 'admin-members' },
  { path: '/admin/domains', label: 'admin-domains' },
  { path: '/projects', label: 'projects-list' },
  { path: '/projects/staffing', label: 'projects-staffing' },
  { path: '/members', label: 'members' },
  { path: '/partners', label: 'partners' },
  // --- expanded routes ---
  { path: '/drive', label: 'drive' },
  { path: '/education', label: 'education' },
  // "My Tasks" in the nav is the /notifications route (see routes.ts line 19)
  { path: '/notifications', label: 'my-tasks' },
  // /members is already in the list above; /people does not exist as a route —
  // the canonical directory URL is /members.
  { path: '/admin/jobs', label: 'admin-jobs' },
  { path: '/admin/feature-flags', label: 'admin-feature-flags' },
  { path: '/core', label: 'core' },
];

// Routes considered but DROPPED (do not exist in app/routes.ts):
//   /my-tasks  — the nav calls it "My Tasks" but the route is /notifications
//   /people    — no such route; /members is the canonical member directory

type Finding = {
  route: string;
  label: string;
  outerScrollWidth: number;
  outerOverflow: boolean;
  iframeFindings: Array<{ title: string; scrollWidth: number; overflow: boolean }>;
};

test.describe('mobile audit @mobile', () => {
  // Viewport is provided by the mobile-pixel7 project (375×812). No
  // test.use({ viewport }) override here — keep it driven by the project.

  const findings: Finding[] = [];

  test.beforeAll(async () => {
    await fs.mkdir(OUTPUT_DIR, { recursive: true });
  });

  test.afterAll(async () => {
    const reportPath = path.join(OUTPUT_DIR, 'report.json');
    await fs.writeFile(reportPath, JSON.stringify(findings, null, 2));
    const overflowing = findings.filter(
      (f) => f.outerOverflow || f.iframeFindings.some((i) => i.overflow),
    );
    // eslint-disable-next-line no-console
    console.log(
      `\nMobile audit complete. ${findings.length} routes checked, ${overflowing.length} flagged.`,
    );
    for (const f of overflowing) {
      const reasons = [
        f.outerOverflow ? `outer=${f.outerScrollWidth}px` : null,
        ...f.iframeFindings
          .filter((i) => i.overflow)
          .map((i) => `iframe[${i.title}]=${i.scrollWidth}px`),
      ].filter(Boolean);
      // eslint-disable-next-line no-console
      console.log(`  - ${f.label} (${f.route}): ${reasons.join(', ')}`);
    }
  });

  for (const { path: routePath, label } of ROUTES) {
    test(`${label} (${routePath})`, async ({ page, loginAs }) => {
      const viewportWidth = page.viewportSize()?.width ?? 375;

      await loginAs({ daliEmail: AUDIT_USER });
      await page.goto(routePath);
      await page.waitForLoadState('networkidle').catch(() => undefined);
      // Give iframes a beat to render their own content.
      await page.waitForTimeout(500);

      // Collect raw measurements for the JSON report (independent of soft-assert).
      const outerScrollWidth = await page.evaluate(
        () => document.documentElement.scrollWidth,
      );
      const outerOverflow = outerScrollWidth > viewportWidth + 1;

      const iframeFindings: Finding['iframeFindings'] = [];
      for (const frame of page.frames()) {
        if (frame === page.mainFrame()) continue;
        const title = await frame
          .frameElement()
          .then((el) => el.getAttribute('title'))
          .catch(() => null);
        const scrollWidth = await frame
          .evaluate(() => document.documentElement.scrollWidth)
          .catch(() => 0);
        if (scrollWidth > 0) {
          iframeFindings.push({
            title: title ?? '(untitled)',
            scrollWidth,
            overflow: scrollWidth > viewportWidth + 1,
          });
        }
      }

      await page.screenshot({
        path: path.join(OUTPUT_DIR, `${label}.png`),
        fullPage: true,
      });

      findings.push({
        route: routePath,
        label,
        outerScrollWidth,
        outerOverflow,
        iframeFindings,
      });

      // REPORT-ONLY: soft assertions record violations without stopping the test.
      // To make this blocking, change `{ soft: true }` to `{ soft: false }` (or
      // remove opts entirely) once you've verified each route passes on a live DB.
      await assertNoHorizontalOverflow(page, { soft: true, label });
    });
  }
});
