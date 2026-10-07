import { useRef, useState } from "react";
import { Form, Link, redirect, useActionData, useLoaderData, useSubmit } from "react-router";
import { MultiSelect, Select } from "~/components/ui/floating";
import { Button } from "~/components/ui/Button";
import { Settings as SettingsIcon } from "lucide-react";
import type { Route } from "./+types/core.partners.settings";
import { requireAuth } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { prisma } from "~/lib/db";
import { isCore, getActiveCoreCycleTermIds } from "~/lib/roles";
import { coreHandle } from "~/core/coreNav";
import { EditableSection } from "~/components/EditableSection";
import { PartnerCrmNav } from "../components/PartnerCrmNav";
import { listSelectableForms } from "~/projects/lib/form-slots";
import {
  clearApplicationFormBinding,
  getApplicationFormBinding,
  setApplicationFormBinding,
} from "../lib/application-form.server";
import {
  clearSurveyFormBinding,
  getSurveyFormBinding,
  setSurveyFormBinding,
} from "../lib/partner-survey.server";
import { useConfirmSubmit } from "~/components/ui/dialog";

export const handle = { ...coreHandle("partners"), areaSubnav: true };

export const meta: Route.MetaFunction = () => [{ title: "Partner CRM settings · DALI OS" }];

const DEFAULT_STALE_DAYS = 14;

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  if (auth.user.type === "applicant") return redirect("/portal");
  if (!(await isCore(auth.user.sub))) return redirect("/");

  const [settings, cycleTermIds, applicationFormBinding, surveyFormBinding, selectableForms] =
    await Promise.all([
    prisma.partnerCrmSettings.findUnique({
      where: { id: "default" },
      select: { interviewPanelUserIds: true, staleDays: true },
    }),
    getActiveCoreCycleTermIds(request),
    getApplicationFormBinding(),
    getSurveyFormBinding(),
    listSelectableForms(),
  ]);

  const coreMembers =
    cycleTermIds.length > 0
      ? await prisma.coreAssignment.findMany({
          where: { termId: { in: cycleTermIds } },
          select: {
            userId: true,
            user: { select: { firstName: true, lastName: true, daliEmail: true } },
          },
          distinct: ["userId"],
        })
      : [];

  return {
    settings: {
      interviewPanelUserIds: settings?.interviewPanelUserIds ?? [],
      staleDays: settings?.staleDays ?? DEFAULT_STALE_DAYS,
    },
    coreMembers: coreMembers
      .map((a) => ({
        userId: a.userId,
        name:
          [a.user.firstName, a.user.lastName].filter(Boolean).join(" ") ||
          a.user.daliEmail ||
          a.userId,
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    applicationFormBinding,
    surveyFormBinding,
    selectableForms,
  };
}

export async function action({ request }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  if (!(await isCore(auth.user.sub))) {
    return { error: "You don't have permission to edit these settings." };
  }

  const form = await request.formData();
  const intent = form.get("intent") as string;

  if (intent === "settings-save") {
    const interviewPanelUserIds = form.getAll("interviewPanelUserIds") as string[];
    const staleDaysRaw = Number(form.get("staleDays"));
    const staleDays = Number.isFinite(staleDaysRaw) && staleDaysRaw > 0
      ? Math.round(staleDaysRaw)
      : DEFAULT_STALE_DAYS;

    await prisma.partnerCrmSettings.upsert({
      where: { id: "default" },
      create: { id: "default", interviewPanelUserIds, staleDays },
      update: { interviewPanelUserIds, staleDays },
    });
    return { ok: true };
  }

  if (intent === "bind-form") {
    const formId = (form.get("formId") as string | null) ?? "";
    if (!formId) return { error: "Choose a form to bind." };
    const result = await setApplicationFormBinding(formId, auth.user.sub);
    return result.ok ? { ok: true } : { error: result.error };
  }
  if (intent === "clear-form") {
    await clearApplicationFormBinding();
    return { ok: true };
  }

  if (intent === "bind-survey-form") {
    const formId = (form.get("formId") as string | null) ?? "";
    if (!formId) return { error: "Choose a form to bind." };
    const result = await setSurveyFormBinding(formId, auth.user.sub);
    return result.ok ? { ok: true } : { error: result.error };
  }
  if (intent === "clear-survey-form") {
    await clearSurveyFormBinding();
    return { ok: true };
  }

  return { error: "Unknown action." };
}

type LoaderData = Exclude<Awaited<ReturnType<typeof loader>>, Response>;

// Owns the interview-panel selection locally so EditableSection's Cancel
// (which remounts this body via a bumped key) actually reverts a pending
// MultiSelect change — state living in the parent route component would
// survive that remount instead of resetting.
function SettingsFields({
  settings,
  coreMembers,
  editing,
}: {
  settings: LoaderData["settings"];
  coreMembers: LoaderData["coreMembers"];
  editing: boolean;
}) {
  const [panelIds, setPanelIds] = useState<string[]>(settings.interviewPanelUserIds);

  return (
    <div className="flex flex-col gap-4">
      <input type="hidden" name="intent" value="settings-save" />
      {panelIds.map((id) => (
        <input key={id} type="hidden" name="interviewPanelUserIds" value={id} />
      ))}
      <div>
        <div className="text-xs font-medium text-muted-foreground mb-1">Interview panel</div>
        {editing ? (
          <MultiSelect
            values={panelIds}
            onChange={setPanelIds}
            options={coreMembers.map((m) => ({ value: m.userId, label: m.name }))}
            placeholder="Everyone (no one selected)"
            ariaLabel="Interview panel"
          />
        ) : (
          <div className="text-sm text-foreground">
            {panelIds.length === 0
              ? "Everyone (no panel set)"
              : coreMembers
                  .filter((m) => panelIds.includes(m.userId))
                  .map((m) => m.name)
                  .join(", ")}
          </div>
        )}
      </div>
      <div>
        <div className="text-xs font-medium text-muted-foreground mb-1">
          Stale threshold (days)
        </div>
        {editing ? (
          <input
            name="staleDays"
            type="number"
            min={1}
            defaultValue={settings.staleDays}
            className="w-32 rounded-lg border border-border bg-background px-3 py-2 text-sm"
          />
        ) : (
          <div className="text-sm text-foreground">{settings.staleDays} days</div>
        )}
      </div>
    </div>
  );
}

export default function PartnerCrmSettingsPage() {
  const { settings, coreMembers, applicationFormBinding, surveyFormBinding, selectableForms } =
    useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();
  const formRef = useRef<HTMLFormElement>(null);
  const confirmSubmit = useConfirmSubmit();

  const error = actionData && "error" in actionData ? actionData.error : null;

  return (
    <div className="flex flex-col gap-6 max-w-2xl">
      <PartnerCrmNav />
      <header>
        <h1 className="font-heading text-foreground text-4xl font-medium">Settings</h1>
      </header>

      {error && (
        <p className="text-sm text-destructive bg-destructive/10 rounded-lg px-4 py-3">{error}</p>
      )}

      <Form method="post" ref={formRef}>
        <EditableSection
          title="Interview scheduling"
          icon={<SettingsIcon className="w-4 h-4" />}
          description="Who the free/busy scheduler checks when a partner requests an interview."
          canEdit
          onSave={() => {
            if (formRef.current) submit(formRef.current);
          }}
        >
          {({ editing }) => (
            <SettingsFields settings={settings} coreMembers={coreMembers} editing={editing} />
          )}
        </EditableSection>
      </Form>

      <section className="bg-card border border-border rounded-lg p-4 flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-foreground">Application form</h2>
        <p className="text-sm text-muted-foreground">
          Extra questions partners answer when pitching a project at <code>/partner/apply</code>.
          {applicationFormBinding && (
            <>
              {" "}
              <Link
                to={`/forms/edit/${applicationFormBinding.formId}`}
                className="text-dark-blue hover:underline"
              >
                Edit “{applicationFormBinding.formName}” in Forms
              </Link>
            </>
          )}
        </p>
        <div className="flex items-center gap-2 flex-wrap">
          <Form method="post" className="flex items-center gap-2">
            <input type="hidden" name="intent" value="bind-form" />
            <Select
              name="formId"
              defaultValue={applicationFormBinding?.formId ?? ""}
              placeholder="Choose a form…"
              options={selectableForms.map((f) => ({
                value: f.id,
                label: `${f.name}${f.published ? "" : " (unpublished)"}`,
              }))}
              buttonClassName="px-2 py-1.5 text-sm border border-border rounded-md bg-background text-foreground inline-flex items-center justify-between gap-1 transition-colors hover:bg-muted/40"
            />
            <Button type="submit" variant="secondary" size="sm">
              {applicationFormBinding ? "Change" : "Bind"}
            </Button>
          </Form>
          {applicationFormBinding && (
            <Form
              method="post"
              onSubmit={confirmSubmit({
                title: "Remove the bound application form?",
                description:
                  "New partner applicants will have no form to fill in until another is bound. Responses already submitted are kept.",
                confirmLabel: "Remove",
                tone: "destructive",
              })}
            >
              <input type="hidden" name="intent" value="clear-form" />
              <Button type="submit" variant="secondary" size="sm">
                Remove
              </Button>
            </Form>
          )}
        </div>
        {applicationFormBinding && (!applicationFormBinding.published || !applicationFormBinding.hasVersion) && (
          <p className="text-xs text-os-amber">
            {applicationFormBinding.hasVersion
              ? "This form isn't published yet."
              : "This form has no saved version yet."}
            {" "}Partners currently see only the built-in pitch fields.
          </p>
        )}
      </section>

      <section className="bg-card border border-border rounded-lg p-4 flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-foreground">Post-project survey</h2>
        <p className="text-sm text-muted-foreground">
          The form a partner fills out at <code>/partner/survey</code> once their project ends.
          {surveyFormBinding && (
            <>
              {" "}
              <Link
                to={`/forms/edit/${surveyFormBinding.formId}`}
                className="text-dark-blue hover:underline"
              >
                Edit “{surveyFormBinding.formName}” in Forms
              </Link>
            </>
          )}
        </p>
        <div className="flex items-center gap-2 flex-wrap">
          <Form method="post" className="flex items-center gap-2">
            <input type="hidden" name="intent" value="bind-survey-form" />
            <Select
              name="formId"
              defaultValue={surveyFormBinding?.formId ?? ""}
              placeholder="Choose a form…"
              options={selectableForms.map((f) => ({
                value: f.id,
                label: `${f.name}${f.published ? "" : " (unpublished)"}`,
              }))}
              buttonClassName="px-2 py-1.5 text-sm border border-border rounded-md bg-background text-foreground inline-flex items-center justify-between gap-1 transition-colors hover:bg-muted/40"
            />
            <Button type="submit" variant="secondary" size="sm">
              {surveyFormBinding ? "Change" : "Bind"}
            </Button>
          </Form>
          {surveyFormBinding && (
            <Form
              method="post"
              onSubmit={confirmSubmit({
                title: "Remove the bound survey form?",
                description:
                  "Partners whose project ends will have no survey to fill in until another is bound. Responses already submitted are kept.",
                confirmLabel: "Remove",
                tone: "destructive",
              })}
            >
              <input type="hidden" name="intent" value="clear-survey-form" />
              <Button type="submit" variant="secondary" size="sm">
                Remove
              </Button>
            </Form>
          )}
        </div>
        {surveyFormBinding && (!surveyFormBinding.published || !surveyFormBinding.hasVersion) && (
          <p className="text-xs text-os-amber">
            {surveyFormBinding.hasVersion
              ? "This form isn't published yet."
              : "This form has no saved version yet."}
            {" "}Partners won't see a survey until it is.
          </p>
        )}
      </section>

      <section className="bg-card border border-border rounded-lg p-4 flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-foreground">Email templates</h2>
        <p className="text-sm text-muted-foreground">
          Partner lifecycle emails are edited in{" "}
          <Link to="/core/communications/email" className="text-dark-blue hover:underline">
            Core → Communications → Email
          </Link>
          .
        </p>
      </section>
    </div>
  );
}
