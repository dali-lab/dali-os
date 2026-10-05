import { FileText, Users, ArrowUpRight } from "lucide-react";
import { PartnerFavicon } from "./PartnerFavicon";
import {
  SlideOver,
  SheetField,
  SheetDivider,
  SheetPrimaryLink,
  SheetSecondaryLink,
} from "./SlideOver";

export type DrawerApplication = {
  id: string;
  title: string;
  status: string;
  partnerName: string;
  faviconChar: string | null;
  summary: string | null;
  source: string | null;
  decisionReason: string | null;
  interviewRating: number | null;
  ambiguityRating: number | null;
  fundingModel: string | null;
  formSubmissionId: string | null;
  updatedAt: string;
  contactName: string | null;
  contactEmail: string | null;
  partnerOrgId: string | null;
  targetTermCodes: string[];
  domainNames: string[];
};

/**
 * Slide-over summary for a pipeline card. The hub shows summary + contact +
 * links; the application detail route (/partners/applications/:id) owns full
 * edits, SOW authoring and the activity timeline — one authoring surface, two
 * entry points.
 */
export function ProjectDrawer({
  application,
  onClose,
}: {
  application: DrawerApplication | null;
  onClose: () => void;
}) {
  return (
    <SlideOver
      open={!!application}
      onClose={onClose}
      accent="coral"
      overline="Pipeline card"
      title={application?.partnerName ?? ""}
      subtitle={application?.title ?? undefined}
      footer={
        application && (
          <div className="flex items-center justify-end gap-2">
            {application.partnerOrgId && (
              <SheetSecondaryLink to={`/partners/${application.partnerOrgId}`}>
                <Users className="h-3.5 w-3.5" aria-hidden />
                Organization
              </SheetSecondaryLink>
            )}
            <SheetPrimaryLink to={`/partners/applications/${application.id}`}>
              <FileText className="h-3.5 w-3.5" aria-hidden />
              Open application
              <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
            </SheetPrimaryLink>
          </div>
        )
      }
    >
      {application && (
        <div className="space-y-5 pt-2">
          <div className="flex items-center gap-3">
            <PartnerFavicon
              char={application.faviconChar}
              name={application.partnerName}
              size="md"
            />
            <div className="min-w-0">
              <div
                className="text-[13px] font-medium truncate"
                style={{ color: "#F5F7FA" }}
              >
                {application.partnerName}
              </div>
              <div
                className="text-xs truncate"
                style={{ color: "rgba(245,247,250,0.55)" }}
              >
                {application.title}
              </div>
            </div>
          </div>

          <SheetDivider />

          <SheetField label="Status">{application.status}</SheetField>

          {application.summary && (
            <SheetField label="Summary">
              <p className="whitespace-pre-wrap leading-relaxed">
                {application.summary}
              </p>
            </SheetField>
          )}

          {(application.contactName || application.contactEmail) && (
            <SheetField label="Point of contact">
              <div>{application.contactName ?? application.contactEmail}</div>
              {application.contactEmail && application.contactName && (
                <div
                  className="text-xs mt-0.5"
                  style={{ color: "rgba(245,247,250,0.55)" }}
                >
                  {application.contactEmail}
                </div>
              )}
            </SheetField>
          )}

          {application.targetTermCodes.length > 0 && (
            <SheetField label="Target terms">
              <div className="flex flex-wrap gap-1.5">
                {application.targetTermCodes.map((code) => (
                  <span
                    key={code}
                    className="rounded-full px-2 py-0.5 text-[11px]"
                    style={{ background: "rgba(255,255,255,0.08)" }}
                  >
                    {code}
                  </span>
                ))}
              </div>
            </SheetField>
          )}

          {application.domainNames.length > 0 && (
            <SheetField label="Domains">
              <div className="flex flex-wrap gap-1.5">
                {application.domainNames.map((name) => (
                  <span
                    key={name}
                    className="rounded-full px-2 py-0.5 text-[11px]"
                    style={{ background: "rgba(255,255,255,0.08)" }}
                  >
                    {name}
                  </span>
                ))}
              </div>
            </SheetField>
          )}

          {application.source && (
            <SheetField label="Source">{application.source}</SheetField>
          )}
          {application.fundingModel && (
            <SheetField label="Funding">{application.fundingModel}</SheetField>
          )}
          {application.interviewRating != null && (
            <SheetField label="Interview rating">{application.interviewRating} / 5</SheetField>
          )}
          {application.ambiguityRating != null && (
            <SheetField label="Ambiguity rating">{application.ambiguityRating} / 5</SheetField>
          )}
          {application.decisionReason && (
            <SheetField label="Decision reason">
              <p className="whitespace-pre-wrap leading-relaxed">{application.decisionReason}</p>
            </SheetField>
          )}

          {application.formSubmissionId && (
            <SheetField label="Form submission">
              <a
                className="underline text-[12px]"
                href={`/partners/applications/${application.id}`}
                style={{ color: "#F5F7FA" }}
              >
                View the partner's answers →
              </a>
            </SheetField>
          )}
        </div>
      )}
    </SlideOver>
  );
}
