import { test } from './fixtures';

/**
 * Warm the Vite dev server's on-demand route compilation before the parallel
 * test workers start.
 *
 * E2E runs against `npm run dev`, which transforms each route tree (SSR module
 * graph + client chunks) lazily on first navigation. On the 2-vCPU CI runner,
 * several workers cold-compiling heavy routes at the same moment saturate the
 * single dev process, so the first `page.goto` into a large tree (partner
 * portal, project board, admin console) can blow past the per-test timeout —
 * and the retry stays slow because the server is still compile-bound. Doing one
 * serial pass over those trees here primes Vite's shared cache so every later
 * test navigates warm.
 *
 * Best-effort: warming must never fail the suite (dependent projects are gated
 * on it), so every navigation is bounded and its errors swallowed — the goal is
 * to trigger compilation, not to assert anything. Keep the route lists roughly
 * in sync with the heaviest trees the specs exercise.
 */

const ADMIN_EMAIL = 'admin@dali.dartmouth.edu';
const PARTNER_EMAIL = 'partner.tuck@example.com';

// Member/admin shell — the embed=1 iframe routes and consoles the partner,
// kanban and domain-management specs navigate into.
const ADMIN_ROUTES = [
  '/partners?embed=1',
  '/partners/partner-tuck-school?embed=1',
  '/projects/project-tuck-alumni?tab=details&embed=1',
  '/projects/project-tuck-alumni?tab=drive&embed=1',
  '/projects/project-dali-os?tab=board&embed=1',
  '/core/access/domains',
  '/admin/members',
];

// Partner portal — a separate layout from the member shell.
const PARTNER_ROUTES = ['/partner', '/partner/projects/project-tuck-alumni'];

test('warm up dev-server route compilation', async ({ page }) => {
  // A single cold compile of a heavy tree can take tens of seconds on a 2-vCPU
  // runner; give the whole pass a wide budget so it primes every route.
  test.setTimeout(240_000);

  const warm = async (loginQuery: string, routes: string[]) => {
    try {
      await page.goto(`/dev-login-as?${loginQuery}`, { waitUntil: 'load', timeout: 60_000 });
      await page.waitForLoadState('networkidle').catch(() => {});
    } catch {
      return; // login unreachable — the tests' own retries will cold-compile
    }
    for (const route of routes) {
      try {
        await page.goto(route, { waitUntil: 'load', timeout: 60_000 });
        await page.waitForLoadState('networkidle').catch(() => {});
      } catch {
        // A slow/failed warm navigation is fine — compilation still happened.
      }
    }
  };

  await warm(`daliEmail=${ADMIN_EMAIL}`, ADMIN_ROUTES);
  await warm(`personalEmail=${encodeURIComponent(PARTNER_EMAIL)}`, PARTNER_ROUTES);
});
