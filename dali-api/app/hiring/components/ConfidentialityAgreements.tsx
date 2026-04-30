import { useState } from "react";
import { Link, Form, useLoaderData } from "react-router";
import { Plus, ShieldCheck, ChevronRight, X } from "lucide-react";
import type { loader } from "~/hiring/routes/confidentiality-agreements";

export default function ConfidentialityAgreementsList() {
  const { agreements, canEdit } = useLoaderData<typeof loader>();
  const [showModal, setShowModal] = useState(false);
  const [newName, setNewName] = useState("");

  return (
    <div className="space-y-8">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-foreground">
            Confidentiality Agreements
          </h1>
          <p className="mt-1 text-muted-foreground">
            Versioned confidentiality agreements. Bind a specific version to a
            cycle from the cycle admin page; reviewers, interviewers, domain
            leads, and admins must sign before viewing sensitive cycle data.
          </p>
        </div>
        {canEdit && (
          <button
            onClick={() => setShowModal(true)}
            className="inline-flex items-center justify-center px-4 py-2 border border-transparent text-sm font-medium rounded-lg text-white bg-blue-600 hover:bg-blue-700 shadow-sm"
          >
            <Plus className="w-4 h-4 mr-2" />
            New Agreement
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {agreements.map((agreement) => {
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
                  className="px-3 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50"
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
