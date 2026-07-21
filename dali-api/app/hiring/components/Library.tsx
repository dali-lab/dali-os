import React, { useState } from "react";
import { Link, Form, useLoaderData, useSearchParams } from "react-router";
import {
  Plus,
  FileText,
  ListOrdered,
  ShieldCheck,
  ChevronRight,
  Trash2,
} from "lucide-react";
import { Button } from "~/components/ui/Button";
import { Modal, ModalHeader } from "~/components/Modal";
import { hiringPills } from "~/hiring/components/hiringPills";
import { AreaPillNav } from "~/components/AreaPillNav";
import { PageHeader } from "~/hiring/components/PageHeader";
import { EmptyState } from "~/hiring/components/EmptyState";
import type { loader } from "~/hiring/routes/library";

type Tab = "challenges" | "rubrics" | "agreements";

const TABS: { id: Tab; label: string }[] = [
  { id: "challenges", label: "Challenges" },
  { id: "rubrics", label: "Rubrics" },
  { id: "agreements", label: "Agreements" },
];

function parseTab(value: string | null): Tab {
  return value === "rubrics" || value === "agreements" ? value : "challenges";
}

export default function Library() {
  const data = useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = parseTab(searchParams.get("tab"));

  const selectTab = (next: Tab) => {
    const params = new URLSearchParams(searchParams);
    params.set("tab", next);
    setSearchParams(params);
  };

  return (
    <div className="flex flex-col gap-6">
      <AreaPillNav items={hiringPills({ ...data.pillRoles, active: "library" })} />
      <PageHeader
        title="Library"
        subtitle="Reusable challenges, rubrics, and confidentiality agreements — versioned independently of any hiring cycle, then bound to cycles as needed."
      />
      <div
        className="inline-flex self-start rounded-lg border border-border bg-muted/40 p-0.5"
        role="tablist"
        aria-label="Library section"
      >
        {TABS.map((t) => {
          const active = t.id === tab;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => selectTab(t.id)}
              className={`px-4 py-1.5 text-sm font-semibold rounded-md transition-colors ${
                active
                  ? "bg-accent-coral text-white shadow-sm"
                  : "text-muted-foreground hover:text-foreground hover:bg-background/60"
              }`}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {tab === "challenges" && (
        <ChallengesPanel domains={data.domains} challenges={data.challenges} />
      )}
      {tab === "rubrics" && <RubricsPanel rubrics={data.rubrics} />}
      {tab === "agreements" && (
        <AgreementsPanel agreements={data.agreements} canEdit={data.canEdit} />
      )}
    </div>
  );
}

function ChallengesPanel({
  domains,
  challenges,
}: {
  domains: any[];
  challenges: any[];
}) {
  // "General" is a synthetic tab for domainId: null, listed first.
  const GENERAL_TAB_ID = "__general__";
  const [activeDomain, setActiveDomain] = useState<string>(GENERAL_TAB_ID);
  const [showModal, setShowModal] = useState(false);
  const [newChallengeName, setNewChallengeName] = useState("");

  const isGeneral = activeDomain === GENERAL_TAB_ID;
  const filtered = challenges.filter((c: any) =>
    c.versions.some((v: any) =>
      isGeneral ? v.domainId === null : v.domainId === activeDomain,
    ),
  );

  const activeDomainName = isGeneral
    ? "General"
    : (domains.find((d: any) => d.id === activeDomain)?.name ?? "");

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-start gap-4 flex-wrap">
        <div className="min-w-0">
          <h2 className="font-heading text-lg font-bold text-foreground">
            {activeDomainName} challenges
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {isGeneral
              ? "The general application form and its versions."
              : "Domain challenges and their versions, kept separately from any cycle."}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <select
            value={activeDomain}
            onChange={(e) => setActiveDomain(e.target.value)}
            aria-label="Domain"
            className="px-3 py-2 rounded-lg border border-border bg-card text-sm font-medium text-foreground hover:bg-muted/50 focus:outline-none focus:ring-2 focus:ring-accent-coral/30"
          >
            <option value={GENERAL_TAB_ID}>General</option>
            {domains.map((domain: any) => (
              <option key={domain.id} value={domain.id}>
                {domain.name}
              </option>
            ))}
          </select>
          <Button variant="primary" size="sm" onClick={() => setShowModal(true)}>
            <Plus className="w-4 h-4" />
            New challenge
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-6">
        {filtered.map((challenge: any) => {
          const domainVersionCount = challenge.versions.filter((v: any) =>
            isGeneral ? v.domainId === null : v.domainId === activeDomain,
          ).length;
          return (
            <Link
              key={challenge.id}
              to={`/hiring/challenges/${challenge.id}`}
              className="bg-card rounded-xl border border-border p-6 shadow-sm hover:shadow-md transition-shadow group block"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <div className="p-2 bg-blue-50 rounded-lg text-blue-600 flex-shrink-0">
                    <FileText className="w-6 h-6" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="font-heading text-lg font-bold text-foreground group-hover:text-accent-coral transition-colors break-words">
                      {challenge.name}
                    </h3>
                    <p className="text-sm text-muted-foreground mt-1">
                      {domainVersionCount} version
                      {domainVersionCount !== 1 ? "s" : ""}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <Form method="post" onClick={(e) => e.stopPropagation()}>
                    <input type="hidden" name="entity" value="challenge" />
                    <input type="hidden" name="intent" value="delete" />
                    <input type="hidden" name="id" value={challenge.id} />
                    <button
                      type="submit"
                      aria-label="Delete challenge"
                      className="p-1.5 text-muted-foreground hover:text-destructive rounded-md opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </Form>
                  <ChevronRight className="w-5 h-5 text-muted-foreground group-hover:text-accent-coral transition-colors" />
                </div>
              </div>
              <div className="mt-6 pt-4 border-t border-border text-sm text-muted-foreground">
                Created {new Date(challenge.createdAt).toLocaleDateString()}
              </div>
            </Link>
          );
        })}
        {filtered.length === 0 && (
          <div className="col-span-full">
            <EmptyState
              icon={FileText}
              title={`No ${activeDomainName.toLowerCase()} challenges yet`}
              description="Create a challenge, then add versions to it as the prompt evolves across cycles."
            />
          </div>
        )}
      </div>

      <Modal
        open={showModal}
        onClose={() => setShowModal(false)}
        labelledBy="new-challenge-title"
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/10 backdrop-blur-[1px] p-4 sm:p-6 overflow-y-auto"
        containerClassName="bg-card rounded-xl shadow-xl max-w-md w-full p-6 my-auto space-y-6"
      >
        <ModalHeader
          titleId="new-challenge-title"
          title="New challenge"
          onClose={() => setShowModal(false)}
          className="mb-0"
        />

        <Form
          method="post"
          onSubmit={() => {
            setNewChallengeName("");
            setShowModal(false);
          }}
          className="space-y-4"
        >
          <input type="hidden" name="entity" value="challenge" />
          <input type="hidden" name="intent" value="create" />
          {isGeneral ? (
            <input type="hidden" name="general" value="1" />
          ) : (
            <input type="hidden" name="domainId" value={activeDomain} />
          )}
          <div>
            <label className="block text-sm font-medium text-foreground/80 mb-1">
              Challenge name <span className="text-destructive">*</span>
            </label>
            <input
              type="text"
              name="name"
              value={newChallengeName}
              onChange={(e) => setNewChallengeName(e.target.value)}
              placeholder="e.g. Engineering Challenge Fall 2026"
              required
              autoFocus
              autoComplete="off"
              className="block w-full rounded-lg border border-border shadow-sm focus:outline-none focus:ring-2 focus:ring-accent-coral/30 sm:text-sm p-2.5 text-foreground bg-card placeholder:text-muted-foreground"
            />
          </div>

          <div className="flex justify-end gap-3 pt-2 border-t border-border">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setShowModal(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              size="sm"
              disabled={!newChallengeName.trim()}
            >
              Create challenge
            </Button>
          </div>
        </Form>
      </Modal>
    </div>
  );
}

function RubricsPanel({ rubrics }: { rubrics: any[] }) {
  const [showModal, setShowModal] = useState(false);
  const [newRubricName, setNewRubricName] = useState("");

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center gap-4 flex-wrap">
        <div>
          <h2 className="font-heading text-lg font-bold text-foreground">Evaluation rubrics</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Scoring rubrics and their versions, kept separately from any cycle.
          </p>
        </div>
        <Button variant="primary" size="sm" onClick={() => setShowModal(true)}>
          <Plus className="w-4 h-4" />
          New rubric
        </Button>
      </div>

      <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-6">
        {rubrics.map((rubric: any) => (
          <Link
            key={rubric.id}
            to={`/hiring/rubrics/${rubric.id}`}
            className="bg-card rounded-xl border border-border p-6 shadow-sm hover:shadow-md transition-shadow group block"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <div className="p-2 bg-purple-100 text-purple-600 rounded-lg flex-shrink-0">
                  <ListOrdered className="w-6 h-6" />
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="font-heading font-bold text-foreground group-hover:text-accent-coral transition-colors break-words">
                    {rubric.name}
                  </h3>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-xs text-muted-foreground">
                      {rubric.versions.length} version
                      {rubric.versions.length !== 1 ? "s" : ""}
                    </span>
                  </div>
                </div>
              </div>
              <ChevronRight className="w-5 h-5 text-muted-foreground group-hover:text-accent-coral flex-shrink-0" />
            </div>
          </Link>
        ))}
        {rubrics.length === 0 && (
          <div className="col-span-full">
            <EmptyState
              icon={ListOrdered}
              title="No rubrics yet"
              description="Create a rubric to define scoring criteria reviewers use during evaluation."
            />
          </div>
        )}
      </div>

      <Modal
        open={showModal}
        onClose={() => setShowModal(false)}
        labelledBy="new-rubric-title"
      >
        <div className="space-y-4">
          <ModalHeader
            titleId="new-rubric-title"
            title="New rubric"
            onClose={() => setShowModal(false)}
            className="mb-0"
          />
          <Form
            method="post"
            onSubmit={() => setShowModal(false)}
            className="space-y-4"
          >
            <input type="hidden" name="entity" value="rubric" />
            <input type="hidden" name="intent" value="create" />
            <div>
              <label className="block text-sm font-medium text-foreground/80 mb-1">
                Rubric name
              </label>
              <input
                type="text"
                name="name"
                value={newRubricName}
                onChange={(e) => setNewRubricName(e.target.value)}
                placeholder="e.g. Design Challenge Rubric"
                className="w-full px-3 py-2 text-sm text-foreground bg-card border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-accent-coral/30 placeholder:text-muted-foreground"
                autoFocus
                autoComplete="off"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setShowModal(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="primary"
                size="sm"
                disabled={!newRubricName.trim()}
              >
                Create rubric
              </Button>
            </div>
          </Form>
        </div>
      </Modal>
    </div>
  );
}

function AgreementsPanel({
  agreements,
  canEdit,
}: {
  agreements: any[];
  canEdit: boolean;
}) {
  const [showModal, setShowModal] = useState(false);
  const [newName, setNewName] = useState("");

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center gap-4 flex-wrap">
        <div>
          <h2 className="font-heading text-lg font-bold text-foreground">
            Confidentiality agreements
          </h2>
          <p className="mt-1 text-sm text-muted-foreground max-w-2xl">
            Versioned agreements. Bind a version to a cycle from its admin page;
            reviewers, interviewers, domain leads, and admins must sign before
            viewing sensitive cycle data.
          </p>
        </div>
        {canEdit && (
          <Button variant="primary" size="sm" onClick={() => setShowModal(true)}>
            <Plus className="w-4 h-4" />
            New agreement
          </Button>
        )}
      </div>

      <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-6">
        {agreements.map((agreement: any) => {
          const latest = agreement.versions[0];
          return (
            <Link
              key={agreement.id}
              to={`/hiring/confidentiality-agreements/${agreement.id}`}
              className="bg-card rounded-xl border border-border p-6 shadow-sm hover:shadow-md transition-shadow group block"
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="p-2 bg-blue-100 text-blue-600 rounded-lg shrink-0">
                    <ShieldCheck className="w-6 h-6" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="font-heading font-bold text-foreground group-hover:text-accent-coral transition-colors truncate">
                      {agreement.name}
                    </h3>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-xs text-muted-foreground">
                        {agreement.versions.length} version
                        {agreement.versions.length !== 1 ? "s" : ""}
                      </span>
                      {latest && (
                        <span className="text-xs font-medium px-1.5 py-0.5 bg-muted text-muted-foreground rounded truncate">
                          v{latest.versionNumber}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <ChevronRight className="w-5 h-5 text-muted-foreground group-hover:text-accent-coral shrink-0" />
              </div>
            </Link>
          );
        })}
        {agreements.length === 0 && (
          <div className="col-span-full">
            <EmptyState
              icon={ShieldCheck}
              title="No agreements yet"
              description="Create a confidentiality agreement, then bind a version to a cycle so the team can read and sign it."
            />
          </div>
        )}
      </div>

      <Modal
        open={showModal}
        onClose={() => setShowModal(false)}
        labelledBy="new-agreement-title"
      >
        <div className="space-y-4">
          <ModalHeader
            titleId="new-agreement-title"
            title="New confidentiality agreement"
            onClose={() => setShowModal(false)}
            className="mb-0"
          />
          <Form
            method="post"
            onSubmit={() => setShowModal(false)}
            className="space-y-4"
          >
            <input type="hidden" name="entity" value="agreement" />
            <input type="hidden" name="intent" value="create" />
            <div>
              <label className="block text-sm font-medium text-foreground/80 mb-1">
                Agreement name
              </label>
              <input
                type="text"
                name="name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. Hiring Confidentiality — 2026"
                className="w-full px-3 py-2 text-sm text-foreground bg-card border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-accent-coral/30 placeholder:text-muted-foreground"
                autoFocus
                autoComplete="off"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setShowModal(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="primary"
                size="sm"
                disabled={!newName.trim()}
              >
                Create agreement
              </Button>
            </div>
          </Form>
        </div>
      </Modal>
    </div>
  );
}
