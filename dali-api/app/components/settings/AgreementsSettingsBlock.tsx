import { Link } from "react-router";
import { FileSignature, Download, PenLine, CheckCircle2 } from "lucide-react";
import { formatDateTime } from "~/lib/display";
import { useUserTimeZone } from "~/hooks/useUserTimeZone";

type Outstanding = { bindingId: string; documentName: string };
type Signed = {
  signatureId: string;
  bindingId: string;
  documentName: string;
  context: string;
  signedAt: string | Date;
};

export function AgreementsSettingsBlock({
  outstanding,
  signed,
}: {
  outstanding: Outstanding[];
  signed: Signed[];
}) {
  const tz = useUserTimeZone();

  return (
    <div className="space-y-6">
      {outstanding.length > 0 && (
        <section>
          <h3 className="text-sm font-semibold text-foreground/80 mb-2">To sign</h3>
          <ul className="space-y-2">
            {outstanding.map((o) => (
              <li key={o.bindingId}>
                <Link
                  to={`/sign/${o.bindingId}`}
                  className="flex items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 hover:bg-amber-100/70 transition-colors"
                >
                  <span className="flex items-center gap-2 min-w-0">
                    <FileSignature className="w-4 h-4 text-amber-700 shrink-0" />
                    <span className="font-medium text-foreground truncate">{o.documentName}</span>
                  </span>
                  <span className="inline-flex items-center gap-1 text-sm font-medium text-amber-800 shrink-0">
                    <PenLine className="w-3.5 h-3.5" /> Review &amp; sign
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h3 className="text-sm font-semibold text-foreground/80 mb-2">Signed</h3>
        {signed.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">
            You haven't signed any agreements yet.
          </p>
        ) : (
          <ul className="space-y-2">
            {signed.map((s) => (
              <li
                key={s.signatureId}
                className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card p-3"
              >
                <span className="flex items-center gap-2 min-w-0">
                  <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0" />
                  <span className="min-w-0">
                    <span className="block font-medium text-foreground truncate">
                      {s.documentName}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {s.context} · signed {formatDateTime(s.signedAt as Date, tz)}
                    </span>
                  </span>
                </span>
                <span className="flex items-center gap-3 shrink-0">
                  <Link
                    to={`/sign/${s.bindingId}`}
                    className="text-sm font-medium text-accent-coral hover:underline"
                  >
                    View
                  </Link>
                  <a
                    href={`/sign/${s.bindingId}?format=pdf`}
                    className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
                    title="Download PDF"
                  >
                    <Download className="w-4 h-4" /> PDF
                  </a>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
