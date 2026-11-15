export const IMPERSONATE_ERROR_PARAM = "impersonateError";

export const IMPERSONATE_ERROR_MESSAGES = {
  missing: "That user no longer exists.",
  self: "You can't log in as yourself.",
  failed: "Couldn't log in as that user. Try again.",
} as const;

export type ImpersonateError = keyof typeof IMPERSONATE_ERROR_MESSAGES;

export function impersonateErrorMessage(value: string | null): string | null {
  return value && Object.hasOwn(IMPERSONATE_ERROR_MESSAGES, value)
    ? IMPERSONATE_ERROR_MESSAGES[value as ImpersonateError]
    : null;
}
