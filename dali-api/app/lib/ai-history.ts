export interface AiHistoryEntry {
  role: "user" | "assistant";
  content: string;
}

const HISTORY_ENTRY_MAX = 8000;
const HISTORY_ENTRIES_MAX = 12;

export interface HistoryValidationError {
  ok: false;
  message: string;
}

export interface HistoryValidationOk {
  ok: true;
  entries: AiHistoryEntry[];
}

/**
 * Validates and caps the history array.
 * Rules enforced:
 *   - Must be an array (if provided)
 *   - Max HISTORY_ENTRIES_MAX entries
 *   - Each entry must have role "user" | "assistant" and a string content
 *   - Must start with a "user" entry
 *   - Roles must strictly alternate (user, assistant, user, assistant, …)
 *   - Each content capped at HISTORY_ENTRY_MAX chars
 */
export function validateHistory(
  raw: unknown,
): HistoryValidationOk | HistoryValidationError {
  if (raw === undefined || raw === null) {
    return { ok: true, entries: [] };
  }

  if (!Array.isArray(raw)) {
    return { ok: false, message: "history must be an array" };
  }

  if (raw.length > HISTORY_ENTRIES_MAX) {
    return {
      ok: false,
      message: `history must not exceed ${HISTORY_ENTRIES_MAX} entries`,
    };
  }

  const entries: AiHistoryEntry[] = [];
  for (let i = 0; i < raw.length; i++) {
    const entry = raw[i] as Record<string, unknown>;
    if (!entry || typeof entry !== "object") {
      return { ok: false, message: `history[${i}] must be an object` };
    }
    if (entry.role !== "user" && entry.role !== "assistant") {
      return {
        ok: false,
        message: `history[${i}].role must be "user" or "assistant"`,
      };
    }
    if (typeof entry.content !== "string") {
      return {
        ok: false,
        message: `history[${i}].content must be a string`,
      };
    }

    const expectedRole = i % 2 === 0 ? "user" : "assistant";
    if (entry.role !== expectedRole) {
      if (i === 0) {
        return {
          ok: false,
          message: "history must start with a user entry",
        };
      }
      return {
        ok: false,
        message: `history roles must alternate; expected "${expectedRole}" at index ${i}, got "${entry.role}"`,
      };
    }

    entries.push({
      role: entry.role as "user" | "assistant",
      content: (entry.content as string).slice(0, HISTORY_ENTRY_MAX),
    });
  }

  return { ok: true, entries };
}
