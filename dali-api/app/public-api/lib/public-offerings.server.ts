import { prisma } from "~/lib/db";
import { readDocAsBlocks } from "~/collab/read";
import { blocksToPlainText } from "~/components/doc/schema/configs";

// Published education offerings for dali.website's offerings calendar.
// Response shape matches the site's `Offering` interface (shared/api.ts).

export type PublicOffering = {
  id: string;
  name: string;
  description: string;
  date: {
    day: number;
    month: string;
    year?: number;
    time?: string;
    fullDate?: string;
  };
  type: string;
  tags: string[];
  signUpLink: string;
};

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// The site renders the parts separately, so it gets parts rather than a
// formatted string. Times are rendered in Eastern — the lab is one campus and
// every offering happens on it, so a viewer's local zone would be misleading
// rather than helpful.
function toDateParts(d: Date): PublicOffering["date"] {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const minute = get("minute");
  const hour = get("hour");
  const dayPeriod = get("dayPeriod").toUpperCase();
  return {
    day: Number(get("day")),
    month: MONTHS[Number(get("month")) - 1],
    year: Number(get("year")),
    time: minute === "00" ? `${hour} ${dayPeriod}` : `${hour}:${minute} ${dayPeriod}`,
    fullDate: d.toISOString(),
  };
}

export async function listPublicOfferings(): Promise<PublicOffering[]> {
  const rows = await prisma.educationOffering.findMany({
    where: { status: "Published" },
    orderBy: { startsAt: "asc" },
    select: {
      id: true,
      title: true,
      type: true,
      startsAt: true,
      descriptionDocId: true,
      applicationFormId: true,
    },
  });

  return Promise.all(
    rows.map(async (o) => {
      // The description lives in a collab doc; the site's calendar cards show
      // a plain-text blurb, so flatten rather than shipping blocks it can't
      // render.
      const description = o.descriptionDocId
        ? blocksToPlainText(await readDocAsBlocks(o.descriptionDocId)).trim()
        : "";
      return {
        id: o.id,
        name: o.title,
        description,
        date: toDateParts(o.startsAt),
        // The site keys its filter chips off lowercase type names.
        type: o.type.toLowerCase(),
        // Notion carried free-text tags per offering; DALI OS models the one
        // meaningful distinction as `type`, so that's the only tag there is.
        tags: [o.type],
        // Offerings apply through the shared Forms system. Null form = not
        // open yet; "#" matches what the site already renders for that case.
        signUpLink: o.applicationFormId
          ? `${process.env.FRONTEND_URL ?? ""}/education/${o.id}`
          : "#",
      };
    }),
  );
}
