import { useState } from 'react'
import { Link, useLoaderData, useNavigate, useSubmit } from 'react-router'
import { ArrowLeft, Save, HelpCircle, X } from 'lucide-react'
import { prisma } from '~/lib/db'
import type { Route } from './+types/mentor.application.$id'
import { ApplicationViewer } from '~/components/ApplicationViewer'
import type { Question } from '~/types'

export async function loader({ params }: Route.LoaderArgs) {
  const application = await prisma.application.findUniqueOrThrow({
    where: { id: params.id },
    include: {
      user: true,
      applicationCycle: {
        include: {
          statusUpdates: { orderBy: { createdAt: 'desc' }, take: 1 },
          formVersion: true,
        },
      },
      domainApplications: {
        include: {
          challengeVersion: {
            include: { domain: true, challenge: true },
          },
        },
      },
    },
  })

  // TODO: replace with session user
  const mentor = await prisma.user.findFirstOrThrow({
    where: { daliEmail: 'admin@dali.dartmouth.edu' },
  })

  return { application, mentor }
}

export async function action({ request, params }: Route.ActionArgs) {
  const formData = await request.formData()
  const intent = formData.get('intent') as string

  if (intent === 'save-review') {
    const mentorId = formData.get('mentorId') as string
    const scores = JSON.parse(formData.get('scores') as string)
    const feedback = (formData.get('feedback') as string) ?? ''
    const rejectionRationale = (formData.get('rejectionRationale') as string) ?? ''
    const overallRecommendation = (formData.get('overallRecommendation') as string) || null
    const annotations = JSON.parse((formData.get('annotations') as string) ?? '[]')

    // MentorReview uses upsert since schema now has @@unique([mentorId, applicationId])
    // Note: requires `prisma db push` to have been run after schema change
    await prisma.mentorReview.upsert({
      where: { mentorId_applicationId: { mentorId, applicationId: params.id } },
      update: { scores, feedback, rejectionRationale, overallRecommendation, annotations },
      create: { mentorId, applicationId: params.id, scores, feedback, rejectionRationale, overallRecommendation, annotations },
    })
  }

  return null
}

type LoaderData = Awaited<ReturnType<typeof loader>>
type DomainApp = LoaderData['application']['domainApplications'][number]

const RECOMMENDATIONS = ['Strong Hire', 'Hire', 'Lean Hire', 'Lean No Hire', 'No Hire'] as const

export default function MentorApplicationReview() {
  const { application, mentor } = useLoaderData<typeof loader>()
  const navigate = useNavigate()
  const submit = useSubmit()

  const cycle = application.applicationCycle
  const formQuestions = (cycle.formVersion?.questions as unknown as Question[]) ?? []

  const [scores, setScores] = useState<Record<string, number>>({})
  const [feedback, setFeedback] = useState('')
  const [rejectionRationale, setRejectionRationale] = useState('')
  const [overallRecommendation, setOverallRecommendation] = useState<string | null>(null)
  const [annotations, setAnnotations] = useState<object[]>([])
  const [isSaving, setIsSaving] = useState(false)
  const [showRubric, setShowRubric] = useState(false)

  const handleSave = () => {
    setIsSaving(true)
    const formData = new FormData()
    formData.set('intent', 'save-review')
    formData.set('mentorId', mentor.id)
    formData.set('scores', JSON.stringify(scores))
    formData.set('feedback', feedback)
    formData.set('rejectionRationale', rejectionRationale)
    formData.set('overallRecommendation', overallRecommendation ?? '')
    formData.set('annotations', JSON.stringify(annotations))
    submit(formData, { method: 'post' })
    setTimeout(() => {
      setIsSaving(false)
      navigate('/mentor')
    }, 500)
  }

  // Build question label lookup from form + challenge versions
  const questionLabels: Record<string, string> = {}
  for (const q of formQuestions) {
    questionLabels[q.key] = q.data.label
  }
  for (const da of application.domainApplications) {
    const qs = da.challengeVersion.questions as unknown as Question[]
    for (const q of qs) {
      questionLabels[q.key] = q.data.label
    }
  }

  return (
    <div className="space-y-6 pb-12 relative">
      <div>
        <Link to="/mentor" className="inline-flex items-center text-sm text-gray-500 hover:text-gray-700 mb-4">
          <ArrowLeft className="w-4 h-4 mr-1" /> Back to Dashboard
        </Link>
        <div className="flex justify-between items-end">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              Review: {application.user.firstName} {application.user.lastName}
            </h1>
            <p className="mt-1 text-gray-500">{cycle.name}</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left: Application Content */}
        <div className="lg:col-span-2">
          <ApplicationViewer
            application={application}
            questionLabels={questionLabels}
            onAnnotationsChange={setAnnotations}
          />
        </div>

        {/* Right: Review Form */}
        <div className="space-y-6">
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm sticky top-24">
            <div className="px-6 py-4 border-b border-gray-200 bg-blue-50">
              <h2 className="text-lg font-bold text-blue-900">Your Review</h2>
            </div>
            <div className="p-6 space-y-6">

              {/* Scoring — simple criteria for now, no rubric model yet */}
              <div>
                <h3 className="text-sm font-bold text-gray-900 uppercase tracking-wider mb-4">Scoring</h3>
                <div className="space-y-4">
                  {['Communication', 'Culture Fit', 'Technical Skills', 'Design Sense'].map((criterion) => (
                    <div key={criterion}>
                      <div className="flex justify-between items-center mb-1">
                        <label className="text-sm font-medium text-gray-900">{criterion}</label>
                        <span className="text-xs font-bold text-blue-600 bg-blue-50 px-2 py-1 rounded">
                          {scores[criterion] ?? 0} / 5
                        </span>
                      </div>
                      <input
                        type="range" min="0" max="5"
                        value={scores[criterion] ?? 0}
                        onChange={(e) => setScores((prev) => ({ ...prev, [criterion]: parseInt(e.target.value) }))}
                        className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
                      />
                      <div className="flex justify-between text-xs text-gray-400 mt-1"><span>0</span><span>5</span></div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Feedback */}
              <div>
                <h3 className="text-sm font-bold text-gray-900 uppercase tracking-wider mb-2">Internal Feedback</h3>
                <p className="text-xs text-gray-500 mb-2">Notes for other reviewers. Not visible to applicant.</p>
                <textarea
                  rows={4} value={feedback}
                  onChange={(e) => setFeedback(e.target.value)}
                  className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm border p-2"
                  placeholder="Strengths, weaknesses, areas to probe in interview..."
                />
              </div>

              {/* Rejection Rationale */}
              <div>
                <h3 className="text-sm font-bold text-gray-900 uppercase tracking-wider mb-2">
                  Rejection Rationale <span className="text-xs font-normal text-gray-500 normal-case">(Optional)</span>
                </h3>
                <textarea
                  rows={3} value={rejectionRationale}
                  onChange={(e) => setRejectionRationale(e.target.value)}
                  className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm border p-2"
                  placeholder="If we reject this candidate, what feedback should we provide?"
                />
              </div>

              {/* Overall Recommendation */}
              <div className="pt-4 border-t border-gray-200">
                <h3 className="text-sm font-bold text-gray-900 uppercase tracking-wider mb-3">Overall Recommendation</h3>
                <div className="space-y-2">
                  {RECOMMENDATIONS.map((rec) => (
                    <label key={rec} className={`flex items-center p-3 border rounded-lg cursor-pointer transition-colors ${overallRecommendation === rec ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:bg-gray-50'}`}>
                      <input
                        type="radio" name="recommendation" value={rec}
                        checked={overallRecommendation === rec}
                        onChange={() => setOverallRecommendation(rec)}
                        className="h-4 w-4 text-blue-600 border-gray-300 focus:ring-blue-500"
                      />
                      <span className="ml-3 text-sm font-medium text-gray-900">{rec}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Save */}
              <div className="pt-4">
                <button
                  onClick={handleSave}
                  disabled={isSaving || !overallRecommendation}
                  className="w-full flex justify-center items-center px-4 py-3 border border-transparent text-sm font-medium rounded-lg text-white bg-blue-600 hover:bg-blue-700 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isSaving ? 'Saving...' : <><Save className="w-4 h-4 mr-2" />Save Review</>}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Floating rubric toggle */}
      <div className="fixed bottom-8 right-8 flex flex-col gap-4 z-50">
        <button
          onClick={() => setShowRubric(!showRubric)}
          className={`w-14 h-14 rounded-full flex items-center justify-center shadow-lg transition-all ${showRubric ? 'bg-blue-600 text-white' : 'bg-white text-blue-600 hover:bg-blue-50 border border-gray-200'}`}
          title="Scoring Guide"
        >
          {showRubric ? <X className="w-6 h-6" /> : <HelpCircle className="w-6 h-6" />}
        </button>
      </div>

      {showRubric && (
        <div className="fixed bottom-24 right-8 w-80 bg-white rounded-xl shadow-2xl border border-gray-200 overflow-hidden z-50">
          <div className="bg-blue-600 px-4 py-3 flex justify-between items-center">
            <h3 className="font-bold text-white flex items-center"><HelpCircle className="w-4 h-4 mr-2" />Scoring Guide</h3>
          </div>
          <ul className="divide-y divide-gray-100 max-h-[50vh] overflow-y-auto">
            {['Communication', 'Culture Fit', 'Technical Skills', 'Design Sense'].map((c) => (
              <li key={c} className="p-4 hover:bg-gray-50">
                <div className="flex justify-between items-start mb-1">
                  <h4 className="font-bold text-gray-900">{c}</h4>
                  <span className="text-xs font-bold text-blue-600 bg-blue-50 px-2 py-1 rounded">Max: 5</span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
