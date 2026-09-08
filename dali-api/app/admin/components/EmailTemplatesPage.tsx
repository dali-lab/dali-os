// Admin → Email Templates: the shared template library. Templates serve
// every area (hiring decisions, education, partners) — bindings stay in each
// area's own UI (e.g. hiring's Setup tab → Notification Emails). Sending
// accounts live one pill over in Email Senders.

import { useState } from 'react'
import { Link, Form, useLoaderData } from 'react-router'
import { Plus, Mail, ChevronRight } from 'lucide-react'
import { Button } from '~/components/ui/Button'
import { Modal, ModalHeader } from '~/components/Modal'
import type { loader } from '~/admin/routes/admin.email-templates'
import { useOsChrome } from '~/components/os-chrome'
import { cn } from '~/lib/cn'

export function EmailTemplatesPage() {
  const { templates, isAdmin } = useLoaderData<typeof loader>()
  const [showModal, setShowModal] = useState(false)
  const [newName, setNewName] = useState('')
  const { pageTitle, card } = useOsChrome()

  return (
    <div className="space-y-8">
      <div className="flex justify-between items-center">
        <h1 className={pageTitle}>Email Templates</h1>
        <button type="button" className="os-add-btn" onClick={() => setShowModal(true)}>
            <Plus className="h-[17px] w-[17px]" strokeWidth={3} aria-hidden />
            New Template
          </button>
      </div>

      <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-6">
        {templates.map((template) => {
          const latest = template.versions[0]
          return (
            <Link
              key={template.id}
              to={`/admin/email-templates/${template.id}`}
              className={cn(
                'group block p-6',
                'rounded-os-card bg-os-card transition-colors hover:bg-os-card-hover',
              )}
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3 min-w-0">
                  <div
                    className={cn(
                      'p-2 shrink-0',
                      'rounded-os-item bg-os-container text-os-accent',
                    )}
                  >
                    <Mail className="w-6 h-6" />
                  </div>
                  <div className="min-w-0">
                    <h3
                      className={cn(
                        'font-bold text-foreground transition-colors truncate',
                        'group-hover:text-os-accent',
                      )}
                    >
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
                <ChevronRight
                  className={cn(
                    'w-5 h-5 text-muted-foreground/70 shrink-0',
                    'group-hover:text-os-accent',
                  )}
                />
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

      <Modal
        open={showModal}
        onClose={() => setShowModal(false)}
        labelledBy="new-email-template-title"
      >
        <div className="space-y-4">
          <ModalHeader
            titleId="new-email-template-title"
            title="New Email Template"
            onClose={() => setShowModal(false)}
            className="mb-0"
          />
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
  )
}
