import { useEffect, useState } from 'react'
import { Link, Form, useLoaderData, useSearchParams } from 'react-router'
import { Plus, Mail, ChevronRight, X } from 'lucide-react'
import type { loader } from '~/routes/email-templates'

const GMAIL_ERROR_MESSAGES: Record<string, string> = {
  auth_failed: 'Gmail authorization was denied or failed.',
  state_mismatch: 'OAuth state mismatch — please try again.',
  token_exchange_failed: 'Failed to exchange token with Google. Check OAuth credentials.',
  no_refresh_token: 'Google did not return a refresh token. You may need to revoke access and try again.',
}

export default function EmailTemplatesList() {
  const { templates, gmailConnected } = useLoaderData<typeof loader>()
  const [showModal, setShowModal] = useState(false)
  const [newName, setNewName] = useState('')
  const [searchParams, setSearchParams] = useSearchParams()

  const gmailAuthorized = searchParams.get('gmail_authorized') === '1'
  const gmailError = searchParams.get('gmail_error')
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    setDismissed(false)
  }, [gmailAuthorized, gmailError])

  function dismissBanner() {
    setDismissed(true)
    setSearchParams((prev) => {
      prev.delete('gmail_authorized')
      prev.delete('gmail_error')
      return prev
    }, { replace: true })
  }

  return (
    <div className="space-y-8">
      {!dismissed && gmailAuthorized && (
        <div className="flex items-center justify-between bg-green-50 border border-green-200 text-green-800 text-sm rounded-lg px-4 py-3">
          <span>Gmail authorized successfully. Decision emails are now active.</span>
          <button onClick={dismissBanner} className="text-green-600 hover:text-green-800"><X className="w-4 h-4" /></button>
        </div>
      )}
      {!dismissed && gmailError && (
        <div className="flex items-center justify-between bg-red-50 border border-red-200 text-red-800 text-sm rounded-lg px-4 py-3">
          <span>{GMAIL_ERROR_MESSAGES[gmailError] ?? 'Gmail authorization failed.'}</span>
          <button onClick={dismissBanner} className="text-red-600 hover:text-red-800"><X className="w-4 h-4" /></button>
        </div>
      )}

      <div className="flex items-center justify-between bg-card border border-border rounded-lg px-4 py-3">
        <div className="flex items-center gap-3">
          <Mail className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm text-foreground/80">
            Gmail sending ({gmailConnected ? (
              <span className="text-green-600 font-medium">connected</span>
            ) : (
              <span className="text-amber-600 font-medium">not connected</span>
            )})
          </span>
        </div>
        <a
          href="/admin/authorize-gmail"
          className="text-sm font-medium text-blue-600 hover:text-blue-700"
        >
          {gmailConnected ? 'Reconnect' : 'Connect Gmail'}
        </a>
      </div>

      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Email Templates</h1>
          <p className="mt-1 text-muted-foreground">
            Manage email templates and their versions independently of hiring cycles. Bind a template
            to a decision type from the cycle admin page.
          </p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="inline-flex items-center justify-center px-4 py-2 border border-transparent text-sm font-medium rounded-lg text-white bg-blue-600 hover:bg-blue-700 shadow-sm"
        >
          <Plus className="w-4 h-4 mr-2" />
          New Template
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {templates.map((template) => {
          const latest = template.versions[0]
          return (
            <Link
              key={template.id}
              to={`/emails/${template.id}`}
              className="bg-card rounded-xl border border-border p-6 shadow-sm hover:shadow-md transition-shadow group block"
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="p-2 bg-blue-100 text-blue-600 rounded-lg shrink-0">
                    <Mail className="w-6 h-6" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="font-bold text-foreground group-hover:text-blue-600 transition-colors truncate">
                      {template.name}
                    </h3>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-xs text-muted-foreground">
                        {template.versions.length} version{template.versions.length !== 1 ? 's' : ''}
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
              {latest && (
                <p className="mt-3 text-sm text-muted-foreground line-clamp-2">
                  {latest.subject}
                </p>
              )}
            </Link>
          )
        })}
        {templates.length === 0 && (
          <p className="text-muted-foreground col-span-3 text-sm italic">No templates yet.</p>
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
              <h2 className="text-lg font-semibold text-foreground">New Email Template</h2>
              <button
                onClick={() => setShowModal(false)}
                className="text-muted-foreground/70 hover:text-muted-foreground"
                aria-label="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <Form method="post" onSubmit={() => setShowModal(false)} className="space-y-4">
              <input type="hidden" name="intent" value="create" />
              <div>
                <label className="block text-sm font-medium text-foreground/80 mb-1">
                  Template name
                </label>
                <input
                  type="text"
                  name="name"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="e.g. Rejection — Standard"
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
  )
}
