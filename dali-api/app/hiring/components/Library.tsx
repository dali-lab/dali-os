import React, { useState } from "react";
import { Link, Form, useLoaderData, useSearchParams } from "react-router";
import { Select, type SelectOption } from "~/components/ui/floating";
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
import type { loader } from "~/hiring/routes/library";

type Tab = "rubrics" | "agreements";

const TABS: { id: Tab; label: string }[] = [
  { id: "rubrics", label: "Rubrics" },
  { id: "agreements", label: "Agreements" },
];

function parseTab(value: string | null): Tab {
  return value === "agreements" ? value : "rubrics";
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
      <AreaPillNav items={hiringPills({ ...data.pillRoles, active: "library" })} />
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

      {tab === "rubrics" && <RubricsPanel rubrics={data.rubrics} />}
      {tab === "agreements" && (
        <AgreementsPanel agreements={data.agreements} canEdit={data.canEdit} />
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
        <Button variant="primary" size="sm" onClick={() => setShowModal(true)}>
          <Plus className="w-4 h-4" />
          New Rubric
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

      <Modal
        open={showModal}
        onClose={() => setShowModal(false)}
        labelledBy="new-rubric-title"
      >
        <div className="space-y-4">
          <ModalHeader
            titleId="new-rubric-title"
            title="New Rubric"
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
                className="w-full px-3 py-2 text-sm text-foreground border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                Create
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
          <Button variant="primary" size="sm" onClick={() => setShowModal(true)}>
            <Plus className="w-4 h-4" />
            New Agreement
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

      <Modal
        open={showModal}
        onClose={() => setShowModal(false)}
        labelledBy="new-agreement-title"
      >
        <div className="space-y-4">
          <ModalHeader
            titleId="new-agreement-title"
            title="New Confidentiality Agreement"
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
                className="w-full px-3 py-2 text-sm text-foreground border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                Create
              </Button>
            </div>
          </Form>
        </div>
      </Modal>
    </div>
  );
}
