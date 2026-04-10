import { useState } from 'react'
import { useParams, Link, useNavigate } from 'react-router'
import {
  ArrowLeft,
  Save,
  CheckCircle,
  AlertCircle,
  HelpCircle,
  PenTool,
  X,
} from 'lucide-react'
import { adminUser, applicationCycles, mockApplications, rubrics, challenges } from '~/mockData'
import { ApplicationViewer } from '~/components/ApplicationViewer'
import type { MentorReview } from '~/types'

export function loader() {
  return {}
}

export default function MentorApplicationReview() {
  const { id } = useParams<{
    id: string
  }>()
  const navigate = useNavigate()
  const applications = mockApplications
  const saveMentorReview = (_appId: string, _reviewData: Omit<MentorReview, 'id' | 'createdAt' | 'updatedAt'>) => {}
  const mentorId = adminUser.id
  const app = applications.find((a) => a.id === id)
  const cycle = applicationCycles.find((c) => c.id === app?.applicationCycleId)
  // Find existing review if any
  const existingReview = app?.mentorReviews?.find(
    (r) => r.mentorId === mentorId,
  )
  const [scores, setScores] = useState<Record<string, number>>(
    existingReview?.scores || {},
  )
  const [feedback, setFeedback] = useState(existingReview?.feedback || '')
  const [rejectionRationale, setRejectionRationale] = useState(
    existingReview?.rejectionRationale || '',
  )
  const [overallRecommendation, setOverallRecommendation] = useState<
    MentorReview['overallRecommendation']
  >(existingReview?.overallRecommendation || null)
  const [isSaving, setIsSaving] = useState(false)
  // Floating UI states
  const [showRubric, setShowRubric] = useState(false)

  if (!app || !cycle) return <div>Application not found</div>
  // Get active rubrics for this cycle
  const generalRubricVersion = rubrics
    .flatMap((r) => r.versions)
    .find((v) => v.id === cycle.activeGeneralRubricVersionId)
  const domainApp = app.domainApplications[0]
  const domainId = challenges
    .flatMap((c) => c.versions)
    .find((v) => v.id === domainApp?.challengeVersionId)?.domainId
  const domainRubricVersion =
    domainId && cycle.activeDomainRubricVersionIds
      ? rubrics
          .flatMap((r) => r.versions)
          .find((v) => v.id === cycle.activeDomainRubricVersionIds![domainId])
      : undefined
  const handleScoreChange = (criteria: string, score: number) => {
    setScores((prev) => ({
      ...prev,
      [criteria]: score,
    }))
  }
  const handleSave = () => {
    setIsSaving(true)
    saveMentorReview(app.id, {
      applicationId: app.id,
      mentorId,
      scores,
      feedback,
      rejectionRationale,
      overallRecommendation,
    })
    setTimeout(() => {
      setIsSaving(false)
      navigate('/mentor')
    }, 500)
  }
  const scoringCriteria = [
    'Technical Skills',
    'Design Sense',
    'Communication',
    'Culture Fit',
  ]
  return (
    <div className="space-y-6 pb-12 relative">
      <div>
        <Link
          to="/mentor"
          className="inline-flex items-center text-sm text-gray-500 hover:text-gray-700 mb-4"
        >
          <ArrowLeft className="w-4 h-4 mr-1" /> Back to Dashboard
        </Link>
        <div className="flex justify-between items-end">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              Review Application: Applicant {app.userId.replace('user-', '#')}
            </h1>
            <p className="mt-1 text-gray-500">{cycle.name}</p>
          </div>
          {existingReview && (
            <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-green-100 text-green-800">
              <CheckCircle className="w-4 h-4 mr-1.5" /> Review Saved
            </span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left Column: Application Content */}
        <div className="lg:col-span-2">
          <ApplicationViewer app={app} />
        </div>

        {/* Right Column: Review Form */}
        <div className="space-y-6">
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm sticky top-24">
            <div className="px-6 py-4 border-b border-gray-200 bg-blue-50">
              <h2 className="text-lg font-bold text-blue-900">Your Review</h2>
            </div>

            <div className="p-6 space-y-6">
              {/* Scoring */}
              <div>
                <h3 className="text-sm font-bold text-gray-900 uppercase tracking-wider mb-4">
                  Scoring Rubric
                </h3>
                <div className="space-y-6">
                  {generalRubricVersion && (
                    <div>
                      <h4 className="text-sm font-bold text-gray-700 mb-3 uppercase tracking-wider">
                        General Criteria
                      </h4>
                      <div className="space-y-4">
                        {generalRubricVersion.criteria.map((criterion) => (
                          <div key={criterion.key}>
                            <div className="flex justify-between items-center mb-1">
                              <label className="text-sm font-medium text-gray-900">
                                {criterion.label}
                              </label>
                              <span className="text-xs font-bold text-blue-600 bg-blue-50 px-2 py-1 rounded">
                                {scores[criterion.key] || 0} /{' '}
                                {criterion.maxScore}
                              </span>
                            </div>
                            {criterion.description && (
                              <p className="text-xs text-gray-500 mb-2">
                                {criterion.description}
                              </p>
                            )}
                            <input
                              type="range"
                              min="0"
                              max={criterion.maxScore}
                              value={scores[criterion.key] || 0}
                              onChange={(e) =>
                                handleScoreChange(
                                  criterion.key,
                                  parseInt(e.target.value),
                                )
                              }
                              className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
                            />
                            <div className="flex justify-between text-xs text-gray-400 mt-1">
                              <span>0</span>
                              <span>{criterion.maxScore}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {domainRubricVersion && (
                    <div className="pt-4 border-t border-gray-200">
                      <h4 className="text-sm font-bold text-gray-700 mb-3 uppercase tracking-wider">
                        Domain-Specific Criteria
                      </h4>
                      <div className="space-y-4">
                        {domainRubricVersion.criteria.map((criterion) => (
                          <div key={criterion.key}>
                            <div className="flex justify-between items-center mb-1">
                              <label className="text-sm font-medium text-gray-900">
                                {criterion.label}
                              </label>
                              <span className="text-xs font-bold text-purple-600 bg-purple-50 px-2 py-1 rounded">
                                {scores[criterion.key] || 0} /{' '}
                                {criterion.maxScore}
                              </span>
                            </div>
                            {criterion.description && (
                              <p className="text-xs text-gray-500 mb-2">
                                {criterion.description}
                              </p>
                            )}
                            <input
                              type="range"
                              min="0"
                              max={criterion.maxScore}
                              value={scores[criterion.key] || 0}
                              onChange={(e) =>
                                handleScoreChange(
                                  criterion.key,
                                  parseInt(e.target.value),
                                )
                              }
                              className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-purple-600"
                            />
                            <div className="flex justify-between text-xs text-gray-400 mt-1">
                              <span>0</span>
                              <span>{criterion.maxScore}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {!generalRubricVersion && !domainRubricVersion && (
                    <div className="text-center py-6 border-2 border-dashed border-gray-300 rounded-lg">
                      <p className="text-sm text-gray-500">
                        No rubrics configured for this cycle.
                      </p>
                    </div>
                  )}
                </div>
              </div>

              {/* Feedback */}
              <div>
                <h3 className="text-sm font-bold text-gray-900 uppercase tracking-wider mb-2">
                  Internal Feedback
                </h3>
                <p className="text-xs text-gray-500 mb-2">
                  Notes for other reviewers. Not visible to applicant.
                </p>
                <textarea
                  rows={4}
                  value={feedback}
                  onChange={(e) => setFeedback(e.target.value)}
                  className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm border p-2"
                  placeholder="Strengths, weaknesses, areas to probe in interview..."
                />
              </div>

              {/* Rejection Rationale */}
              <div>
                <h3 className="text-sm font-bold text-gray-900 uppercase tracking-wider mb-2 flex items-center gap-2">
                  Rejection Rationale{' '}
                  <span className="text-xs font-normal text-gray-500 normal-case">
                    (Optional)
                  </span>
                </h3>
                <p className="text-xs text-gray-500 mb-2">
                  If we reject this candidate, what specific feedback should we
                  provide if they ask?
                </p>
                <textarea
                  rows={3}
                  value={rejectionRationale}
                  onChange={(e) => setRejectionRationale(e.target.value)}
                  className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm border p-2"
                  placeholder="e.g., Needs more experience with React state management..."
                />
              </div>

              {/* Overall Recommendation */}
              <div className="pt-4 border-t border-gray-200">
                <h3 className="text-sm font-bold text-gray-900 uppercase tracking-wider mb-3">
                  Overall Recommendation
                </h3>
                <div className="space-y-2">
                  {[
                    'Strong Hire',
                    'Hire',
                    'Lean Hire',
                    'Lean No Hire',
                    'No Hire',
                  ].map((rec) => (
                    <label
                      key={rec}
                      className={`flex items-center p-3 border rounded-lg cursor-pointer transition-colors ${overallRecommendation === rec ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:bg-gray-50'}`}
                    >
                      <input
                        type="radio"
                        name="recommendation"
                        value={rec}
                        checked={overallRecommendation === rec}
                        onChange={() => setOverallRecommendation(rec as any)}
                        className="h-4 w-4 text-blue-600 border-gray-300 focus:ring-blue-500"
                      />
                      <span className="ml-3 text-sm font-medium text-gray-900">
                        {rec}
                      </span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Save Button */}
              <div className="pt-4">
                <button
                  onClick={handleSave}
                  disabled={isSaving || !overallRecommendation}
                  className="w-full flex justify-center items-center px-4 py-3 border border-transparent text-sm font-medium rounded-lg text-white bg-blue-600 hover:bg-blue-700 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isSaving ? (
                    'Saving...'
                  ) : (
                    <>
                      <Save className="w-4 h-4 mr-2" />
                      Save Review
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Floating Action Buttons */}
      <div className="fixed bottom-8 right-8 flex flex-col gap-4 z-50">

        {/* Rubric Toggle */}
        <button
          onClick={() => setShowRubric(!showRubric)}
          className={`w-14 h-14 rounded-full flex items-center justify-center shadow-lg transition-all ${showRubric ? 'bg-blue-600 text-white' : 'bg-white text-blue-600 hover:bg-blue-50 border border-gray-200'}`}
          title="Scoring Rubric"
        >
          {showRubric ? (
            <X className="w-6 h-6" />
          ) : (
            <HelpCircle className="w-6 h-6" />
          )}
        </button>
      </div>

      {/* Floating Rubric Panel */}
      {showRubric && (
        <div className="fixed bottom-24 right-8 w-96 bg-white rounded-xl shadow-2xl border border-gray-200 overflow-hidden z-50 animate-in slide-in-from-bottom-4">
          <div className="bg-blue-600 px-4 py-3 flex justify-between items-center">
            <h3 className="font-bold text-white flex items-center">
              <HelpCircle className="w-4 h-4 mr-2" /> Scoring Rubric
            </h3>
          </div>
          <div className="p-0 max-h-[60vh] overflow-y-auto">
            <ul className="divide-y divide-gray-100">
              {generalRubricVersion && (
                <li className="p-4 bg-gray-50 border-b border-gray-200">
                  <h4 className="font-bold text-gray-900 uppercase tracking-wider text-xs">
                    General Criteria
                  </h4>
                </li>
              )}
              {generalRubricVersion?.criteria.map((c) => (
                <li key={c.key} className="p-4 hover:bg-gray-50">
                  <div className="flex justify-between items-start mb-1">
                    <h4 className="font-bold text-gray-900">{c.label}</h4>
                    <span className="text-xs font-bold text-blue-600 bg-blue-50 px-2 py-1 rounded">
                      Max: {c.maxScore}
                    </span>
                  </div>
                  {c.description && (
                    <p className="text-sm text-gray-600">{c.description}</p>
                  )}
                </li>
              ))}

              {domainRubricVersion && (
                <li className="p-4 bg-gray-50 border-b border-gray-200">
                  <h4 className="font-bold text-gray-900 uppercase tracking-wider text-xs">
                    Domain Criteria
                  </h4>
                </li>
              )}
              {domainRubricVersion?.criteria.map((c) => (
                <li key={c.key} className="p-4 hover:bg-gray-50">
                  <div className="flex justify-between items-start mb-1">
                    <h4 className="font-bold text-gray-900">{c.label}</h4>
                    <span className="text-xs font-bold text-purple-600 bg-purple-50 px-2 py-1 rounded">
                      Max: {c.maxScore}
                    </span>
                  </div>
                  {c.description && (
                    <p className="text-sm text-gray-600">{c.description}</p>
                  )}
                </li>
              ))}

              {!generalRubricVersion && !domainRubricVersion && (
                <li className="p-8 text-center text-gray-500 italic">
                  No rubrics configured for this cycle.
                </li>
              )}
            </ul>
          </div>
        </div>
      )}
    </div>
  )
}
