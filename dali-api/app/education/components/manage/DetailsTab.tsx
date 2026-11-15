import { useConfirmSubmit } from "~/components/ui/dialog";
import { ManageSection, WELL_ROW_CLASS } from "./manage-ui";
import { DecisionEmailRow } from "./DecisionEmailRow";
import { Form, Link } from "react-router";
import { Select } from "~/components/ui/floating";
import { InstructorPicker } from "~/education/components/InstructorPicker";
import { DECISION_EMAIL_SLOTS, decisionSlot } from "~/education/lib/education-emails";
import { Button, buttonClasses } from "~/components/ui/Button";
import { Avatar } from "~/components/ui/Avatar";
import { X } from "lucide-react";
import { OfferingFields } from "~/education/components/OfferingFields";
import { DocEditor } from "~/components/doc";
import { PresenceProvider } from "~/components/collab/PresenceProvider";
import { cn } from "~/lib/cn";
import { InfoTip } from "~/components/ui/floating";

import type { ManageOfferingLoaderData } from "~/education/routes/education.manage.$offeringId";

export function DetailsTab({ data }: { data: ManageOfferingLoaderData }) {
  const {
    certificateBinding,
    certificateTemplates,
    collabToken,
    educationEmails,
    externalInstructors,
    feedbackBindings,
    instructorCandidates,
    memberInstructorIds,
    offering,
    publishedForms,
    userName,
    isCore: core,
  } = data;
  const confirmSubmit = useConfirmSubmit();
  return (
        <div className="flex flex-col gap-6">
          {offering.applicationFormId && (
            <ManageSection
              title="Application form"
              description="What applicants answer. Fillers always see the latest saved version."
              action={
                <Link
                  to={`/forms/edit/${offering.applicationFormId}`}
                  className={cn(buttonClasses("secondary", "sm"), "shrink-0")}
                >
                  Edit form
                </Link>
              }
            >
              <p className="text-sm text-os-grey">
                Lives in Drive under Education, with this course.
              </p>
            </ManageSection>
          )}

          <ManageSection title="Course details">
            <Form method="post" className="os-form flex flex-col gap-4">
              <input type="hidden" name="intent" value="update-offering" />
              <OfferingFields values={offering} typeLocked />
              <div className="flex justify-end">
                <Button type="submit">Save details</Button>
              </div>
            </Form>
          </ManageSection>

          <ManageSection title="Description">
            {collabToken && offering.descriptionDocId ? (
              <PresenceProvider
                pageId={`eduoffering:${offering.id}`}
                token={collabToken}
                userName={userName}
              >
                <DocEditor
                  features="notes"
                  aiEnabled
                  collab={{
                    documentName: offering.descriptionDocId,
                    token: collabToken,
                    userName,
                  }}
                  placeholder="What this offering covers, who it's for, what attendees build…"
                  className="rounded-os-item bg-os-well"
                />
              </PresenceProvider>
            ) : (
              <p className="text-sm italic text-os-grey">
                Sign in again to edit the description.
              </p>
            )}
          </ManageSection>

          {core && (
            <>
              <ManageSection
                title="Instructors"
              >
                <Form method="post" className="os-form">
                  <input type="hidden" name="intent" value="set-instructors" />
                  <InstructorPicker
                    candidates={instructorCandidates}
                    initialSelectedIds={memberInstructorIds}
                  />
                  <div className="mt-4 flex justify-end">
                    <Button type="submit" variant="secondary">
                      Save instructors
                    </Button>
                  </div>
                </Form>
              </ManageSection>

              <ManageSection
                title="External instructors"
              >
                {externalInstructors.length > 0 && (
                  <ul className="mb-4 flex flex-col gap-2">
                    {externalInstructors.map((x) => (
                      <li key={x.userId} className={WELL_ROW_CLASS}>
                        <span className="inline-flex min-w-0 items-center gap-2 text-sm text-foreground">
                          <Avatar name={x.name} size="xs" />
                          <span className="truncate">{x.name}</span>
                          <span className="rounded-full bg-os-container px-2 py-0.5 text-[11px] font-medium text-os-grey">
                            External
                          </span>
                        </span>
                        <Form method="post">
                          <input
                            type="hidden"
                            name="intent"
                            value="remove-external-instructor"
                          />
                          <input type="hidden" name="userId" value={x.userId} />
                          <button
                            type="submit"
                            aria-label={`Remove ${x.name}`}
                            className="os-icon-btn hover:text-destructive"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </Form>
                      </li>
                    ))}
                  </ul>
                )}

                <Form
                  method="post"
                  className="os-form flex flex-col gap-3 sm:flex-row sm:items-center"
                >
                  <input
                    type="hidden"
                    name="intent"
                    value="invite-external-instructor"
                  />
                  <div className="flex flex-1 flex-col gap-3 sm:flex-row">
                    <input
                      type="text"
                      name="firstName"
                      required
                      placeholder="First name"
                      className="w-full"
                    />
                    <input
                      type="text"
                      name="lastName"
                      required
                      placeholder="Last name"
                      className="w-full"
                    />
                    <input
                      type="text"
                      name="netId"
                      required
                      placeholder="NetID"
                      className="w-full sm:max-w-[9rem]"
                    />
                  </div>
                  <Button type="submit" variant="secondary">
                    Invite
                  </Button>
                </Form>
              </ManageSection>
            </>
          )}

          {core && (
            <ManageSection
              title="Decision emails"
            >
              <div className="flex flex-col gap-2">
                {DECISION_EMAIL_SLOTS.map((slot) => (
                  <DecisionEmailRow
                    key={slot.status}
                    slot={slot}
                    email={educationEmails[decisionSlot(slot.status)] ?? null}
                  />
                ))}
                <p className="text-xs text-os-grey">
                  Shared by every course.{" "}
                  <Link to="/core/communications/email" className="underline">
                    Edit in Core &rarr; Communications &rarr; Email
                  </Link>
                  .
                </p>
              </div>
            </ManageSection>
          )}

          <ManageSection
            title="Feedback forms"
          >
            <div className="flex flex-col gap-2">
              {(
                [
                  {
                    slot: "session-feedback",
                    label: "Session feedback",
                    tip: "Sent automatically to everyone marked Present after each session. Results are visible to the instructor and Core members.",
                  },
                  {
                    slot: "instructor-exit",
                    label: "Instructor exit survey",
                    tip: "Sent to instructors when the offering is closed out. Used to capture end-of-course reflections — separate from the per-session feedback students receive.",
                  },
                ] as const
              ).map(({ slot, label, tip }) => (
                <Form
                  key={slot}
                  method="post"
                  className={cn(WELL_ROW_CLASS, "os-form flex-wrap")}
                >
                  <input type="hidden" name="intent" value="set-form-binding" />
                  <input type="hidden" name="slot" value={slot} />
                  <span className="inline-flex w-44 items-center gap-1.5 text-sm font-semibold text-foreground">
                    {label}
                    <InfoTip content={tip} />
                  </span>
                  <Select
                    name="formId"
                    defaultValue={
                      feedbackBindings.find((b) => b.slot === slot)?.formId ?? ""
                    }
                    placeholder="None"
                    options={[
                      { value: "", label: "None" },
                      ...publishedForms.map((f) => ({ value: f.id, label: f.name })),
                    ]}
                    buttonClassName="flex-1"
                  />
                  <Button type="submit" variant="secondary">
                    Save
                  </Button>
                </Form>
              ))}
            </div>
          </ManageSection>

          {core && (
            <ManageSection
              title="Completion certificate"
              description="The design students get when this course is closed out. Leave it on the lab default, or bind a specific template to this offering."
              action={
                <Link
                  to="/education/certificate-templates"
                  className="text-sm font-medium text-os-accent hover:underline"
                >
                  Manage templates
                </Link>
              }
            >
              <Form method="post" className="os-form flex items-center gap-3">
                <input type="hidden" name="intent" value="bind-certificate-template" />
                <Select
                  name="templateId"
                  defaultValue={certificateBinding ?? ""}
                  options={[
                    { value: "", label: "Lab default" },
                    ...certificateTemplates.map((t) => ({
                      value: t.id,
                      label: t.isDefault ? `${t.name} (default)` : t.name,
                    })),
                  ]}
                  buttonClassName="flex-1"
                />
                <Button type="submit" variant="secondary">
                  Save
                </Button>
              </Form>
              {certificateTemplates.length === 0 && (
                <p className="mt-3 text-sm italic text-os-grey">
                  No templates yet.{" "}
                  <Link to="/education/certificate-templates" className="underline">
                    Create one
                  </Link>{" "}
                  to override the built-in design.
                </p>
              )}
            </ManageSection>
          )}

          {core && offering.status === "Draft" && (
            <Form
              method="post"
              onSubmit={confirmSubmit({
                title: "Delete this draft offering?",
                description: "This can't be undone.",
                confirmLabel: "Delete",
                tone: "destructive",
              })}
            >
              <input type="hidden" name="intent" value="delete-offering" />
              <Button type="submit" variant="destructive">
                Delete draft
              </Button>
            </Form>
          )}
        </div>
  );
}
