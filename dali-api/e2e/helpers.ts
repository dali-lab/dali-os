import { expect, type Page } from '@playwright/test';
import pg from 'pg';

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://dali:dali@localhost:5432/dali';

/**
 * Assert that neither the main document nor any child frames overflow the
 * viewport horizontally. Tolerates 1px of sub-pixel rounding error.
 *
 * @param page - Playwright Page instance
 * @param opts.soft - When true, record violations via expect.soft() so the
 *   test continues rather than stopping on the first failure (report-only
 *   mode). Default: false (hard assert).
 * @param opts.label - Human-readable label for the route, included in the
 *   assertion message so failures are easy to triage. Defaults to page.url().
 */
export async function assertNoHorizontalOverflow(
  page: Page,
  opts?: { soft?: boolean; label?: string },
) {
  const { soft = false, label } = opts ?? {};
  const viewportSize = page.viewportSize();
  const viewportWidth = viewportSize?.width ?? 0;
  const routeLabel = label ?? page.url();

  const assert = soft
    ? (value: number, message: string) =>
        expect.soft(value, message).toBeLessThanOrEqual(viewportWidth + 1)
    : (value: number, message: string) =>
        expect(value, message).toBeLessThanOrEqual(viewportWidth + 1);

  // Check the main frame (outer document).
  const outerScrollWidth = await page.evaluate(
    () => document.documentElement.scrollWidth,
  );
  await assert(
    outerScrollWidth,
    `[${routeLabel}] outer document scrollWidth (${outerScrollWidth}px) exceeds viewport (${viewportWidth}px)`,
  );

  // Check child frames defensively — mobile is tabless (no iframes) but a
  // route might embed one (e.g. a video or third-party widget).
  for (const frame of page.frames()) {
    if (frame === page.mainFrame()) continue;
    const frameScrollWidth = await frame
      .evaluate(() => document.documentElement.scrollWidth)
      .catch(() => 0);
    if (frameScrollWidth <= 0) continue;
    const frameTitle = await frame
      .frameElement()
      .then((el) => el.getAttribute('title'))
      .catch(() => null);
    const frameLabel = frameTitle ? `iframe[${frameTitle}]` : 'iframe[(untitled)]';
    await assert(
      frameScrollWidth,
      `[${routeLabel}] ${frameLabel} scrollWidth (${frameScrollWidth}px) exceeds viewport (${viewportWidth}px)`,
    );
  }
}

/**
 * Delete any status updates beyond the seed baseline (Draft → Open) for
 * the given cycle. Used to revert cycle state after tests that advance it.
 */
export async function resetCycleStatus(cycleId: string) {
  const client = new pg.Client(DATABASE_URL);
  await client.connect();
  try {
    // Keep only the two seed rows (Draft and Open); delete any test-added rows.
    await client.query(
      `DELETE FROM "ApplicationCycleStatusUpdate"
       WHERE "applicationCycleId" = $1
         AND "newStatus" NOT IN ('Draft', 'Open')`,
      [cycleId],
    );
  } finally {
    await client.end();
  }
}

/**
 * Remove education applications (plus their attendance rows and linked form
 * submissions) for one offering so the RSVP → waitlist → promotion spec
 * always starts from empty seats, regardless of what a prior run left.
 */
export async function resetEducationApplications(offeringId: string) {
  const client = new pg.Client(DATABASE_URL);
  await client.connect();
  try {
    await client.query(
      `DELETE FROM "EducationAttendance"
       WHERE "applicationId" IN
         (SELECT id FROM "EducationApplication" WHERE "offeringId" = $1)`,
      [offeringId],
    );
    await client.query(
      `DELETE FROM "FormSubmission"
       WHERE id IN
         (SELECT "formSubmissionId" FROM "EducationApplication"
          WHERE "offeringId" = $1 AND "formSubmissionId" IS NOT NULL)`,
      [offeringId],
    );
    await client.query(
      `DELETE FROM "EducationApplication" WHERE "offeringId" = $1`,
      [offeringId],
    );
  } finally {
    await client.end();
  }
}
