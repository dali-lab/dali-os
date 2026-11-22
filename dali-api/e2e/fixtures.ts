import { test as base, type BrowserContext } from '@playwright/test';

type LoginOptions = { netId?: string; daliEmail?: string; personalEmail?: string };

// Keys must match DONE_KEY in LaunchWelcome.tsx and DISMISS_KEY in AlumniGameInvite.tsx.
const LAUNCH_WELCOME_SEEN_KEY = 'dalios-launch-welcome-seen-v1';
const ALUMNI_INVITE_DISMISSED_KEY = 'dalios-alumni-game-invite-dismissed-v1';

/** Marks the full-screen first-run prompts seen so their overlays never block clicks. */
export async function dismissFirstRunPrompts(context: BrowserContext, baseURL: string | undefined) {
  await context.addInitScript(
    ([welcome, invite]) => {
      try {
        window.localStorage.setItem(welcome, 'e2e');
        window.sessionStorage.setItem(invite, 'e2e');
      } catch {
        // Storage unavailable (e.g. about:blank)
      }
    },
    [LAUNCH_WELCOME_SEEN_KEY, ALUMNI_INVITE_DISMISSED_KEY],
  );
  // dali_pk_prompt=1 is "passkey offer dismissed" (PASSKEY_PROMPT_COOKIE in app/lib/passkey-prompt.server.ts).
  if (baseURL) await context.addCookies([{ name: 'dali_pk_prompt', value: '1', url: baseURL }]);
}

export const test = base.extend<{ loginAs: (opts: LoginOptions) => Promise<void> }>({
  page: async ({ page, baseURL }, use) => {
    await dismissFirstRunPrompts(page.context(), baseURL);
    await page.addInitScript(() => {
      try {
        // The Drive suite predates the Miller-columns view and exercises
        // list/grid behaviour (bulk-select, drag-and-drop, dblclick nav). Pin
        // List view so those specs run against the UI they were written for;
        // column view (the app default) is covered separately.
        window.localStorage.setItem('dali_drive_view', 'list');
      } catch {
        // localStorage unavailable (e.g. about:blank) — ignore.
      }
    });
    await page.route(
      (url) => !['localhost', '127.0.0.1'].includes(url.hostname),
      (route) => (route.request().resourceType() === 'image' ? route.abort() : route.continue()),
    );
    await use(page);
  },
  loginAs: async ({ page }, use) => {
    await use(async ({ netId, daliEmail, personalEmail }: LoginOptions) => {
      const params = new URLSearchParams();
      if (daliEmail) params.set('daliEmail', daliEmail);
      else if (personalEmail) params.set('personalEmail', personalEmail);
      else if (netId) params.set('netId', netId);
      // Not networkidle: the notification stream and collab socket keep connections open.
      const res = await page.goto(`/dev-login-as?${params}`, { waitUntil: 'domcontentloaded' });
      if (new URL(page.url()).pathname.startsWith('/dev-login-as')) {
        throw new Error(`loginAs(${params}) failed: ${res?.status()} ${await res?.text()}`);
      }
    });
  },
});

export { expect } from '@playwright/test';
