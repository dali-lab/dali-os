import { useEffect, useState } from "react";
import { useRevalidator } from "react-router";
import { Modal, ModalHeader } from "~/components/Modal";
import { modalCardClass } from "~/components/os-chrome";
import { Button } from "~/components/ui/Button";
import { PersonPicker } from "~/components/ui/PersonPicker";
import { MemberFormFillView, type MemberFormData } from "~/forms/components/MemberFormFillView";
import type { Slot } from "~/projects/lib/form-slots";

type Person = { userId: string; name: string; email: string | null };

const ENDPOINT = "/api/staffing/responses";

function usePeopleSearch(cycleId: string, slot: Slot, q: string) {
  const [results, setResults] = useState<Person[]>([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (q.trim().length < 2) {
      setResults([]);
      return;
    }
    setLoading(true);
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch(
          `${ENDPOINT}?cycleId=${encodeURIComponent(cycleId)}&slot=${slot}&q=${encodeURIComponent(q.trim())}`,
          { credentials: "include", signal: ctrl.signal },
        );
        const json = (await res.json().catch(() => ({}))) as { results?: Person[] };
        setResults(json.results ?? []);
      } catch (e) {
        if ((e as Error).name !== "AbortError") setResults([]);
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [cycleId, slot, q]);
  return { results, loading };
}

// A staffing manager fills the board's form for a member who didn't, e.g.
// someone who told you in person they want to work. Saved like their own
// response, with the manager recorded as who added it.
export function AddResponseDialog({
  cycleId,
  slot,
  slotLabel,
  onClose,
}: {
  cycleId: string;
  slot: Slot;
  slotLabel: string;
  onClose: () => void;
}) {
  const revalidator = useRevalidator();
  const [q, setQ] = useState("");
  const [person, setPerson] = useState<Person | null>(null);
  const [form, setForm] = useState<MemberFormData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { results, loading } = usePeopleSearch(cycleId, slot, q);

  async function pick(p: Person) {
    setPerson(p);
    setError(null);
    const res = await fetch(`${ENDPOINT}?cycleId=${encodeURIComponent(cycleId)}&slot=${slot}&userId=${p.userId}`, {
      credentials: "include",
    });
    const json = (await res.json().catch(() => ({}))) as { form?: MemberFormData; error?: string };
    if (!res.ok || !json.form) {
      setError(json.error ?? "Couldn't load the form.");
      setPerson(null);
      return;
    }
    setForm(json.form);
  }

  function close() {
    revalidator.revalidate();
    onClose();
  }

  return (
    <Modal open onClose={close} labelledBy="add-response-title" containerClassName={modalCardClass("max-w-2xl")}>
      <ModalHeader
        titleId="add-response-title"
        title={person ? `Add a response for ${person.name}` : `Add a ${slotLabel} response`}
        subtitle="Fill the form for someone who didn't. It's saved as their response, with you as who added it."
        onClose={close}
      />
      {!person || !form ? (
        <div className="flex flex-col gap-2">
          <PersonPicker
            people={results.map((p) => ({ id: p.userId, name: p.name, secondary: p.email }))}
            value={null}
            onChange={(id) => {
              const p = results.find((r) => r.userId === id);
              if (p) void pick(p);
            }}
            onQueryChange={setQ}
            filterLocally={false}
            autoFocus
            ariaLabel="Search members"
            placeholder="Search members by name or email"
            noMatchesLabel={
              q.trim().length < 2 ? "Type two letters to search." : loading ? "Searching…" : "No members without a response match."
            }
          />
          {person && !form && !error && <p className="text-xs text-muted-foreground">Loading the form…</p>}
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
      ) : (
        <div className="max-h-[70vh] overflow-y-auto">
          <MemberFormFillView
            data={form}
            submitUrl={ENDPOINT}
            extraBody={{ cycleId, slot, userId: person.userId }}
            doneContent={
              <div className="flex flex-col items-center gap-3">
                <p className="text-sm text-muted-foreground">Saved as {person.name}'s response.</p>
                <Button variant="primary" size="sm" onClick={close}>
                  Done
                </Button>
              </div>
            }
          />
        </div>
      )}
    </Modal>
  );
}
