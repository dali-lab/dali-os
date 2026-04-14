import { redirect } from 'react-router'
import { useState, useEffect, useRef } from 'react'
import { Link, useLoaderData, useSubmit, Form } from 'react-router'
import { ArrowLeft, ListOrdered, FileText, Clock, UserIcon, Plus } from 'lucide-react'
import { prisma } from '~/lib/db'
import { requireAuth } from '~/lib/auth'
import type { Route } from './+types/admin.forms.$id'
import { FormBuilderTab } from '~/components/ChallengeBuilder'
import type { Question } from '~/types'

export async function loader({ request, params }: Route.LoaderArgs) {
  const auth = await requireAuth(request)
  if (!auth.ok) return redirect('/login')

  const [form, rubrics] = await Promise.all([
    prisma.applicationForm.findUniqueOrThrow({
      where: { id: params.id },
      include: {
        versions: {
          include: {
            createdBy: true,
            rubricVersions: { include: { rubric: true } },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    }),
    // General rubrics only (no domainId)
    prisma.rubric.findMany({
      where: { domainId: null },
      include: {
        versions: { orderBy: { versionNumber: 'desc' }, take: 1 },
      },
      orderBy: { createdAt: 'desc' },
    }),
  ])

  return { form, rubrics }
}

export async function action({ request, params }: Route.ActionArgs) {
  const auth = await requireAuth(request)
  if (!auth.ok) return redirect('/login')

  const user = await prisma.user.findUnique({ where: { id: auth.user.sub } })
  if (!user) return redirect('/login')

  const formData = await request.formData()
  const intent = formData.get('intent') as string

  if (intent === 'create-version') {
    const questionsJson = formData.get('questions') as string
    const questions = JSON.parse(questionsJson || '[]')

    await prisma.applicationFormVersion.create({
      data: {
        applicationFormId: params.id,
        questions,
        createdById: user.id,
      },
    })

    return redirect(`/admin/forms/${params.id}`)
  }

  if (intent === 'attach-rubric') {
    const formVersionId = formData.get('formVersionId') as string
    const rubricVersionId = (formData.get('rubricVersionId') as string) || null

    if (rubricVersionId) {
      await prisma.rubricVersion.update({
        where: { id: rubricVersionId },
        data: { applicationFormVersionId: formVersionId },
      })
    } else {
      // Detach: clear any rubric versions pointing to this form version
      await prisma.rubricVersion.updateMany({
        where: { applicationFormVersionId: formVersionId },
        data: { applicationFormVersionId: null },
      })
    }

    return null
  }

  return null
}

function formatDateTime(iso: string | Date) {
  const d = new Date(iso)
  return (
    d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) +
    ' at ' +
    d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  )
}

export default function ApplicationFormDetail() {
  const { form, rubrics } = useLoaderData<typeof loader>()
  const submit = useSubmit()

  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(
    form.versions.length ? form.versions[form.versions.length - 1].id : null
  )
  const [isCreatingVersion, setIsCreatingVersion] = useState(false)

  const prevVersionCount = useRef(form.versions.length)
  useEffect(() => {
    if (form.versions.length > prevVersionCount.current) {
      const newest = form.versions[form.versions.length - 1]
      setSelectedVersionId(newest.id)
      setIsCreatingVersion(false)
    }
    prevVersionCount.current = form.versions.length
  }, [form.versions.length])

  const selectedVersion = form.versions.find((v) => v.id === selectedVersionId)
  const nextVersionNumber = form.versions.length + 1

  const handleSaveNewVersion = (questions: Question[]) => {
    const formData = new FormData()
    formData.set('intent', 'create-version')
    formData.set('questions', JSON.stringify(questions))
    submit(formData, { method: 'post' })
  }

  // Find the rubric version currently attached to the selected form version
  const attachedRubricVersionId = selectedVersion?.rubricVersions?.[0]?.id ?? ''

  return (
    <div className="space-y-6">
      <div>
        <Link
          to="/admin"
          className="inline-flex items-center text-sm text-gray-500 hover:text-gray-700 mb-4"
        >
          <ArrowLeft className="w-4 h-4 mr-1" /> Back to Admin
        </Link>
        <div className="flex justify-between items-start">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">General Application Form</h1>
            <p className="mt-1 text-gray-500">{form.versions.length} version(s)</p>
          </div>
          {!isCreatingVersion && (
            <button
              onClick={() => setIsCreatingVersion(true)}
              className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-lg text-white bg-blue-600 hover:bg-blue-700 shadow-sm"
            >
              <Plus className="w-4 h-4 mr-2" />
              New Version
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-8">
        {/* Sidebar: version list */}
        <div className="w-full lg:w-64 flex-shrink-0 space-y-4">
          <h3 className="text-sm font-bold text-gray-900 uppercase tracking-wider">Versions</h3>
          {form.versions.length === 0 ? (
            <p className="text-sm text-gray-500">No versions yet.</p>
          ) : (
            <div className="space-y-2">
              {[...form.versions].reverse().map((version, i) => {
                const versionNumber = form.versions.length - i
                return (
                  <button
                    key={version.id}
                    onClick={() => {
                      setSelectedVersionId(version.id)
                      setIsCreatingVersion(false)
                    }}
                    className={`w-full text-left p-4 rounded-xl border transition-colors ${
                      selectedVersionId === version.id && !isCreatingVersion
                        ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-500'
                        : 'border-gray-200 bg-white hover:bg-gray-50'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-medium text-gray-900">v{versionNumber}</span>
                    </div>
                    <p className="text-sm text-gray-500">
                      {(version.questions as unknown as Question[]).length} questions
                    </p>
                    <div className="flex items-center text-xs text-gray-400 mt-1">
                      <Clock className="w-3 h-3 mr-1" />
                      {formatDateTime(version.createdAt)}
                    </div>
                    <div className="flex items-center text-xs text-gray-400 mt-0.5">
                      <UserIcon className="w-3 h-3 mr-1" />
                      {version.createdBy.firstName} {version.createdBy.lastName}
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* Main content */}
        <div className="flex-1">
          {isCreatingVersion ? (
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
              <div className="mb-6 pb-6 border-b border-gray-200">
                <h2 className="text-lg font-bold text-gray-900">Create New Version</h2>
                <p className="text-sm text-gray-500 mt-1">
                  Will be saved as v{nextVersionNumber}.
                </p>
              </div>
              <FormBuilderTab
                initialQuestions={(selectedVersion?.questions as unknown as Question[]) || []}
                onSave={handleSaveNewVersion}
                onCancel={() => setIsCreatingVersion(false)}
              />
            </div>
          ) : selectedVersion ? (
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
              <div className="px-6 py-5 border-b border-gray-200 bg-gray-50 flex justify-between items-center">
                <div>
                  <h2 className="text-lg font-semibold text-gray-900">
                    Version {form.versions.findIndex((v) => v.id === selectedVersionId) + 1} Preview
                  </h2>
                  <p className="text-sm text-gray-500 mt-1">
                    Created by {selectedVersion.createdBy.firstName}{' '}
                    {selectedVersion.createdBy.lastName} on {formatDateTime(selectedVersion.createdAt)}
                  </p>
                </div>
                <button
                  onClick={() => setIsCreatingVersion(true)}
                  className="text-sm text-blue-600 hover:text-blue-700 font-medium"
                >
                  Duplicate to New Version
                </button>
              </div>

              {/* Rubric attachment */}
              <div className="px-6 py-4 border-b border-gray-200 flex items-center gap-4">
                <ListOrdered className="w-4 h-4 text-gray-400 flex-shrink-0" />
                <span className="text-sm font-medium text-gray-700 w-24 flex-shrink-0">Rubric</span>
                <Form method="post" className="flex items-center gap-2 flex-1">
                  <input type="hidden" name="intent" value="attach-rubric" />
                  <input type="hidden" name="formVersionId" value={selectedVersion.id} />
                  <select
                    name="rubricVersionId"
                    defaultValue={attachedRubricVersionId}
                    className="flex-1 px-3 py-1.5 text-sm text-gray-900 border border-gray-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">No rubric attached</option>
                    {rubrics.map((r) => {
                      const latestVersion = r.versions[0]
                      return latestVersion ? (
                        <option key={latestVersion.id} value={latestVersion.id}>
                          {r.name} — v{latestVersion.versionNumber}
                        </option>
                      ) : null
                    })}
                  </select>
                  <button
                    type="submit"
                    className="px-3 py-1.5 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700"
                  >
                    Save
                  </button>
                </Form>
              </div>

              {/* Questions preview */}
              <div className="p-6 space-y-4">
                {(selectedVersion.questions as unknown as Question[]).map((q, index) => (
                  <div
                    key={q.key}
                    className="flex items-start gap-4 p-4 rounded-xl border border-gray-200 bg-white"
                  >
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-1">
                        <span className="text-sm font-medium text-gray-500">Q{index + 1}</span>
                        <h4 className="text-base font-medium text-gray-900">{q.data.label}</h4>
                        {q.required && (
                          <span className="text-xs font-medium text-red-600 bg-red-50 px-2 py-0.5 rounded-full">
                            Required
                          </span>
                        )}
                        <span className="text-xs font-medium text-gray-600 bg-gray-100 px-2 py-0.5 rounded-full capitalize">
                          {q.type}
                        </span>
                      </div>
                      {q.data.description && (
                        <p className="text-sm text-gray-500">{q.data.description}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="text-center py-12 bg-white rounded-xl border border-gray-200 border-dashed">
              <FileText className="mx-auto h-12 w-12 text-gray-400" />
              <h3 className="mt-2 text-sm font-medium text-gray-900">No versions</h3>
              <p className="mt-1 text-sm text-gray-500">Create the first version of this form.</p>
              <div className="mt-6">
                <button
                  onClick={() => setIsCreatingVersion(true)}
                  className="inline-flex items-center px-4 py-2 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700"
                >
                  <Plus className="w-4 h-4 mr-2" />
                  Create Version
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
