import { useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";
import { pendingForm, useFetcherErrorToast } from "~/calendar/lib/fetcher-pending";
import { X, Pencil, Trash2, RefreshCw, BookOpen, Plus, Check } from "lucide-react";
import { TimeField as TimeComboField } from "~/components/ui/TimeField";
import { Select, Tooltip } from "~/components/ui/floating";
import { useDialog } from "~/components/ui/dialog";
import { SearchInput } from "~/components/ui/SearchInput";
import { Checkbox } from "~/components/ui/Checkbox";
import { cn } from "~/lib/cn";
import { DARTMOUTH_PERIODS, getPeriod, periodSummary, periodMeetings } from "~/calendar/lib/dartmouth-periods";
import {
  destinationValue,
  classScheduleSummary,
  formatCourseTitle,
  formatCourseLocation,
} from "~/calendar/lib/class-format";
import type { LoaderData, MemberClassDTO, CourseHitDTO } from "~/calendar/lib/types";

// ── Helpers ───────────────────────────────────────────────────────────────
import { minToHHMM, CUSTOM_WEEKDAYS, currentDestinationValue } from "~/calendar/lib/composer-fields";

export function ManagedClassRow({
  c,
  onEdit,
  onRemoved,
}: {
  c: MemberClassDTO;
  onEdit: () => void;
  onRemoved: () => void;
}) {
  const refreshFetcher = useFetcher();
  const removeFetcher = useFetcher<{ error?: string } | null>();
  useFetcherErrorToast(removeFetcher);
  const dialog = useDialog();
  if (pendingForm(removeFetcher)) return null;
  return (
    <li
      className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2"
    >
      <span className="h-3 w-3 shrink-0 rounded-[3px]" style={{ backgroundColor: "#1E5779" }} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-foreground">
          {c.title}
          {c.periodCode && <span className="ml-1.5 text-xs text-muted-foreground">{c.periodCode}</span>}
        </div>
        <div className="truncate text-xs text-muted-foreground">
          {classScheduleSummary(c.meetings)} · {c.destinationLabel}
        </div>
      </div>
      {c.offeringCrn && (
        <button
          type="button"
          onClick={() =>
            refreshFetcher.submit(
              { intent: "class-refresh", classId: c.id },
              { method: "post" },
            )
          }
          disabled={refreshFetcher.state !== "idle"}
          className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
          aria-label={`Update ${c.title} from the timetable`}
          title="Update time & location from the timetable"
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
      )}
      <button
        type="button"
        onClick={onEdit}
        className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
        aria-label={`Edit ${c.title}`}
      >
        <Pencil className="h-3.5 w-3.5" />
      </button>
      <Tooltip content={`Remove ${c.title}`}>
        <button
          type="button"
          aria-label={`Remove ${c.title}`}
          className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-destructive"
          onClick={async () => {
            const ok = await dialog.confirm({
              title: `Remove "${c.title}"?`,
              description: c.destinationLabel?.startsWith("Google")
                ? "Removes this class from DALI and deletes the recurring event from your Google calendar."
                : "Removes this class from your DALI calendar.",
              tone: "destructive",
              confirmLabel: "Remove class",
            });
            if (ok) {
              onRemoved();
              removeFetcher.submit(
                { intent: "class-remove", classId: c.id },
                { method: "post" },
              );
            }
          }}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </Tooltip>
    </li>
  );
}

export function QuickAddButton({
  added,
  disabled,
  fields,
}: {
  added: boolean;
  disabled: boolean;
  fields: Record<string, string>;
}) {
  const fetcher = useFetcher<{ error?: string } | null>();
  useFetcherErrorToast(fetcher);
  if (added || pendingForm(fetcher)) {
    return (
      <span className="flex shrink-0 items-center gap-1 px-2.5 text-xs text-muted-foreground">
        <Check className="h-3.5 w-3.5" /> Added
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={() => fetcher.submit(fields, { method: "post" })}
      disabled={disabled}
      className="flex shrink-0 items-center gap-1 px-2.5 text-xs font-medium text-os-accent hover:bg-muted disabled:opacity-50"
      title="Add this class now"
    >
      <Plus className="h-3.5 w-3.5" /> Add
    </button>
  );
}

// The classes editor itself. Rendered inline by the Availability tab, and
// wrapped by ClassesManagerModal for the places that still open it as a dialog.
export function ClassesManagerBody({ data }: { data: LoaderData }) {
  const fetcher = useFetcher<{ error?: string } | null>();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [mode, setMode] = useState(""); // "" | period code | "custom"
  const [includeXHour, setIncludeXHour] = useState(false);
  const [customDays, setCustomDays] = useState<number[]>([]);
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [location, setLocation] = useState("");
  const [destination, setDestination] = useState(() => {
    const first = data.classDestinations[0];
    return first ? destinationValue(first) : "";
  });
  const [selectedTermId, setSelectedTermId] = useState(data.classTerm?.id ?? "");

  // Course autofill (Dartmouth timetable). The typeahead writes into the fields
  // below; picked* is the section provenance persisted with the class.
  const courseFetcher = useFetcher<{ courses: CourseHitDTO[] }>();
  const [courseQuery, setCourseQuery] = useState("");
  const [showCourseResults, setShowCourseResults] = useState(false);
  const [picked, setPicked] = useState<{
    crn: string;
    subject: string;
    number: string;
    section: string;
  } | null>(null);
  const [unknownPeriodHint, setUnknownPeriodHint] = useState("");

  function resetForm() {
    setEditingId(null);
    setTitle("");
    setMode("");
    setIncludeXHour(false);
    setCustomDays([]);
    setCustomStart("");
    setCustomEnd("");
    setLocation("");
    setCourseQuery("");
    setShowCourseResults(false);
    setPicked(null);
    setUnknownPeriodHint("");
  }

  // Clear the form after a successful add/edit (settled, no error).
  const prevState = useRef(fetcher.state);
  useEffect(() => {
    if (prevState.current !== "idle" && fetcher.state === "idle" && !fetcher.data?.error) resetForm();
    prevState.current = fetcher.state;
  }, [fetcher.state, fetcher.data]);

  function startEdit(c: MemberClassDTO) {
    setEditingId(c.id);
    setTitle(c.title);
    setLocation(c.location ?? "");
    setDestination(currentDestinationValue(c));
    setCourseQuery("");
    setShowCourseResults(false);
    setUnknownPeriodHint("");
    setPicked(
      c.offeringCrn
        ? {
            crn: c.offeringCrn,
            subject: c.subject ?? "",
            number: c.courseNumber ?? "",
            section: c.section ?? "",
          }
        : null,
    );
    if (c.periodCode) {
      setMode(c.periodCode);
      setIncludeXHour(c.meetings.some((m) => m.kind === "xhour"));
    } else {
      setMode("custom");
      const main = c.meetings.find((m) => m.kind === "main");
      setCustomDays(main?.days ?? []);
      setCustomStart(main ? minToHHMM(main.startMin) : "");
      setCustomEnd(main ? minToHHMM(main.endMin) : "");
    }
  }

  // Debounced typeahead against the pre-synced timetable, scoped to the chosen term.
  const trimmedCourseQuery = courseQuery.trim();
  useEffect(() => {
    if (!selectedTermId || trimmedCourseQuery.length < 2) return;
    const t = setTimeout(() => {
      const params = new URLSearchParams({ termId: selectedTermId, q: trimmedCourseQuery });
      courseFetcher.load(`/api/timetable/courses?${params.toString()}`);
    }, 220);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trimmedCourseQuery, selectedTermId]);

  const courseHits = courseFetcher.data?.courses ?? [];
  const courseSearching = courseFetcher.state !== "idle";
  const refreshSearchFetcher = useFetcher<{ refreshed: number }>();
  const refreshingSearch = refreshSearchFetcher.state !== "idle";
  // CRNs already added this term, so results can show "Added" and skip re-adding.
  const addedCrns = new Set(
    data.memberClasses
      .filter((c) => c.termId === selectedTermId && c.offeringCrn)
      .map((c) => c.offeringCrn),
  );

  // Live-refresh the subjects currently in view (fresh seats/period from Dartmouth),
  // then re-run the search so the dropdown shows the updated cache.
  const lastRefresh = useRef(refreshSearchFetcher.data);
  useEffect(() => {
    if (refreshSearchFetcher.data && refreshSearchFetcher.data !== lastRefresh.current) {
      lastRefresh.current = refreshSearchFetcher.data;
      if (selectedTermId && trimmedCourseQuery.length >= 2) {
        courseFetcher.load(
          `/api/timetable/courses?${new URLSearchParams({ termId: selectedTermId, q: trimmedCourseQuery })}`,
        );
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshSearchFetcher.data]);

  function refreshSearchResults() {
    const subjects = [...new Set(courseHits.map((h) => h.subject))].join(",");
    if (!subjects || !selectedTermId) return;
    refreshSearchFetcher.submit(
      { termId: selectedTermId, subjects },
      { method: "post", action: "/api/timetable/courses" },
    );
  }

  // Selecting a section fills the (still-editable) title / period / location and
  // records the section it came from. A known period code preselects the "When"
  // dropdown; an unknown one (ARR, labs) leaves it manual with a hint.
  function pickCourse(c: CourseHitDTO) {
    setTitle(formatCourseTitle({ subject: c.subject, number: c.number, title: c.title }));
    setLocation(formatCourseLocation({ building: c.building, room: c.room }));
    setPicked({ crn: c.crn, subject: c.subject, number: c.number, section: c.section });
    if (c.periodCode && getPeriod(c.periodCode)) {
      setMode(c.periodCode);
      setIncludeXHour(false);
      setUnknownPeriodHint("");
    } else {
      setMode("");
      setUnknownPeriodHint(c.periodText || c.periodCode || "");
    }
    setCourseQuery("");
    setShowCourseResults(false);
  }

  // Add a section straight from the results with the current destination — no
  // review step — for quickly stacking a term's classes. Known-period sections
  // only; ARR/labs need manual handling, so those fall back to row-click autofill.
  const quickAddFields = (c: CourseHitDTO) => ({
    intent: "class-add",
    title: formatCourseTitle({ subject: c.subject, number: c.number, title: c.title }),
    periodCode: c.periodCode ?? "",
    includeXHour: "",
    destination,
    termId: selectedTermId,
    location: formatCourseLocation({ building: c.building, room: c.room }),
    offeringCrn: c.crn,
    courseSubject: c.subject,
    courseNumber: c.number,
    courseSection: c.section,
  });

  const isPeriod = mode !== "" && mode !== "custom";
  const period = isPeriod ? getPeriod(mode) : undefined;
  const submitting = fetcher.state !== "idle";
  const canSubmit =
    title.trim() !== "" &&
    destination !== "" &&
    (isPeriod || (mode === "custom" && customDays.length > 0 && customStart !== "" && customEnd !== ""));

  const periodOptions = [
    { value: "", label: "Choose a class period…" },
    ...DARTMOUTH_PERIODS.map((p) => ({ value: p.code, label: periodSummary(p) })),
    { value: "custom", label: "Custom day & time…" },
  ];

  // Client-side overlap warning: does the class being composed clash with another
  // class already added this term? (Shares a weekday and an intersecting time.)
  const hhmm = (s: string) => {
    const [h, m] = s.split(":").map(Number);
    return h * 60 + m;
  };
  const prospectiveMeetings: { days: number[]; startMin: number; endMin: number }[] = isPeriod
    ? periodMeetings(mode, includeXHour)
    : mode === "custom" && customDays.length > 0 && customStart !== "" && customEnd !== ""
      ? [{ days: customDays, startMin: hhmm(customStart), endMin: hhmm(customEnd) }]
      : [];
  const overlapClass = data.memberClasses.find(
    (c) =>
      c.termId === selectedTermId &&
      c.id !== editingId &&
      c.meetings.some((m) =>
        prospectiveMeetings.some(
          (p) =>
            p.days.some((d) => m.days.includes(d)) && p.startMin < m.endMin && m.startMin < p.endMin,
        ),
      ),
  );

  return (
    <>
        {!data.classTerm ? (
          <p className="text-sm text-muted-foreground">There's no active term to add classes to yet.</p>
        ) : (
          <div className="flex flex-col gap-4">
            {/* Existing classes — filtered to the selected term */}
            {data.memberClasses.filter((c) => c.termId === selectedTermId).length > 0 && (
              <ul className="flex flex-col gap-1.5">
                {data.memberClasses.filter((c) => c.termId === selectedTermId).map((c) => (
                  <ManagedClassRow
                    key={c.id}
                    c={c}
                    onEdit={() => startEdit(c)}
                    onRemoved={() => {
                      if (editingId === c.id) resetForm();
                    }}
                  />
                ))}
              </ul>
            )}

            {/* Add / edit form */}
            <fetcher.Form method="post" className="flex flex-col gap-3 rounded-lg p-3">
              <input type="hidden" name="intent" value={editingId ? "class-update" : "class-add"} />
              {editingId && <input type="hidden" name="classId" value={editingId} />}
              <input type="hidden" name="periodCode" value={isPeriod ? mode : ""} />
              <input type="hidden" name="includeXHour" value={isPeriod && includeXHour && period?.xhour ? "1" : ""} />
              <input type="hidden" name="customDays" value={mode === "custom" ? customDays.join(",") : ""} />
              <input type="hidden" name="customStart" value={customStart} />
              <input type="hidden" name="customEnd" value={customEnd} />
              <input type="hidden" name="destination" value={destination} />
              <input type="hidden" name="termId" value={selectedTermId} />
              <input type="hidden" name="offeringCrn" value={picked?.crn ?? ""} />
              <input type="hidden" name="courseSubject" value={picked?.subject ?? ""} />
              <input type="hidden" name="courseNumber" value={picked?.number ?? ""} />
              <input type="hidden" name="courseSection" value={picked?.section ?? ""} />

              {data.classTerms.length > 1 && (
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-muted-foreground">Term</span>
                  <Select
                    value={selectedTermId}
                    onChange={setSelectedTermId}
                    options={data.classTerms.map((t) => ({ value: t.id, label: t.code }))}
                    placeholder="Choose a term…"
                    buttonClassName="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-left inline-flex items-center justify-between gap-1 hover:bg-muted/40"
                  />
                </label>
              )}

              {/* Course autofill — search the synced Dartmouth timetable. Selecting a
                  section fills the fields below; manual entry stays fully available. */}
              <div className="relative flex flex-col gap-1 text-sm">
                <span className="text-muted-foreground">Find your course (optional)</span>
                <SearchInput
                  size="sm"
                  value={courseQuery}
                  onChange={(e) => {
                    setCourseQuery(e.target.value);
                    setShowCourseResults(true);
                  }}
                  onFocus={() => setShowCourseResults(true)}
                  placeholder="Search the timetable, e.g. COSC 52"
                  containerClassName="w-full"
                />
                {showCourseResults && trimmedCourseQuery.length >= 2 && (
                  <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-60 overflow-y-auto rounded-md border border-border bg-background shadow-lg">
                    {courseHits.length > 0 && (
                      <div className="sticky top-0 flex items-center justify-between border-b border-border bg-background px-2.5 py-1 text-xs text-muted-foreground">
                        <span>Seats from last sync</span>
                        <button
                          type="button"
                          onClick={refreshSearchResults}
                          disabled={refreshingSearch}
                          className="inline-flex items-center gap-1 rounded hover:text-foreground disabled:opacity-50"
                          title="Fetch current seats & times from Dartmouth"
                        >
                          <RefreshCw className={cn("h-3 w-3", refreshingSearch && "animate-spin")} />
                          {refreshingSearch ? "Refreshing…" : "Refresh"}
                        </button>
                      </div>
                    )}
                    {courseHits.length > 0 ? (
                      courseHits.map((c) => {
                        const known = Boolean(c.periodCode && getPeriod(c.periodCode));
                        const added = addedCrns.has(c.crn);
                        const seats =
                          c.enrollLimit != null && c.enrollCurrent != null
                            ? { open: c.enrollCurrent < c.enrollLimit, label: `${c.enrollCurrent}/${c.enrollLimit}` }
                            : null;
                        return (
                          <div key={c.crn} className="flex items-stretch hover:bg-muted">
                            <button
                              type="button"
                              onClick={() => pickCourse(c)}
                              className="flex min-w-0 flex-1 items-start gap-2.5 px-2.5 py-1.5 text-left"
                            >
                              <BookOpen className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-sm font-medium text-foreground">
                                  {c.subject} {c.number} — {c.title}
                                </span>
                                <span className="block truncate text-xs text-muted-foreground">
                                  Section {c.section} · {c.periodCode || c.periodText || "no set time"}
                                  {c.distributive ? ` · ${c.distributive}` : ""}
                                  {c.instructor ? ` · ${c.instructor}` : ""}
                                  {c.crosslist ? ` · also ${c.crosslist}` : ""}
                                  {seats && (
                                    <>
                                      {" · "}
                                      <span className={seats.open ? "text-os-green" : "text-destructive"}>
                                        {seats.open ? `${seats.label} seats` : "full"}
                                      </span>
                                    </>
                                  )}
                                </span>
                              </span>
                            </button>
                            {(added || known) && (
                              <QuickAddButton
                                added={added}
                                disabled={!destination}
                                fields={quickAddFields(c)}
                              />
                            )}
                          </div>
                        );
                      })
                    ) : (
                      <p className="px-2.5 py-2 text-xs text-muted-foreground">
                        {courseSearching
                          ? "Searching…"
                          : "No matches — type the class in manually below."}
                      </p>
                    )}
                  </div>
                )}
              </div>

              <label className="flex flex-col gap-1 text-sm">
                <span className="text-muted-foreground">Class</span>
                <input
                  name="title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. CS 52 — Full-Stack Web Dev"
                  className="rounded-md border border-border bg-background px-2.5 py-1.5 text-foreground"
                />
              </label>

              <label className="flex flex-col gap-1 text-sm">
                <span className="text-muted-foreground">When</span>
                <Select
                  value={mode}
                  onChange={setMode}
                  options={periodOptions}
                  placeholder="Choose a class period…"
                  buttonClassName="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-left inline-flex items-center justify-between gap-1 hover:bg-muted/40"
                />
              </label>

              {unknownPeriodHint && mode === "" && (
                <p className="text-xs text-os-amber">
                  Dartmouth lists this as “{unknownPeriodHint}” — pick a matching period above, or
                  choose a custom day &amp; time.
                </p>
              )}

              {isPeriod && period && (
                <>
                  <p className="text-xs text-muted-foreground">{periodSummary(period)}</p>
                  {period.xhour && (
                    <label className="flex items-center gap-2 text-sm text-foreground">
                      <Checkbox checked={includeXHour} onChange={() => setIncludeXHour((v) => !v)} />
                      Include the x-hour
                    </label>
                  )}
                </>
              )}

              {mode === "custom" && (
                <div className="flex flex-col gap-2">
                  <div className="flex flex-wrap gap-1">
                    {CUSTOM_WEEKDAYS.map((d) => {
                      const on = customDays.includes(d.n);
                      return (
                        <button
                          key={d.n}
                          type="button"
                          onClick={() =>
                            setCustomDays((prev) => (on ? prev.filter((x) => x !== d.n) : [...prev, d.n]))
                          }
                          className={cn(
                            "rounded-full border px-2.5 py-1 text-xs",
                            on ? "border-transparent bg-os-accent text-os-bg" : "border-border text-muted-foreground",
                          )}
                        >
                          {d.label}
                        </button>
                      );
                    })}
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <TimeComboField value={customStart} onChange={setCustomStart} ariaLabel="Class start time" className="min-w-0 flex-1" />
                    <span className="text-muted-foreground">to</span>
                    <TimeComboField value={customEnd} onChange={setCustomEnd} ariaLabel="Class end time" className="min-w-0 flex-1" />
                  </div>
                </div>
              )}

              <label className="flex flex-col gap-1 text-sm">
                <span className="text-muted-foreground">Location (optional)</span>
                <input
                  name="location"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  placeholder="e.g. ECSC 008"
                  className="rounded-md border border-border bg-background px-2.5 py-1.5 text-foreground"
                />
              </label>

              {data.classDestinations.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  Connect a Google calendar you can write to to add classes.
                </p>
              ) : (
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-muted-foreground">Add to</span>
                  <Select
                    value={destination}
                    onChange={setDestination}
                    options={data.classDestinations.map((d) => ({ value: destinationValue(d), label: d.label }))}
                    placeholder="Where should classes go?"
                    buttonClassName="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-left inline-flex items-center justify-between gap-1 hover:bg-muted/40"
                  />
                </label>
              )}

              {overlapClass && (
                <p className="text-xs text-os-amber">
                  Heads up — this overlaps {overlapClass.title} ({classScheduleSummary(overlapClass.meetings)}).
                </p>
              )}

              {fetcher.data?.error && <p className="text-xs text-destructive">{fetcher.data.error}</p>}

              <div className="flex items-center gap-2">
                <button
                  type="submit"
                  disabled={!canSubmit || submitting}
                  className="os-btn-primary disabled:opacity-50"
                >
                  {editingId ? "Save class" : "Add class"}
                </button>
                {editingId && (
                  <button type="button" onClick={resetForm} className="os-btn-ghost">
                    Cancel
                  </button>
                )}
              </div>
            </fetcher.Form>
          </div>
        )}
    </>
  );
}

export function ClassesManagerModal({ data, onClose }: { data: LoaderData; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/55 backdrop-blur-sm p-4 py-10">
      <button type="button" className="fixed inset-0 cursor-default" aria-label="Close classes" onClick={onClose} tabIndex={-1} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Classes this term"
        className="relative z-10 w-full max-w-lg rounded-xl cal-surface p-5"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-heading text-lg font-semibold text-foreground">
            Classes{data.classTerm ? ` · ${data.classTerm.code}` : ""}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <ClassesManagerBody data={data} />
      </div>
    </div>
  );
}
