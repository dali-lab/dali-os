import React, { useState } from 'react'
import { Link, Form, useLoaderData } from 'react-router'
import { Plus, FileText, ChevronRight, X, Trash2 } from 'lucide-react'
import type { loader } from '~/routes/admin.challenges'

export default function Challenges() {
  const { domains: rawDomains, challenges } = useLoaderData<typeof loader>()

  // General always first, then the rest alphabetically
  const domains = [
    ...rawDomains.filter((d) => d.name === 'General'),
    ...rawDomains.filter((d) => d.name !== 'General'),
  ]

  const [activeDomainId, setActiveDomainId] = useState<string>(domains[0]?.id ?? '')
  const [showModal, setShowModal] = useState(false)
  const [newChallengeName, setNewChallengeName] = useState('')

  // Challenges that have at least one version in the active domain,
  // or challenges with no versions (shown in "All" / first tab)
  const filtered = challenges.filter((c) =>
    c.versions.some((v) => v.domainId === activeDomainId)
  )

  const activeDomain = domains.find((d) => d.id === activeDomainId)

  return (
    <div className="flex gap-8">
      {/* Side Navbar */}
      <nav className="w-48 flex-shrink-0">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Domain</p>
        <ul className="space-y-1">
          {domains.map((domain) => (
            <li key={domain.id}>
              <button
                onClick={() => setActiveDomainId(domain.id)}
                className={`w-full text-left px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  activeDomainId === domain.id
                    ? 'bg-blue-50 text-blue-700'
                    : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                }`}
              >
                {domain.name}
              </button>
            </li>
          ))}
        </ul>
      </nav>

      {/* Main Content */}
      <div className="flex-1 space-y-8">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{activeDomain?.name ?? ''} Challenges</h1>
            <p className="mt-1 text-gray-500">
              Manage domain challenges and their versions independently of hiring cycles.
            </p>
          </div>
          <button
            onClick={() => setShowModal(true)}
            className="inline-flex items-center justify-center px-4 py-2 border border-transparent text-sm font-medium rounded-lg text-white bg-blue-600 hover:bg-blue-700 shadow-sm"
          >
            <Plus className="w-4 h-4 mr-2" />
            New Challenge
          </button>
        </div>

<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filtered.map((challenge) => {
            const domainVersionCount = challenge.versions.filter(
              (v) => v.domainId === activeDomainId
            ).length
            return (
              <Link
                key={challenge.id}
                to={`/challenges/${challenge.id}`}
                className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm hover:shadow-md transition-shadow group block"
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-blue-50 rounded-lg text-blue-600">
                      <FileText className="w-6 h-6" />
                    </div>
                    <div>
                      <h3 className="text-lg font-bold text-gray-900 group-hover:text-blue-600 transition-colors">
                        {challenge.name}
                      </h3>
                      <p className="text-sm text-gray-500 mt-1">
                        {domainVersionCount} version{domainVersionCount !== 1 ? 's' : ''}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <Form method="post" onClick={(e) => e.stopPropagation()}>
                      <input type="hidden" name="intent" value="delete" />
                      <input type="hidden" name="id" value={challenge.id} />
                      <button
                        type="submit"
                        className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-md opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </Form>
                    <ChevronRight className="w-5 h-5 text-gray-400 group-hover:text-blue-500 transition-colors" />
                  </div>
                </div>
                <div className="mt-6 pt-4 border-t border-gray-100 text-sm text-gray-500">
                  Created {new Date(challenge.createdAt).toLocaleDateString()}
                </div>
              </Link>
            )
          })}
          {filtered.length === 0 && (
            <div className="col-span-3 text-center py-12 text-gray-400 text-sm">
              No challenges for this domain yet.
            </div>
          )}
        </div>
      </div>

      {/* New Challenge Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/10 backdrop-blur-[1px]"
            onClick={() => setShowModal(false)}
          />
          <div
            className="relative bg-white rounded-xl shadow-xl w-full max-w-md p-6 space-y-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-bold text-gray-900">New Challenge</h2>
              <button
                onClick={() => setShowModal(false)}
                className="text-gray-400 hover:text-gray-600 p-1 rounded-md hover:bg-gray-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <Form
              method="post"
              onSubmit={() => {
                setNewChallengeName('')
                setShowModal(false)
              }}
              className="space-y-4"
            >
              <input type="hidden" name="intent" value="create" />
              <input type="hidden" name="domainId" value={activeDomainId} />
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
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
                  className="block w-full rounded-lg border border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm p-2.5 text-gray-900 bg-white placeholder-gray-400"
                />
              </div>

              <div className="flex justify-end gap-3 pt-2 border-t border-gray-200">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 border border-gray-300 shadow-sm text-sm font-medium rounded-lg text-gray-700 bg-white hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!newChallengeName.trim()}
                  className="px-4 py-2 border border-transparent text-sm font-medium rounded-lg text-white bg-blue-600 hover:bg-blue-700 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Create Challenge
                </button>
              </div>
            </Form>
          </div>
        </div>
      )}
    </div>
  )
}
