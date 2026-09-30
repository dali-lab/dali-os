// What does the People API actually return?
//
// dartmouth-people.ts parses three fields (dartmouth_affiliation, affiliations,
// department_class) and drops the rest of the body on the floor. Nobody has
// looked at the whole payload, so we do not know whether it already carries a
// mail / preferred-address field.
//
// That question decides whether we need the Email Addresses API and its
// Advancement scope at all. Run this against a CURRENT STUDENT's netid — the
// population that matters here — not an alum, whose record may look richer
// than a typical undergrad's.
//
// Prints field NAMES and types, and address-shaped values, never the rest of
// the record's contents.
//
//   npx tsx scripts/dartmouth-people-fields.ts <netid> [<netid> ...]
//
// The second mode answers the one question the People API may not support:
// whether a proven ADDRESS can be turned back into a netid. /api/people is
// documented as /{netid}-keyed, so a filter may simply not exist — but the
// Dartmouth APIs share a filtering convention, so it is worth one request. If
// any of these work, dartmouth-email-addresses.ts can be deleted outright and
// the Advancement scope is never needed.
//
//   npx tsx scripts/dartmouth-people-fields.ts --by-email <address>

import { getDartmouthJwt } from "../app/lib/dartmouth-jwt.js";

const args = process.argv.slice(2);
const byEmailIdx = args.indexOf("--by-email");
const byEmail = byEmailIdx === -1 ? null : args[byEmailIdx + 1];
const netIds = args.filter((a) => !a.startsWith("-") && a !== byEmail);

if (!byEmail && netIds.length === 0) {
  console.error(
    "usage:\n" +
      "  npx tsx scripts/dartmouth-people-fields.ts <netid> [...]\n" +
      "  npx tsx scripts/dartmouth-people-fields.ts --by-email <address>",
  );
  process.exit(1);
}

function shape(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) {
    const inner = value.length > 0 ? shape(value[0]) : "?";
    return `array<${inner}>[${value.length}]`;
  }
  if (typeof value === "object") {
    return `object{${Object.keys(value as object).join(",")}}`;
  }
  return typeof value;
}

const EMAILISH = /@/;

for (const netId of netIds) {
  const jwt = await getDartmouthJwt();
  const res = await fetch(
    `https://api.dartmouth.edu/api/people/${encodeURIComponent(netId.toLowerCase())}`,
    { headers: { Accept: "application/json", Authorization: `Bearer ${jwt}` } },
  );

  console.log(`\n=== ${netId}  HTTP ${res.status} ${res.statusText}`);
  if (!res.ok) {
    console.log(`    (no body inspected)`);
    continue;
  }

  const body = (await res.json()) as Record<string, unknown>;
  const keys = Object.keys(body).sort();
  console.log(`    fields (${keys.length}):`);
  for (const k of keys) {
    console.log(`      ${k.padEnd(28)} ${shape(body[k])}`);
  }

  // The actual question: is an address in here anywhere?
  const addressFields = keys.filter((k) => {
    const v = body[k];
    return (
      /mail|email|address/i.test(k) || (typeof v === "string" && EMAILISH.test(v))
    );
  });
  if (addressFields.length > 0) {
    console.log(`    ADDRESS-SHAPED FIELDS FOUND:`);
    for (const k of addressFields) console.log(`      ${k} = ${String(body[k])}`);
    console.log(`    -> the Email Addresses API and its Advancement scope may be unnecessary`);
  } else {
    console.log(`    no address field at this scope`);
  }
}

// ── Can a proven address be resolved back to a netid? ────────────────────────

if (byEmail) {
  const jwt = await getDartmouthJwt();
  const address = byEmail.trim().toLowerCase();

  // Candidate filter spellings. The Dartmouth portal defers filter syntax to a
  // shared conventions section, so this tries the plausible forms rather than
  // guessing one and concluding from a single 404.
  const candidates: [string, string][] = [
    ["?email=", `https://api.dartmouth.edu/api/people?email=${encodeURIComponent(address)}`],
    ["?mail=", `https://api.dartmouth.edu/api/people?mail=${encodeURIComponent(address)}`],
    [
      "?filter=email eq",
      `https://api.dartmouth.edu/api/people?filter=${encodeURIComponent(`email eq '${address}'`)}`,
    ],
    [
      "email_addresses?email_address=",
      `https://api.dartmouth.edu/api/email_addresses?email_address=${encodeURIComponent(address)}`,
    ],
  ];

  console.log(`\nResolving an address back to a netid: ${address}\n`);
  for (const [label, url] of candidates) {
    let res: Response;
    try {
      res = await fetch(url, {
        headers: { Accept: "application/json", Authorization: `Bearer ${jwt}` },
      });
    } catch (err) {
      console.log(`  ${label.padEnd(30)} request failed: ${String(err)}`);
      continue;
    }

    const text = await res.text();
    let netids: string[] = [];
    try {
      const body = JSON.parse(text) as unknown;
      const rows = Array.isArray(body)
        ? body
        : ((body as Record<string, unknown>)?.users as unknown[]) ?? [];
      netids = rows
        .map((r) => (r as { netid?: unknown })?.netid)
        .filter((n): n is string => typeof n === "string");
    } catch {
      // Non-JSON body (an error page); the status alone is the signal.
    }

    const verdict =
      netids.length > 0
        ? `WORKS -> netid(s): ${[...new Set(netids)].join(", ")}`
        : res.ok
          ? "200 but no netid in the body"
          : `HTTP ${res.status}`;
    console.log(`  ${label.padEnd(30)} ${verdict}`);
  }

  console.log(
    `\nIf any line says WORKS, delete app/lib/dartmouth-email-addresses.ts —\n` +
      `signup can bind a netID with no Advancement scope at all.\n`,
  );
}
