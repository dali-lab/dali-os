import { useCallback, useState } from "react";
import { prepareReceiptFiles, ReceiptUploadError, uploadReceiptFiles } from "./receipt-upload";
import type { ExpenseActions } from "./useExpenseActions";

export type IntakeStage = "idle" | "preparing" | "uploading" | "reading";

export function useReceiptIntake(actions: Pick<ExpenseActions, "submit">, extra: { cardId?: string } = {}) {
  const [stage, setStage] = useState<IntakeStage>("idle");
  const [count, setCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const cardId = extra.cardId;

  const start = useCallback(
    async (files: File[]) => {
      setError(null);
      setCount(files.length);
      try {
        setStage("preparing");
        const prepared = await prepareReceiptFiles(files);
        setStage("uploading");
        const keys = await uploadReceiptFiles(prepared);
        setStage("reading");
        actions.submit("create", {
          keys: JSON.stringify(keys),
          ...(cardId ? { cardId, paidWith: "STAFF_CARD" } : {}),
        });
      } catch (e) {
        setStage("idle");
        setError(e instanceof ReceiptUploadError ? e.message : "Something went wrong uploading. Try again.");
      }
    },
    [actions, cardId],
  );

  const finish = useCallback(() => setStage("idle"), []);
  return { stage, count, error, start, finish, busy: stage !== "idle" };
}
