import { test, expect } from './fixtures';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Mobile UX audit. Loads every internal route at iPhone-class width (375x812),
 * screenshots full-page, and flags routes whose document or any iframe overflows
 * the viewport horizontally. Run with:
 *
 *   npx playwright test e2e/mobile-audit.spec.ts --project=chromium
 *
 * Output: e2e/.mobile-audit/ — one PNG per route + report.json.
 */

const OUTPUT_DIR = path.join(__dirname, '.mobile-audit');
const VIEWPORT = { width: 375, height: 812 };

// Admin account has access to every internal route. Detail pages with `:id`
// parameters are intentionally omitted from this static list — they can be
// added once we want per-detail-page audits.
const AUDIT_USER = 'kiran.jones@dali.dartmouth.edu';

const ROUTES: Array<{ path: string; label: string }> = [
  { path: '/', label: 'home' },
  { path: '/calendar', label: 'calendar' },
  { path: '/hiring/reviewer', label: 'hiring-reviewer' },
  { path: '/hiring/domain-lead', label: 'hiring-domain-lead' },
  { path: '/hiring/lead', label: 'hiring-lead' },
  { path: '/hiring/library', label: 'hiring-library' },
  { path: '/hiring/emails', label: 'hiring-emails' },
  { path: '/hiring/interviewer', label: 'hiring-interviewer' },
  { path: '/hiring/analytics', label: 'hiring-analytics' },
  { path: '/admin-console/members', label: 'admin-members' },
  { path: '/admin-console/domains', label: 'admin-domains' },
  { path: '/projects/list', label: 'projects-list' },
  { path: '/projects/staffing', label: 'projects-staffing' },
  { path: '/members', label: 'members' },
  { path: '/partners', label: 'partners' },
];

type Finding = {
  route: string;
  label: string;
  outerScrollWidth: number;
  outerOverflow: boolean;
  iframeFindings: Array<{ title: string; scrollWidth: number; overflow: boolean }>;
};

test.describe('mobile audit @ 375x812', () => {
  test.use({ viewport: VIEWPORT });

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
      await loginAs({ daliEmail: AUDIT_USER });
      await page.goto(routePath);
      await page.waitForLoadState('networkidle').catch(() => undefined);
      // Give iframes a beat to render their own content.
      await page.waitForTimeout(500);

      const outerScrollWidth = await page.evaluate(
        () => document.documentElement.scrollWidth,
      );
      const outerOverflow = outerScrollWidth > VIEWPORT.width;

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
            overflow: scrollWidth > VIEWPORT.width,
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

      // Soft-assert: don't fail the test on overflow — we want full coverage
      // and the JSON report. The summary in afterAll lists violations.
      expect(outerScrollWidth, `outer doc scrollWidth on ${routePath}`).toBeLessThanOrEqual(
        VIEWPORT.width + 1,
      );
    });
  }
});
