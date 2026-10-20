import { useEffect, useRef, useState, type DragEvent } from "react";
import { useFetcher, useRevalidator } from "react-router";
import { FileText } from "lucide-react";
import { Modal, ModalFooter, ModalHeader } from "~/components/Modal";
import { modalCardClass, useOsChrome } from "~/components/os-chrome";
import { Button } from "~/components/ui/Button";
import { Checkbox } from "~/components/ui/Checkbox";
import { useToast } from "~/components/ui/toast";
import { cn } from "~/lib/cn";
import { formatMonth, type WorkExperienceItem } from "~/members/lib/work-experience";
import {
  NotPositionsFileError,
  isDuplicate,
  jobIssue,
  parseLinkedInPositionsCsv,
  toSavePayload,
  type ImportedJob,
} from "~/members/lib/work-history-import";
import { WorkExperienceFields, type WorkExperienceFieldValues } from "./WorkExperienceFields";

type ExtractError = "quota" | "rate" | "ai_unavailable" | "failed";

type UploadResponse = {
  resume?: { fileName: string; uploadedAt: string };
  jobs?: ImportedJob[];
  extractError?: ExtractError;
  error?: string;
};

type Row = { job: ImportedJob; checked: boolean; editing: boolean };

const EXTRACT_ERROR_COPY: Record<ExtractError, string> = {
  quota: "You've used today's AI limit. Your resume is saved; add jobs by hand or try again tomorrow.",
  rate: "Too many imports in a row. Your resume is saved; try again in a few minutes.",
  ai_unavailable: "Saved as your resume. We couldn't read the jobs from it.",
  failed: "Saved as your resume. We couldn't read the jobs from it.",
};

const plural = (n: number) => `${n} ${n === 1 ? "job" : "jobs"}`;

function dateLabel(month: string, year: number | null): string {
  return month ? formatMonth(month) : year ? String(year) : "unknown";
}

function rangeLabel(job: ImportedJob): string {
  const start = dateLabel(job.startMonth, job.startYear);
  const end = job.current ? "present" : job.endMonth || job.endYear ? dateLabel(job.endMonth, job.endYear) : "present";
  return `${start} to ${end}`;
}

function toFieldValues(job: ImportedJob): WorkExperienceFieldValues {
  return {
    company: job.company,
    position: job.position,
    description: job.description ?? "",
    location: job.location ?? "",
    workMode: job.workMode ?? "",
    startMonth: job.startMonth,
    endMonth: job.endMonth,
    current: job.current,
  };
}

function applyFieldValues(job: ImportedJob, patch: Partial<WorkExperienceFieldValues>): ImportedJob {
  const { description, location, workMode, ...direct } = patch;
  return {
    ...job,
    ...direct,
    ...(description !== undefined && { description: description || null }),
    ...(location !== undefined && { location: location || null }),
    ...(workMode !== undefined && { workMode: (workMode || null) as ImportedJob["workMode"] }),
  };
}

export function ImportWorkHistoryModal({
  memberId,
  existing,
  onClose,
}: {
  memberId: string;
  existing: WorkExperienceItem[];
  onClose: () => void;
}) {
  const { formClass } = useOsChrome();
  const toast = useToast();
  const revalidator = useRevalidator();
  const saveFetcher = useFetcher<{ imported?: number; error?: string } | null>();
  const inputRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<"choose" | "reading" | "review" | "notice">("choose");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [dragging, setDragging] = useState(false);

  const saving = saveFetcher.state !== "idle";
  const busy = phase === "reading" || saving;
  const submitted = useRef(false);

  useEffect(() => {
    if (saveFetcher.state !== "idle") {
      submitted.current = true;
    } else if (submitted.current) {
      submitted.current = false;
      const data = saveFetcher.data;
      if (data && "imported" in data && typeof data.imported === "number") {
        toast.success(`Added ${plural(data.imported)}.`);
        onClose();
      }
    }
  }, [saveFetcher.state, saveFetcher.data, onClose, toast]);

  function startReview(jobs: ImportedJob[]) {
    setRows(
      jobs.map((job) => ({
        job,
        checked: !isDuplicate(job, existing) && jobIssue(job) === null,
        editing: false,
      })),
    );
    setPhase("review");
  }

  async function readCsv(file: File) {
    try {
      const jobs = await parseLinkedInPositionsCsv(await file.text());
      if (jobs.length === 0) {
        setNotice("We couldn't find any jobs in this file.");
        setPhase("notice");
        return;
      }
      startReview(jobs);
    } catch (e) {
      setError(e instanceof NotPositionsFileError ? e.message : "We couldn't read that file.");
    }
  }

  async function readPdf(file: File) {
    setPhase("reading");
    const body = new FormData();
    body.set("file", file);
    body.set("extract", "1");
    let data: UploadResponse;
    try {
      const res = await fetch(`/api/members/${memberId}/resume`, { method: "POST", body });
      data = (await res.json()) as UploadResponse;
      if (!res.ok) {
        setError(data.error ?? "We couldn't upload that file.");
        setPhase("choose");
        return;
      }
    } catch {
      setError("We couldn't upload that file.");
      setPhase("choose");
      return;
    }
    void revalidator.revalidate();
    if (data.extractError) {
      setNotice(EXTRACT_ERROR_COPY[data.extractError]);
      setPhase("notice");
    } else if (!data.jobs || data.jobs.length === 0) {
      setNotice("We couldn't find any jobs in this file. Saved as your resume.");
      setPhase("notice");
    } else {
      startReview(data.jobs);
    }
  }

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    const name = file.name.toLowerCase();
    if (name.endsWith(".zip")) setError("Unzip it first and upload Positions.csv.");
    else if (name.endsWith(".csv")) await readCsv(file);
    else if (name.endsWith(".pdf")) await readPdf(file);
    else setError("Upload a PDF or Positions.csv.");
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragging(false);
    void handleFile(e.dataTransfer.files[0]);
  }

  function updateRow(key: string, patch: Partial<Row>) {
    setRows((rs) => rs.map((r) => (r.job.key === key ? { ...r, ...patch } : r)));
  }

  const selected = rows.filter((r) => r.checked && jobIssue(r.job) === null);

  function add() {
    saveFetcher.submit(
      { intent: "import-experiences", jobs: JSON.stringify(selected.map((r) => toSavePayload(r.job))) },
      { method: "post" },
    );
  }

  return (
    <Modal
      open
      onClose={onClose}
      labelledBy="import-work-history-title"
      disableEscape={busy}
      containerClassName={modalCardClass("max-w-xl")}
    >
      <ModalHeader
        titleId="import-work-history-title"
        title="Import work history"
        onClose={onClose}
        hideClose={busy}
      />

      {phase === "choose" && (
        <div className={cn("flex flex-col gap-4", formClass)}>
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            className={cn(
              "flex flex-col items-center gap-3 rounded-os-card border border-dashed px-5 py-8 text-center transition-colors",
              dragging ? "border-os-accent bg-os-container" : "border-os-container-hi",
            )}
          >
            <FileText className="h-6 w-6 text-os-grey" aria-hidden />
            <p className="text-sm text-foreground">
              Upload your resume or LinkedIn profile as a PDF. We&apos;ll save it as your resume. Only you and DALI
              admins can see it.
            </p>
            <Button variant="secondary" onClick={() => inputRef.current?.click()}>
              Choose a file
            </Button>
            <input
              ref={inputRef}
              type="file"
              accept=".pdf,.csv"
              aria-label="Resume or Positions.csv"
              className="sr-only"
              onChange={(e) => {
                void handleFile(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          </div>
          <p className="text-[13px] text-os-grey">
            Or, from LinkedIn: Settings, Data privacy, Get a copy of your data, Positions. Unzip the email attachment
            and upload Positions.csv.
          </p>
          {error && (
            <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}
          <ModalFooter onCancel={onClose}>{null}</ModalFooter>
        </div>
      )}

      {phase === "reading" && <p className="py-8 text-center text-sm text-os-grey">Reading your resume…</p>}

      {phase === "notice" && (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-foreground">{notice}</p>
          <ModalFooter onCancel={onClose} cancelLabel="Close">{null}</ModalFooter>
        </div>
      )}

      {phase === "review" && (
        <div className={cn("flex flex-col gap-3", formClass)}>
          {saveFetcher.data && "error" in saveFetcher.data && saveFetcher.data.error && (
            <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {saveFetcher.data.error}
            </p>
          )}
          <ul className="flex max-h-[60vh] flex-col overflow-y-auto">
            {rows.map(({ job, checked, editing }) => {
              const issue = jobIssue(job);
              const duplicate = isDuplicate(job, existing);
              return (
                <li key={job.key} className="flex flex-col gap-3 border-b border-os-container py-3 last:border-0">
                  <div className="flex items-start gap-3">
                    <Checkbox
                      tone="os"
                      aria-label={`${job.position} at ${job.company}`}
                      checked={checked && issue === null}
                      disabled={issue !== null}
                      onChange={(e) => updateRow(job.key, { checked: e.target.checked })}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-foreground">
                        {job.position}
                        <span className="font-normal text-os-grey"> at {job.company}</span>
                      </p>
                      <p className="mt-0.5 text-[13px] text-os-grey">{rangeLabel(job)}</p>
                      {issue && <p className="mt-0.5 text-[13px] text-destructive">{issue}</p>}
                      {duplicate && <p className="mt-0.5 text-[13px] text-os-muted">Already on your profile</p>}
                    </div>
                    <button
                      type="button"
                      onClick={() => updateRow(job.key, { editing: !editing })}
                      className="shrink-0 text-[12px] font-semibold text-os-grey hover:text-foreground"
                    >
                      {editing ? "Done" : "Edit"}
                    </button>
                  </div>
                  {editing && (
                    <div className="flex flex-col gap-4">
                      <WorkExperienceFields
                        value={toFieldValues(job)}
                        startYearHint={job.startYear}
                        endYearHint={job.endYear}
                        onChange={(patch) => updateRow(job.key, { job: applyFieldValues(job, patch) })}
                      />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          <ModalFooter onCancel={onClose} cancelDisabled={saving}>
            <Button onClick={add} disabled={selected.length === 0 || saving}>
              Add {plural(selected.length)}
            </Button>
          </ModalFooter>
        </div>
      )}
    </Modal>
  );
}
