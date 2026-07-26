import type { TimesheetExport } from "./types";

// Typed request/response protocol between the on-page panel (content script)
// and the service worker. The worker owns the token + all network; the panel
// only ever asks. Keeping every exchange short-lived means it survives the
// service worker being torn down between calls (MV3).

export type PanelRequest =
  | { kind: "status" }
  | { kind: "pair-start" }
  | { kind: "pair-poll" }
  | { kind: "pull"; from?: string; to?: string; hire?: string }
  | { kind: "sign-out" };

export type StatusReply = { paired: boolean };

export type PairStartReply =
  | { ok: true; userCode: string; verificationUrl: string; expiresIn: number }
  | { ok: false; error: string };

export type PairPollReply = {
  status: "pending" | "approved" | "denied" | "expired" | "error";
  message?: string;
};

export type PullReply =
  | { ok: true; data: TimesheetExport }
  | { ok: false; code: "auth" | "empty" | "error"; message: string };

export type SignOutReply = { ok: true };

export type PanelReply =
  | StatusReply
  | PairStartReply
  | PairPollReply
  | PullReply
  | SignOutReply;

// Worker → panel, fire-and-forget (e.g. the toolbar icon toggling the panel).
export type WorkerPush = { kind: "toggle-panel" };

export function sendToWorker<R extends PanelReply>(req: PanelRequest): Promise<R> {
  return chrome.runtime.sendMessage(req) as Promise<R>;
}
