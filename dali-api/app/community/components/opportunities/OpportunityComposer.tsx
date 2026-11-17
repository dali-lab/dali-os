import { useEffect, useId, useRef, useState } from "react";
import { useFetcher } from "react-router";
import {
  CHAT_TOPIC_SUGGESTIONS,
  OPPORTUNITY_BODY_MAX,
  OPPORTUNITY_FIELD_MAX,
  OPPORTUNITY_TOPIC_MAX,
} from "~/community/lib/opportunities";
import { readLogoColor } from "~/community/lib/block-color";
import { LogoBlock } from "~/community/components/opportunities/LogoBlock";
import { cn } from "~/lib/cn";
import { Modal } from "~/components/Modal";
import { modalCardClass, useOsChrome } from "~/components/os-chrome";
import { Button } from "~/components/ui/Button";
import { FormField } from "~/components/ui/FormField";
import { Segmented } from "~/components/ui/Segmented";
import { Toggle } from "~/components/ui/Toggle";
import { ToggleChip } from "~/components/ui/ToggleChip";
import { useToast } from "~/components/ui/toast";

export type ComposerKind = "Job" | "ChatAsk";

type ResolvedLink = {
  url: string;
  companyName: string | null;
  companyDomain: string | null;
  role: string | null;
  location: string | null;
  jobType: string | null;
  logoKey: string | null;
  logoUrl: string | null;
};
type ResolveResult = { ok: true; link: ResolvedLink } | { ok: false };

const RESOLVE_URL = "/api/opportunities/resolve-link";

function JobFields({ onFields }: { onFields: (fields: Record<string, string>) => void }) {
  const resolver = useFetcher<ResolveResult>();
  const [url, setUrl] = useState("");
  const [company, setCompany] = useState("");
  const [role, setRole] = useState("");
  const [location, setLocation] = useState("");
  const [jobType, setJobType] = useState("");
  const [willRefer, setWillRefer] = useState(false);
  const [body, setBody] = useState("");
  const [logo, setLogo] = useState<{ key: string; url: string; domain: string } | null>(null);
  const [color, setColor] = useState<string | null>(null);
  const resolved = useRef<string>("");

  function resolve() {
    const next = url.trim();
    if (!next || next === resolved.current) return;
    resolved.current = next;
    resolver.submit({ url: next }, { method: "post", action: RESOLVE_URL });
  }

  const result = resolver.data;
  useEffect(() => {
    if (resolver.state !== "idle" || !result?.ok) return;
    const { link } = result;
    setCompany(link.companyName ?? "");
    setRole(link.role ?? "");
    setLocation(link.location ?? "");
    setJobType(link.jobType ?? "");
    setColor(null);
    setLogo(link.logoKey && link.logoUrl ? { key: link.logoKey, url: link.logoUrl, domain: link.companyDomain ?? "" } : null);
  }, [resolver.state, result]);

  useEffect(() => {
    onFields({
      kind: "Job",
      jobUrl: url.trim(),
      companyName: company.trim(),
      role: role.trim(),
      location: location.trim(),
      jobType: jobType.trim(),
      willRefer: String(willRefer),
      body: body.trim(),
      logoKey: logo?.key ?? "",
      companyDomain: logo?.domain ?? (result?.ok ? (result.link.companyDomain ?? "") : ""),
      blockColor: color ?? "",
    });
  }, [url, company, role, location, jobType, willRefer, body, logo, color, result, onFields]);

  return (
    <>
      <FormField
        label="Link to the job"
        type="url"
        value={url}
        onChange={setUrl}
        placeholder="https://"
        hint={resolver.state !== "idle" ? "Reading the link" : result && !result.ok ? "We couldn't read that link. Fill in the details below." : undefined}
        onBlur={resolve}
      />
      {(logo || company) && (
        <div className="flex items-center gap-3">
          <LogoBlock name={company || "?"} logoUrl={logo?.url} color={color} size={48} drop={Boolean(logo)} />
          {logo && (
            <img
              src={logo.url}
              alt=""
              aria-hidden
              className="sr-only"
              onLoad={(e) => setColor(readLogoColor(e.currentTarget))}
            />
          )}
        </div>
      )}
      <FormField label="Company" required value={company} onChange={setCompany} />
      <FormField label="Role" required value={role} onChange={setRole} />
      <div className="grid grid-cols-2 gap-3">
        <FormField label="Location" value={location} onChange={setLocation} />
        <FormField label="Type" value={jobType} onChange={setJobType} placeholder="Full-time" />
      </div>
      <Toggle tone="os" label="I'll refer DALI students" checked={willRefer} onChange={(e) => setWillRefer(e.target.checked)} />
      <FormField
        label="Message"
        required
        multiline
        rows={4}
        value={body}
        onChange={(v) => setBody(v.slice(0, OPPORTUNITY_BODY_MAX))}
        placeholder="Tell students about the role"
      />
    </>
  );
}

function ChatFields({ onFields }: { onFields: (fields: Record<string, string>) => void }) {
  const [topic, setTopic] = useState("");
  const [body, setBody] = useState("");
  useEffect(() => {
    onFields({ kind: "ChatAsk", topic: topic.trim(), body: body.trim() });
  }, [topic, body, onFields]);
  return (
    <>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Suggested topics">
        {CHAT_TOPIC_SUGGESTIONS.map((suggestion) => (
          <ToggleChip key={suggestion} on={topic === suggestion} onToggle={() => setTopic(topic === suggestion ? "" : suggestion)}>
            {suggestion}
          </ToggleChip>
        ))}
      </div>
      <FormField
        label="Topic"
        required
        value={topic}
        onChange={(v) => setTopic(v.slice(0, OPPORTUNITY_TOPIC_MAX))}
        placeholder="Pick one above or type your own"
      />
      <FormField
        label="Message"
        required
        multiline
        rows={4}
        value={body}
        onChange={(v) => setBody(v.slice(0, OPPORTUNITY_BODY_MAX))}
        placeholder="What would you like to talk about?"
      />
    </>
  );
}

export function OpportunityComposer({
  open,
  onClose,
  initialKind,
  canPostJob,
}: {
  open: boolean;
  onClose: () => void;
  initialKind: ComposerKind;
  canPostJob: boolean;
}) {
  const titleId = useId();
  const toast = useToast();
  const { formClass } = useOsChrome();
  const fetcher = useFetcher<{ ok: boolean }>();
  const [kind, setKind] = useState<ComposerKind>(canPostJob ? initialKind : "ChatAsk");
  const [fields, setFields] = useState<Record<string, string>>({});
  const posting = fetcher.state !== "idle";

  const handled = useRef<unknown>(null);
  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data || handled.current === fetcher.data) return;
    handled.current = fetcher.data;
    if (fetcher.data.ok) {
      toast.success("Posted");
      onClose();
    } else {
      toast.error("Could not post that");
    }
  }, [fetcher.state, fetcher.data, toast, onClose]);

  const ready =
    kind === "Job"
      ? Boolean(fields.companyName && fields.role && fields.body)
      : Boolean(fields.topic && fields.body);

  return (
    <Modal open={open} onClose={onClose} labelledBy={titleId} disableEscape={posting} containerClassName={modalCardClass("max-w-lg")}>
      <form
        className={cn(formClass, "flex flex-col gap-4")}
        onSubmit={(e) => {
          e.preventDefault();
          if (!ready || posting) return;
          fetcher.submit({ intent: "create", ...fields }, { method: "post" });
        }}
      >
        <h2 id={titleId} className="font-heading text-xl font-semibold text-foreground">
          {canPostJob ? "Share" : "Ask for a coffee chat"}
        </h2>
        {canPostJob && (
          <Segmented<ComposerKind>
            ariaLabel="What to share"
            value={kind}
            onChange={setKind}
            options={[
              { value: "Job", label: "Job" },
              { value: "ChatAsk", label: "Coffee chat" },
            ]}
          />
        )}
        {kind === "Job" && canPostJob ? <JobFields onFields={setFields} /> : <ChatFields onFields={setFields} />}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={posting}>
            Cancel
          </Button>
          <Button type="submit" disabled={posting || !ready}>
            {posting ? "Posting" : "Post"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
