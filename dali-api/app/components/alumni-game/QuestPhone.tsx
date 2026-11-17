import { useEffect, useRef, useState } from "react";
import {
  QUEST_FIELDS,
  nextQuestField,
  questPercent,
  renderQuestion,
  type QuestFieldKey,
  type QuestProfile,
} from "./quest";

export type ChatMessage = { from: "tim" | "you"; text: string };

type QuestResponse = {
  ok?: boolean;
  percent?: number;
  profile?: QuestProfile;
  say?: string | null;
  messages?: ChatMessage[];
  error?: string;
};

async function postQuest(body: Record<string, unknown>): Promise<QuestResponse> {
  try {
    const res = await fetch("/api/alumni-game/quest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return (await res.json()) as QuestResponse;
  } catch {
    return { error: "hmm i think i lost signal, try that again?" };
  }
}

export function QuestPhone({
  profile: initialProfile,
  accepted,
  messages,
  appendMessages,
  onAccepted,
  onProfileChange,
  onClose,
}: {
  profile: QuestProfile;
  accepted: boolean;
  messages: ChatMessage[];
  appendMessages: (ms: ChatMessage[]) => void;
  onAccepted: () => void;
  onProfileChange: (profile: QuestProfile) => void;
  onClose: () => void;
}) {
  const [profile, setProfile] = useState(initialProfile);
  const [skipped, setSkipped] = useState<QuestFieldKey[]>([]);
  const [asking, setAsking] = useState<QuestFieldKey | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  const started = useRef(false);

  const percent = questPercent(profile);
  const tim = (text: string) => appendMessages([{ from: "tim", text }]);

  const askNext = (p: QuestProfile, skip: QuestFieldKey[], silent = false) => {
    const next = nextQuestField(p, skip);
    setAsking(next?.key ?? null);
    if (silent) return;
    if (next) {
      tim(renderQuestion(next));
    } else if (questPercent(p) >= 100) {
      tim("that's a complete profile!  you're officially settled in, welcome back to the lab!!");
    } else {
      tim("that's all my questions for now!  you can finish the rest on your profile page anytime");
    }
  };

  useEffect(() => {
    if (!accepted || started.current) return;
    started.current = true;
    if (messages.length > 0) {
      // Picking up where we left off: the transcript already says it all.
      setAsking(nextQuestField(initialProfile, [])?.key ?? null);
      return;
    }
    // Accepted before transcripts existed: greet locally.
    if (questPercent(initialProfile) >= 100) {
      tim("your profile is all set!  thanks again, enjoy the lab!");
      return;
    }
    tim("so glad we're catching up!  let's get your profile filled in");
    askNext(initialProfile, []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accepted]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [messages, busy]);

  async function accept() {
    setBusy(true);
    const res = await postQuest({ intent: "accept" });
    setBusy(false);
    if (res.error) {
      tim(res.error);
      return;
    }
    if (res.messages) appendMessages(res.messages);
    if (res.profile) setAsking(nextQuestField(res.profile, [])?.key ?? null);
    started.current = true;
    onAccepted();
  }

  async function submit() {
    const value = input.trim();
    const field = QUEST_FIELDS.find((f) => f.key === asking);
    if (!value || !field || busy) return;
    appendMessages([{ from: "you", text: value }]);
    setInput("");
    setBusy(true);
    const res = await postQuest({
      intent: "answer",
      field: field.key,
      value,
      skipped,
      history: [...messages.slice(-10), { from: "you", text: value }],
    });
    setBusy(false);
    if (res.error || !res.profile) {
      tim(res.error ?? "hmm that didn't go through, try again?");
      return;
    }
    setProfile(res.profile);
    onProfileChange(res.profile);
    if (res.say) {
      tim(res.say);
      askNext(res.profile, skipped, true);
    } else {
      askNext(res.profile, skipped);
    }
  }

  function skip() {
    if (!asking || busy) return;
    if (QUEST_FIELDS.find((f) => f.key === asking)?.required) return;
    const nextSkipped = [...skipped, asking];
    setSkipped(nextSkipped);
    appendMessages([{ from: "you", text: "Skip that one" }]);
    tim("no worries!");
    askNext(profile, nextSkipped);
  }

  return (
    <aside className="ag-phone" aria-label="Phone">
      <div className="ag-phone-notch" />
      <header className="ag-phone-header">
        <span className="ag-phone-contact">Tim</span>
        <button type="button" className="ag-phone-close" onClick={onClose} aria-label="Put phone away">
          ✕
        </button>
      </header>
      <div className="ag-phone-progress" role="meter" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} aria-label="Profile completion">
        <div className="ag-phone-progress-bar" style={{ width: `${percent}%` }} />
        <span className="ag-phone-progress-label">Profile {percent}%</span>
      </div>
      {accepted ? (
        <>
          <div className="ag-phone-log" ref={logRef}>
            {messages.map((m, i) => (
              <p key={i} className="ag-msg" data-from={m.from}>
                {m.text}
              </p>
            ))}
            {busy ? (
              <p className="ag-msg" data-from="tim">
                ...
              </p>
            ) : null}
          </div>
          {asking ? (
            <form
              className="ag-phone-input"
              onSubmit={(e) => {
                e.preventDefault();
                submit();
              }}
            >
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={QUEST_FIELDS.find((f) => f.key === asking)?.placeholder}
                aria-label="Your reply"
                autoFocus
              />
              <button type="submit" disabled={busy || input.trim() === ""}>
                Send
              </button>
              {QUEST_FIELDS.find((f) => f.key === asking)?.required ? null : (
                <button type="button" onClick={skip} disabled={busy}>
                  Skip
                </button>
              )}
            </form>
          ) : null}
        </>
      ) : (
        <div className="ag-phone-offer">
          <p className="ag-msg" data-from="tim">
            hi!  I wanted to reach out and welcome you back to DALI!  answer a few questions and
            I'll fill in your alumni profile as we go, deal?
          </p>
          <div className="ag-phone-offer-actions">
            <button type="button" onClick={accept} disabled={busy}>
              Accept quest
            </button>
            <button type="button" onClick={onClose} disabled={busy}>
              Maybe later
            </button>
          </div>
        </div>
      )}
    </aside>
  );
}
