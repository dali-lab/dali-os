import { useEffect, useRef, useState, type ReactNode } from "react";
import { useFetcher } from "react-router";
import { CodeInput } from "~/components/auth/CodeInput";
import { Button } from "~/components/ui/Button";
import { FormField } from "~/components/ui/FormField";
import { Radio } from "~/components/ui/Radio";
import { useOsChrome } from "~/components/os-chrome";
import { cn } from "~/lib/cn";
import type { ContactEmailOptions, ContactEmailReply } from "~/lib/contact-email.server";

const OTHER = "__other__";

export function ContactEmailPicker({
  data,
  initial,
  submitLabel = "Continue",
  onDone,
  secondary,
}: {
  data: ContactEmailOptions;
  initial?: string | null;
  submitLabel?: string;
  onDone: () => void;
  secondary?: ReactNode;
}) {
  const { formClass } = useOsChrome();
  const fetcher = useFetcher<ContactEmailReply>();
  const start = initial ?? data.preselected;
  const [selected, setSelected] = useState(
    start && data.options.some((o) => o.address === start) ? start : data.options.length > 0 ? "" : OTHER,
  );
  const [other, setOther] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const handled = useRef<unknown>(null);
  const busy = fetcher.state !== "idle";
  const address = selected === OTHER ? other : selected;
  const reply = fetcher.data;
  const error = reply && "error" in reply ? reply.error : null;

  useEffect(() => {
    if (busy || !reply || reply === handled.current || !("ok" in reply)) return;
    handled.current = reply;
    if (reply.status === "code_sent") setPending(reply.address);
    else onDone();
  }, [busy, reply, onDone]);

  const send = () => fetcher.submit({ intent: "choose-contact-email", address }, { method: "post" });

  if (pending) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-[15px] leading-normal text-os-grey">
          We sent a 6-digit code to <span className="font-semibold text-foreground">{pending}</span>. Enter it to
          confirm this address.
        </p>
        {error ? (
          <p role="alert" className="text-sm text-[var(--os-danger-ink)]">
            {error}
          </p>
        ) : null}
        <fetcher.Form method="post" key={error ?? "code"}>
          <input type="hidden" name="intent" value="confirm-contact-email" />
          <input type="hidden" name="address" value={pending} />
          <CodeInput name="code" invalid={Boolean(error)} disabled={busy} />
        </fetcher.Form>
        <div className="flex items-center gap-2.5">
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => {
              handled.current = reply;
              setPending(null);
            }}
          >
            Use a different email
          </Button>
          <Button variant="ghost" disabled={busy} onClick={() => fetcher.submit({ intent: "choose-contact-email", address: pending }, { method: "post" })}>
            Send a new code
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className={cn(formClass, "flex flex-col gap-4")}>
      <div className="flex flex-col gap-3" role="radiogroup" aria-label="Email address">
        {data.options.map((option) => (
          <Radio
            key={option.address}
            name="contact-choice"
            checked={selected === option.address}
            onChange={() => setSelected(option.address)}
            label={option.address}
            description={option.current ? "Current" : option.proven ? undefined : "We'll send a code to confirm it"}
          />
        ))}
        <Radio
          name="contact-choice"
          checked={selected === OTHER}
          onChange={() => setSelected(OTHER)}
          label="Use a different email"
        />
        {selected === OTHER ? (
          <FormField label="Email address" labelHidden type="email" value={other} onChange={setOther} placeholder="you@email.com" autoFocus />
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="text-sm text-[var(--os-danger-ink)]">
          {error}
        </p>
      ) : null}
      <div className="flex items-center gap-2.5">
        <Button disabled={busy || address.trim() === ""} onClick={send}>
          {submitLabel}
        </Button>
        {secondary}
      </div>
    </div>
  );
}
