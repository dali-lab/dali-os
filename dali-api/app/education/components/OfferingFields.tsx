// Shared field set for the create + edit offering forms. Values are posted as
// plain form fields and parsed server-side in runOfferingAction.

type Values = {
  type?: "Miniseries" | "Workshop";
  title?: string;
  capacity?: number;
  registrationOpensAt?: string | Date;
  registrationClosesAt?: string | Date;
  startsAt?: string | Date;
  endsAt?: string | Date;
  requiresReview?: boolean;
  calendarEmail?: string | null;
};

/** Date → the local `datetime-local` input format (YYYY-MM-DDTHH:mm). */
export function toDatetimeLocal(value: string | Date | undefined): string {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const LABEL = "text-xs font-semibold text-muted-foreground";
const INPUT =
  "mt-1 w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-teal";

export function OfferingFields({
  values = {},
  typeLocked = false,
}: {
  values?: Values;
  typeLocked?: boolean;
}) {
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className={LABEL}>Type</span>
          <select
            name="type"
            defaultValue={values.type ?? "Workshop"}
            disabled={typeLocked}
            className={INPUT}
          >
            <option value="Workshop">Workshop (single session, RSVP)</option>
            <option value="Miniseries">Miniseries (multi-session, reviewed)</option>
          </select>
        </label>
        <label className="block">
          <span className={LABEL}>Capacity</span>
          <input
            type="number"
            name="capacity"
            min={1}
            required
            defaultValue={values.capacity ?? 20}
            className={INPUT}
          />
        </label>
      </div>

      <label className="block">
        <span className={LABEL}>Title</span>
        <input
          type="text"
          name="title"
          required
          defaultValue={values.title ?? ""}
          placeholder="e.g. Full-Stack Miniseries 26F"
          className={INPUT}
        />
      </label>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className={LABEL}>Registration opens</span>
          <input
            type="datetime-local"
            name="registrationOpensAt"
            required
            defaultValue={toDatetimeLocal(values.registrationOpensAt)}
            className={INPUT}
          />
        </label>
        <label className="block">
          <span className={LABEL}>Registration closes</span>
          <input
            type="datetime-local"
            name="registrationClosesAt"
            required
            defaultValue={toDatetimeLocal(values.registrationClosesAt)}
            className={INPUT}
          />
        </label>
        <label className="block">
          <span className={LABEL}>Starts</span>
          <input
            type="datetime-local"
            name="startsAt"
            required
            defaultValue={toDatetimeLocal(values.startsAt)}
            className={INPUT}
          />
        </label>
        <label className="block">
          <span className={LABEL}>Ends</span>
          <input
            type="datetime-local"
            name="endsAt"
            required
            defaultValue={toDatetimeLocal(values.endsAt)}
            className={INPUT}
          />
        </label>
      </div>

      <label className="flex items-center gap-2 text-sm text-foreground">
        <input
          type="checkbox"
          name="requiresReview"
          value="true"
          defaultChecked={values.requiresReview ?? false}
          className="rounded border-border"
        />
        Applications need instructor review (uncheck for RSVP auto-approval up
        to capacity)
      </label>
    </>
  );
}
