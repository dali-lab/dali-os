import React, { useState } from "react";
import { Link, Form, useLoaderData, useSearchParams } from "react-router";
import {
  Plus,
  FileText,
  ListOrdered,
  ShieldCheck,
  ChevronRight,
  X,
  Trash2,
} from "lucide-react";
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
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-bold text-foreground">Library</h1>
        <p className="mt-1 text-muted-foreground">
          Reusable hiring artifacts — challenges, rubrics, and confidentiality
          agreements — versioned independently of any cycle.
        </p>
      </header>

      <div className="flex items-center gap-2" role="tablist" aria-label="Library section">
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
                  ? "bg-accent-coral text-white"
                  : "text-foreground hover:bg-muted"
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
          <h2 className="text-lg font-bold text-foreground">
            {activeDomainName} Challenges
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {isGeneral
              ? "Manage the general application form and its versions."
              : "Manage domain challenges and their versions independently of hiring cycles."}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <select
            value={activeDomain}
            onChange={(e) => setActiveDomain(e.target.value)}
            aria-label="Domain"
            className="px-3 py-2 rounded-lg border border-border bg-card text-sm font-medium text-foreground hover:bg-muted/50 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
          >
            <option value={GENERAL_TAB_ID}>General</option>
            {domains.map((domain: any) => (
              <option key={domain.id} value={domain.id}>
                {domain.name}
              </option>
            ))}
          </select>
          <button
            onClick={() => setShowModal(true)}
            className="inline-flex items-center justify-center px-4 py-2 border border-transparent text-sm font-medium rounded-lg text-white bg-accent-coral hover:bg-accent-coral/90 shadow-sm"
          >
            <Plus className="w-4 h-4 mr-2" />
            New Challenge
          </button>
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
                    <h3 className="text-lg font-bold text-foreground group-hover:text-blue-600 transition-colors break-words">
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
                      className="p-1.5 text-muted-foreground/70 hover:text-red-600 hover:bg-red-50 rounded-md opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </Form>
                  <ChevronRight className="w-5 h-5 text-muted-foreground/70 group-hover:text-blue-500 transition-colors" />
                </div>
              </div>
              <div className="mt-6 pt-4 border-t border-border text-sm text-muted-foreground">
                Created {new Date(challenge.createdAt).toLocaleDateString()}
              </div>
            </Link>
          );
        })}
        {filtered.length === 0 && (
          <div className="col-span-full text-center py-12 text-muted-foreground/70 text-sm">
            No challenges for this domain yet.
          </div>
        )}
      </div>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/10 backdrop-blur-[1px]"
            onClick={() => setShowModal(false)}
          />
          <div
            className="relative bg-card rounded-xl shadow-xl w-full max-w-md p-6 space-y-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-bold text-foreground">New Challenge</h2>
              <button
                onClick={() => setShowModal(false)}
                className="text-muted-foreground/70 hover:text-muted-foreground p-1 rounded-md hover:bg-muted"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

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
                  Challenge Name <span className="text-red-500">*</span>
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
                  className="block w-full rounded-lg border border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm p-2.5 text-foreground bg-card placeholder-gray-400"
                />
              </div>

              <div className="flex justify-end gap-3 pt-2 border-t border-border">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 border border-gray-300 shadow-sm text-sm font-medium rounded-lg text-foreground/80 bg-card hover:bg-muted/50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!newChallengeName.trim()}
                  className="px-4 py-2 border border-transparent text-sm font-medium rounded-lg text-white bg-accent-coral hover:bg-accent-coral/90 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Create Challenge
                </button>
              </div>
            </Form>
          </div>
        </div>
      )}
    </div>
  );
}

function RubricsPanel({ rubrics }: { rubrics: any[] }) {
  const [showModal, setShowModal] = useState(false);
  const [newRubricName, setNewRubricName] = useState("");

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-lg font-bold text-foreground">Evaluation Rubrics</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage rubrics and their versions independently of hiring cycles.
          </p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="inline-flex items-center justify-center px-4 py-2 border border-transparent text-sm font-medium rounded-lg text-white bg-accent-coral hover:bg-accent-coral/90 shadow-sm"
        >
          <Plus className="w-4 h-4 mr-2" />
          New Rubric
        </button>
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
                  <h3 className="font-bold text-foreground group-hover:text-blue-600 transition-colors break-words">
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
              <ChevronRight className="w-5 h-5 text-muted-foreground/70 group-hover:text-blue-500 flex-shrink-0" />
            </div>
          </Link>
        ))}
        {rubrics.length === 0 && (
          <p className="text-muted-foreground col-span-3 text-sm italic">
            No rubrics yet.
          </p>
        )}
      </div>

      {showModal && (
        <div
          className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
          onClick={() => setShowModal(false)}
        >
          <div
            className="bg-card rounded-lg shadow-xl w-full max-w-sm p-6 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-foreground">New Rubric</h2>
              <button
                onClick={() => setShowModal(false)}
                className="text-muted-foreground/70 hover:text-muted-foreground"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
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
                  className="w-full px-3 py-2 text-sm text-foreground border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  autoFocus
                  autoComplete="off"
                />
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-3 py-2 text-sm font-medium text-foreground/80 bg-card border border-gray-300 rounded-md hover:bg-muted/50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!newRubricName.trim()}
                  className="px-3 py-2 text-sm font-medium text-white bg-accent-coral rounded-md hover:bg-accent-coral/90 disabled:opacity-50"
                >
                  Create
                </button>
              </div>
            </Form>
          </div>
        </div>
      )}
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
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-lg font-bold text-foreground">
            Confidentiality Agreements
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Versioned confidentiality agreements. Bind a specific version to a
            cycle from the cycle admin page; reviewers, interviewers, domain
            leads, and admins must sign before viewing sensitive cycle data.
          </p>
        </div>
        {canEdit && (
          <button
            onClick={() => setShowModal(true)}
            className="inline-flex items-center justify-center px-4 py-2 border border-transparent text-sm font-medium rounded-lg text-white bg-accent-coral hover:bg-accent-coral/90 shadow-sm"
          >
            <Plus className="w-4 h-4 mr-2" />
            New Agreement
          </button>
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
                    <h3 className="font-bold text-foreground group-hover:text-blue-600 transition-colors truncate">
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
                <ChevronRight className="w-5 h-5 text-muted-foreground/70 group-hover:text-blue-500 shrink-0" />
              </div>
            </Link>
          );
        })}
        {agreements.length === 0 && (
          <p className="text-muted-foreground col-span-3 text-sm italic">
            No agreements yet.
          </p>
        )}
      </div>

      {showModal && (
        <div
          className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
          onClick={() => setShowModal(false)}
        >
          <div
            className="bg-card rounded-lg shadow-xl w-full max-w-sm p-6 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-foreground">
                New Confidentiality Agreement
              </h2>
              <button
                onClick={() => setShowModal(false)}
                className="text-muted-foreground/70 hover:text-muted-foreground"
                aria-label="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
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
                  className="w-full px-3 py-2 text-sm text-foreground border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  autoFocus
                  autoComplete="off"
                />
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-3 py-2 text-sm font-medium text-foreground/80 bg-card border border-gray-300 rounded-md hover:bg-muted/50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!newName.trim()}
                  className="px-3 py-2 text-sm font-medium text-white bg-accent-coral rounded-md hover:bg-accent-coral/90 disabled:opacity-50"
                >
                  Create
                </button>
              </div>
            </Form>
          </div>
        </div>
      )}
    </div>
  );
}
