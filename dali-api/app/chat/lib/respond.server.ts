import { mobileError, mobileJson } from "~/lib/mobile-auth.server";
import type { ChatResult } from "~/chat/lib/chat.server";

export function respond<T>(result: ChatResult<T>, toBody: (data: T) => unknown): Response {
  return result.ok ? mobileJson(toBody(result.data)) : mobileError(result.error, result.status);
}

export function methodNotAllowed(): Response {
  return mobileError("Method not allowed", 405);
}
