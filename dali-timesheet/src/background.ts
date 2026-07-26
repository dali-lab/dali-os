import { DALI_ORIGIN, DEVICE_LABEL } from "./config";
import {
  startPairing,
  pollPairing,
  fetchExport,
  SessionExpired,
  NoEntries,
} from "./dali-api";
import type {
  PanelRequest,
  PanelReply,
  PairStartReply,
  PairPollReply,
  PullReply,
  StatusReply,
  SignOutReply,
} from "./messages";

const TOKEN_KEY = "dali_token";
const PAIR_KEY = "pair_session";

async function getToken(): Promise<string | null> {
  const stored = await chrome.storage.local.get(TOKEN_KEY);
  const token = stored[TOKEN_KEY];
  return typeof token === "string" && token.length > 0 ? token : null;
}

function describe(e: unknown): string {
  return e instanceof Error && e.message ? e.message : "Something went wrong.";
}

async function handle(req: PanelRequest): Promise<PanelReply> {
  switch (req.kind) {
    case "status":
      return { paired: (await getToken()) !== null } satisfies StatusReply;

    case "pair-start":
      try {
        const session = await startPairing(DALI_ORIGIN, DEVICE_LABEL);
        // Stash just what poll needs; the token is never held here.
        await chrome.storage.session.set({
          [PAIR_KEY]: {
            deviceCode: session.deviceCode,
            deadline: Date.now() + session.expiresIn * 1000,
          },
        });
        // Open DALI's approval page in a real tab so the user can eyeball the
        // code and is already (or can get) signed in.
        await chrome.tabs.create({ url: session.verificationUrl });
        return {
          ok: true,
          userCode: session.userCode,
          verificationUrl: session.verificationUrl,
          expiresIn: session.expiresIn,
        } satisfies PairStartReply;
      } catch (e) {
        return { ok: false, error: describe(e) } satisfies PairStartReply;
      }

    case "pair-poll": {
      const stored = await chrome.storage.session.get(PAIR_KEY);
      const session = stored[PAIR_KEY] as { deviceCode: string; deadline: number } | undefined;
      if (!session) return { status: "error", message: "No pairing in progress." } satisfies PairPollReply;
      if (Date.now() > session.deadline) {
        await chrome.storage.session.remove(PAIR_KEY);
        return { status: "expired" } satisfies PairPollReply;
      }
      try {
        const poll = await pollPairing(DALI_ORIGIN, session.deviceCode);
        if (poll.status === "approved" && poll.desktopToken) {
          await chrome.storage.local.set({ [TOKEN_KEY]: poll.desktopToken });
          await chrome.storage.session.remove(PAIR_KEY);
          return { status: "approved" } satisfies PairPollReply;
        }
        if (poll.status === "denied") {
          await chrome.storage.session.remove(PAIR_KEY);
          return { status: "denied" } satisfies PairPollReply;
        }
        if (poll.status === "expired" || poll.status === "already_used") {
          await chrome.storage.session.remove(PAIR_KEY);
          return { status: "expired" } satisfies PairPollReply;
        }
        // pending / slow_down → keep waiting.
        return { status: "pending" } satisfies PairPollReply;
      } catch (e) {
        return { status: "error", message: describe(e) } satisfies PairPollReply;
      }
    }

    case "pull": {
      const token = await getToken();
      if (!token) return { ok: false, code: "auth", message: "Not connected to DALI OS." } satisfies PullReply;
      try {
        const data = await fetchExport(DALI_ORIGIN, token, {
          from: req.from,
          to: req.to,
          hire: req.hire,
        });
        return { ok: true, data } satisfies PullReply;
      } catch (e) {
        if (e instanceof SessionExpired) {
          await chrome.storage.local.remove(TOKEN_KEY);
          return { ok: false, code: "auth", message: "Your DALI session expired. Reconnect to continue." } satisfies PullReply;
        }
        if (e instanceof NoEntries) {
          return { ok: false, code: "empty", message: "No logged hours in that range." } satisfies PullReply;
        }
        return { ok: false, code: "error", message: describe(e) } satisfies PullReply;
      }
    }

    case "sign-out":
      await chrome.storage.local.remove(TOKEN_KEY);
      return { ok: true } satisfies SignOutReply;
  }
}

chrome.runtime.onMessage.addListener((req: PanelRequest, _sender, sendResponse) => {
  handle(req)
    .then(sendResponse)
    .catch((e) => sendResponse({ ok: false, code: "error", message: describe(e) }));
  return true; // keep the message channel open for the async reply
});

// Clicking the toolbar icon toggles the panel on the active JobX tab.
chrome.action.onClicked.addListener(async (tab) => {
  if (tab.id == null) return;
  try {
    await chrome.tabs.sendMessage(tab.id, { kind: "toggle-panel" });
  } catch {
    // No content script on this tab (not a JobX page) — nothing to toggle.
  }
});
