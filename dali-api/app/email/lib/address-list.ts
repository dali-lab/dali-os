import { senderAddress, splitAddresses } from "~/email/lib/format";

// Normalizes a raw To/Cc header into the bare, lowercase addresses it names.
// Client-safe (no server imports) so the applicant-link UI can reuse it.
export function parseAddressList(header: string): string[] {
  return splitAddresses(header)
    .map((entry) => senderAddress(entry).trim().toLowerCase())
    .filter(Boolean);
}
