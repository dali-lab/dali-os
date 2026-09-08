import { useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";

type CheckInData = { presentCount: number; totalCount: number } | null;

/**
 * Polls /api/education/sessions/:id/check-in every 10 seconds while the
 * document is visible, and shows "{present} of {total} in".
 */
export function LiveCheckInCount({
  sessionId,
  initialPresent = 0,
  initialTotal = 0,
}: {
  sessionId: string;
  initialPresent?: number;
  initialTotal?: number;
}) {
  const fetcher = useFetcher<CheckInData>();
  const [data, setData] = useState<{ present: number; total: number }>({
    present: initialPresent,
    total: initialTotal,
  });
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function poll() {
    if (document.visibilityState !== "visible") return;
    fetcher.load(`/api/education/sessions/${sessionId}/check-in`);
  }

  useEffect(() => {
    // Initial poll
    poll();

    intervalRef.current = setInterval(poll, 10_000);

    const onVisibility = () => {
      if (document.visibilityState === "visible") poll();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      document.removeEventListener("visibilitychange", onVisibility);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  useEffect(() => {
    if (fetcher.data) {
      setData({ present: fetcher.data.presentCount, total: fetcher.data.totalCount });
    }
  }, [fetcher.data]);

  return (
    <span className="inline-flex items-center gap-1.5 text-sm text-white/80">
      <span className="font-heading text-xl font-bold text-white">{data.present}</span>
      <span>of</span>
      <span className="font-heading text-xl font-bold text-white">{data.total}</span>
      <span>in</span>
    </span>
  );
}
