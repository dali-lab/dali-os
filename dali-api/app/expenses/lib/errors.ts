import { HttpError } from "~/lib/http-error";
import type { TransitionRejection } from "./status";

export type ExpenseErrorCode = TransitionRejection | "not_found" | "invalid" | "conflict";

function statusFor(code: ExpenseErrorCode): number {
  switch (code) {
    case "forbidden":
    case "self_approval":
      return 403;
    case "not_found":
      return 404;
    case "invalid":
    case "note_required":
    case "incomplete":
      return 400;
    default:
      return 409;
  }
}

export class ExpenseError extends HttpError {
  readonly code: ExpenseErrorCode;
  constructor(code: ExpenseErrorCode, message: string) {
    super(statusFor(code), message);
    this.name = "ExpenseError";
    this.code = code;
  }
}
