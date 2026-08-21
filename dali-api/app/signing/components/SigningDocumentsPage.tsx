import { useState } from "react";
import { Link, Form, useLoaderData } from "react-router";
import { Plus, FileSignature, ChevronRight } from "lucide-react";
import type { loader } from "~/signing/routes/admin.agreements";
import { Select, type SelectOption } from "~/components/ui/floating";
import { useOsChrome } from "~/components/os-chrome";
import { cn } from "~/lib/cn";

const KIND_LABELS: Record<string, string> = {
  General: "General",
  MemberAgreement: "Membership",
  MentorshipAgreement: "Mentorship",
  Confidentiality: "Confidentiality",
};

const SCOPE_LABELS: Record<string, string> = {
  None: "Not enforced",
  App: "Blocks app until signed",
  HiringCycle: "Gates hiring data",
};

export function SigningDocumentsPage() {
  const data = useLoaderData<typeof loader>();
  const [creating, setCreating] = useState(false);
  const { os, pageTitle, card, formClass } = useOsChrome();
  // The route serves this legacy card grid only in "list" mode (the console
  // mode renders AgreementsConsole instead).
  if (data.mode !== "list") return null;
  const { documents } = data;

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between gap-4">
        <h1 className={pageTitle}>Agreements</h1>
        <button
          type="button"
          onClick={() => setCreating((c) => !c)}
          className={cn(
            "shrink-0",
            os
              ? "os-add-btn"
              : "inline-flex items-center px-4 py-2 text-sm font-medium rounded-lg text-white bg-accent-coral hover:bg-accent-coral/90 shadow-sm",
          )}
        >
          <Plus className={os ? "h-[17px] w-[17px]" : "w-4 h-4 mr-2"} strokeWidth={os ? 3 : undefined} />
          New Agreement
        </button>
      </div>

      {creating && (
        <Form
          method="post"
          className={cn(
            "p-5 grid gap-3 sm:grid-cols-2",
            formClass,
            os ? "rounded-os-card bg-os-card" : "bg-card rounded-xl border border-border shadow-sm",
          )}
          onSubmit={() => setCreating(false)}
        >
          <input type="hidden" name="intent" value="create" />
          <label className="flex flex-col gap-1 text-sm sm:col-span-2">
            <span className="font-medium text-foreground/80">Name</span>
            <input
              type="text"
              name="name"
              required
              placeholder="DALI Term Agreement"
              className="px-3 py-2 border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-accent-coral/30"
              autoFocus
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-foreground/80">Kind</span>
            <Select
              name="kind"
              defaultValue="MemberAgreement"
              options={[
                { value: "General", label: "General" },
                { value: "MemberAgreement", label: "Membership" },
                { value: "MentorshipAgreement", label: "Mentorship" },
                { value: "Confidentiality", label: "Confidentiality" },
              ]}
              buttonClassName="px-3 py-2 border border-border rounded-md inline-flex items-center justify-between gap-1 transition-colors hover:bg-muted/40"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-foreground/80">Enforcement</span>
            <Select
              name="gateScope"
              defaultValue="App"
              options={[
                { value: "None", label: "Not enforced (surface only)" },
                { value: "App", label: "Hard-gate the app until signed" },
                { value: "HiringCycle", label: "Gate hiring data (confidentiality)" },
              ]}
              buttonClassName="px-3 py-2 border border-border rounded-md inline-flex items-center justify-between gap-1 transition-colors hover:bg-muted/40"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-foreground/80">Audience</span>
            <Select
              name="audience"
              defaultValue="Members"
              options={[
                { value: "Manual", label: "Manual" },
                { value: "NewMembers", label: "New members" },
                { value: "Members", label: "Members (returning)" },
                { value: "Mentors", label: "Mentors" },
                { value: "HiringParticipants", label: "Hiring participants" },
              ]}
              buttonClassName="px-3 py-2 border border-border rounded-md inline-flex items-center justify-between gap-1 transition-colors hover:bg-muted/40"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-foreground/80">Cadence</span>
            <Select
              name="cadence"
              defaultValue="Once"
              options={[
                { value: "Once", label: "One-time (sign once)" },
                { value: "PerTerm", label: "Per term (re-sign each term)" },
                { value: "PerCycle", label: "Per hiring cycle" },
              ]}
              buttonClassName="px-3 py-2 border border-border rounded-md inline-flex items-center justify-between gap-1 transition-colors hover:bg-muted/40"
            />
          </label>
          <div className="sm:col-span-2 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setCreating(false)}
              className={
                os
                  ? "os-btn-ghost"
                  : "px-3 py-2 text-sm font-medium text-foreground/80 bg-card border border-border rounded-md hover:bg-muted/50"
              }
            >
              Cancel
            </button>
            <button
              type="submit"
              className={cn(
                os
                  ? "os-btn-primary"
                  : "px-3 py-2 text-sm font-medium text-white bg-accent-coral rounded-md hover:bg-accent-coral/90",
              )}
            >
              Create
            </button>
          </div>
        </Form>
      )}

      {documents.length === 0 ? (
        <p className="text-muted-foreground italic">No agreements yet.</p>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-6">
          {documents.map((doc) => {
            const published = doc.versions.filter((v) => v.publishedAt).length;
            return (
              <Link
                key={doc.id}
                to={`/admin/agreements/${doc.id}`}
                className={cn(
                  "group block p-6",
                  os
                    ? "rounded-os-card bg-os-card transition-colors hover:bg-os-card-hover"
                    : "bg-card rounded-xl border border-border shadow-sm hover:shadow-md transition-shadow",
                )}
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="p-2 bg-accent-coral/10 text-accent-coral rounded-lg shrink-0">
                      <FileSignature className="w-6 h-6" />
                    </div>
                    <div className="min-w-0">
                      <h3 className="font-bold text-foreground group-hover:text-accent-coral transition-colors truncate">
                        {doc.name}
                      </h3>
                      <p className="text-xs text-muted-foreground mt-1">
                        {KIND_LABELS[doc.kind] ?? doc.kind} · {doc.versions.length} version
                        {doc.versions.length !== 1 ? "s" : ""}
                        {published > 0 ? ` · ${published} published` : ""}
                      </p>
                    </div>
                  </div>
                  <ChevronRight className="w-5 h-5 text-muted-foreground/40 group-hover:text-accent-coral transition-colors shrink-0" />
                </div>
                <p className="text-xs text-muted-foreground mt-3">
                  {SCOPE_LABELS[doc.gateScope] ?? doc.gateScope}
                  {doc.bindings.length > 0 ? ` · ${doc.bindings.length} in force` : ""}
                </p>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
