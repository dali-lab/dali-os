import { useLayoutEffect, useRef, type ReactNode } from "react";
import { Modal } from "~/components/Modal";
import { modalCardClass } from "~/components/os-chrome";

const SWITCH_WINDOW_MS = 400;
const DURATION_MS = 280;

let previous: { width: number; height: number; at: number } | null = null;

export function isSwitching(at: number | undefined, now: number): boolean {
  return at !== undefined && now - at < SWITCH_WINDOW_MS;
}

const reducedMotion = () =>
  typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function Card({ width, children }: { width: number; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const card = ref.current;
    if (!card) return;
    const from = previous;
    previous = null;
    if (from && isSwitching(from.at, Date.now()) && !reducedMotion()) {
      card.style.maxWidth = `${width}px`;
      card.style.height = "";
      const toHeight = card.offsetHeight;
      card.style.maxWidth = `${from.width}px`;
      card.style.height = `${from.height}px`;
      card.style.overflow = "hidden";
      void card.offsetHeight;
      card.style.transition = `max-width ${DURATION_MS}ms cubic-bezier(0.2, 0.8, 0.2, 1), height ${DURATION_MS}ms cubic-bezier(0.2, 0.8, 0.2, 1)`;
      card.style.maxWidth = `${width}px`;
      card.style.height = `${toHeight}px`;
      const done = window.setTimeout(() => {
        card.style.transition = "";
        card.style.height = "";
        card.style.overflow = "";
      }, DURATION_MS + 40);
      return () => {
        window.clearTimeout(done);
        previous = { width: card.offsetWidth, height: card.offsetHeight, at: Date.now() };
      };
    }
    return () => {
      previous = { width: card.offsetWidth, height: card.offsetHeight, at: Date.now() };
    };
  }, [width]);

  return (
    <div ref={ref} className={modalCardClass("mx-auto")} style={{ maxWidth: width }}>
      <div className="taskboard-panel-content">{children}</div>
    </div>
  );
}

export function PanelFrame({
  width,
  labelledBy,
  onClose,
  children,
}: {
  width: number;
  labelledBy: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <Modal open onClose={onClose} labelledBy={labelledBy} containerClassName="w-full my-auto">
      <Card width={width}>{children}</Card>
    </Modal>
  );
}
