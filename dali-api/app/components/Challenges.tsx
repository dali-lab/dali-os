import React, { useState } from 'react'
import { Link } from 'react-router'
import { Plus, FileText, ChevronRight, X, Trash2 } from 'lucide-react'
import { useForms } from '~/context/FormsContext'
import type { ApplicationForm, ChallengeType } from '~/types'

const tabs: ChallengeType[] = ['General', 'UI/UX', 'Fullstack', 'Data', 'AR/VR', 'PM', 'Engines']

export default function Challenges() {
  const { forms, addForm, deleteForm } = useForms()
  const [activeTab, setActiveTab] = useState<ChallengeType>('General')
  const [showModal, setShowModal] = useState(false)
  const [newChallengeName, setNewChallengeName] = useState('')

  const handleCreateChallenge = () => {
    if (!newChallengeName.trim()) return
    const newChallenge: ApplicationForm = {
      id: `challenge-${Date.now()}`,
      name: newChallengeName.trim(),
      type: activeTab,
      createdAt: new Date().toISOString(),
      versions: [],
    }
    addForm(newChallenge)
    setNewChallengeName('')
    setShowModal(false)
  }

  return (
    <div className="flex gap-8">
      {/* Side Navbar */}
      <nav className="w-48 flex-shrink-0">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Domain</p>
        <ul className="space-y-1">
          {tabs.map((tab) => (
            <li key={tab}>
              <button
                onClick={() => setActiveTab(tab)}
                className={`w-full text-left px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  activeTab === tab
                    ? 'bg-blue-50 text-blue-700'
                    : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                }`}
              >
                {tab}
              </button>
            </li>
          ))}
        </ul>
      </nav>

      {/* Main Content */}
      <div className="flex-1 space-y-8">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{activeTab} Challenge</h1>
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
          {forms.filter((f) => f.type === activeTab).map((challenge) => (
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
                      {challenge.versions.length} version
                      {challenge.versions.length !== 1 ? 's' : ''}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={(e) => { e.preventDefault(); deleteForm(challenge.id) }}
                    className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-md opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                  <ChevronRight className="w-5 h-5 text-gray-400 group-hover:text-blue-500 transition-colors" />
                </div>
              </div>
              <div className="mt-6 pt-4 border-t border-gray-100 text-sm text-gray-500">
                Created {new Date(challenge.createdAt).toLocaleDateString()}
              </div>
            </Link>
          ))}
        </div>
      </div>

      {/* New Challenge Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/10 backdrop-blur-[1px]"
            onClick={() => setShowModal(false)}
          />
          <div className="relative bg-white rounded-xl shadow-xl w-full max-w-md p-6 space-y-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-bold text-gray-900">New {activeTab} Challenge</h2>
              <button
                onClick={() => setShowModal(false)}
                className="text-gray-400 hover:text-gray-600 p-1 rounded-md hover:bg-gray-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Challenge Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={newChallengeName}
                onChange={(e) => setNewChallengeName(e.target.value)}
                placeholder="e.g. UI/UX Challenge Fall 2026"
                className="block w-full rounded-lg border border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm p-2.5 text-gray-900 bg-white placeholder-gray-400"
              />
            </div>

            <div className="flex justify-end gap-3 pt-2 border-t border-gray-200">
              <button
                onClick={() => setShowModal(false)}
                className="px-4 py-2 border border-gray-300 shadow-sm text-sm font-medium rounded-lg text-gray-700 bg-white hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateChallenge}
                disabled={!newChallengeName.trim()}
                className="px-4 py-2 border border-transparent text-sm font-medium rounded-lg text-white bg-blue-600 hover:bg-blue-700 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Create Challenge
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

