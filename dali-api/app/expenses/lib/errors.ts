import type { TransitionRejection } from "./status";

export type ExpenseErrorCode = TransitionRejection | "not_found" | "invalid" | "conflict";

export class ExpenseError extends Error {
  readonly code: ExpenseErrorCode;
  constructor(code: ExpenseErrorCode, message: string) {
    super(message);
    this.name = "ExpenseError";
    this.code = code;
  }
  get status(): number {
    switch (this.code) {
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
}
