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

import { getDartmouthJwt } from "../app/lib/dartmouth-jwt.js";

const netIds = process.argv.slice(2).filter((a) => !a.startsWith("-"));
if (netIds.length === 0) {
  console.error("usage: npx tsx scripts/dartmouth-people-fields.ts <netid> [...]");
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
