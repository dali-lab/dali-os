import { useState } from "react";
import { CoverStudio } from "~/components/cover/CoverStudio";
import { buildCoverUrl, parseCover } from "~/components/cover/CoverPattern";
import { Select, type SelectOption } from "~/components/ui/floating";
import { FormField } from "~/components/ui/FormField";
import { HubCard } from "./HubCard";

export const NO_DOMAIN_COPY = "No domain is available. Each domain has one hub, and you can only add one for a domain you lead.";

export const normalizeCover = (cover: string) => {
  const parsed = parseCover(cover);
  return parsed ? buildCoverUrl(parsed.id, parsed.card) : cover;
};

export function HubCoverStudio({
  busy,
  heading,
  submitLabel,
  initialTitle,
  initialCover,
  onClose,
  onSubmit,
  uploadImage,
  domainOptions,
  serverError,
}: {
  busy: boolean;
  heading: string;
  submitLabel: string;
  initialTitle: string;
  initialCover: string | null;
  onClose: () => void;
  onSubmit: (title: string, cover: string, domainId?: string) => void;
  uploadImage?: (file: File) => Promise<string>;
  domainOptions?: SelectOption[];
  serverError?: string | null;
}) {
  const firstFree = domainOptions?.find((o) => !o.disabled)?.value ?? "";
  const [domainId, setDomainId] = useState(firstFree);
  const [title, setTitle] = useState(initialTitle);
  const needsDomain = !!domainOptions && !domainId;

  return (
    <CoverStudio
      busy={busy}
      heading={heading}
      subtitle="Pick a style and name your hub."
      submitLabel={submitLabel}
      initialCover={initialCover}
      onClose={onClose}
      uploadImage={uploadImage}
      serverError={serverError}
      submitDisabled={needsDomain}
      onSubmit={(cover) => onSubmit(title, normalizeCover(cover), domainOptions ? domainId : undefined)}
      preview={(cover) =>
        parseCover(cover) ? (
          <HubCard cover={cover} title={title.trim() || "Untitled hub"} />
        ) : cover ? (
          <img src={cover} alt="" className="aspect-[8/3] w-full object-cover" />
        ) : (
          <div className="aspect-[8/3] w-full bg-os-well" />
        )
      }
    >
      <div className="os-form mt-4">
        <FormField label="Title" autoFocus value={title} maxLength={120} placeholder="e.g. Design" onChange={setTitle} />
      </div>
      {domainOptions && (
        <div className="mt-4 flex flex-col gap-1.5 text-sm text-os-grey">
          Domain
          {firstFree ? (
            <Select value={domainId} options={domainOptions} onChange={setDomainId} ariaLabel="Domain" placeholder="Pick a domain" />
          ) : (
            <p className="text-foreground">{NO_DOMAIN_COPY}</p>
          )}
        </div>
      )}
    </CoverStudio>
  );
}
