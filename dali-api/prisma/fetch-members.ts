import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";

const NOTION_DB_ID = "ace087ff-bc7f-4f6b-9f6d-36765391e327";
const OUTPUT_PATH = join(import.meta.dirname, "data/members.json");

interface NotionMember {
  firstName: string | null;
  lastName: string | null;
  daliEmail: string | null;
  email: string | null;
  did: string | null;
}

async function queryNotion(cursor?: string): Promise<{ results: unknown[]; has_more: boolean; next_cursor: string | null }> {
  const token = process.env.NOTION_TOKEN;
  if (!token) throw new Error("NOTION_TOKEN is not set");

  const body: Record<string, unknown> = {
    filter: { property: "Hires", relation: { is_not_empty: true } },
    page_size: 100,
  };
  if (cursor) body.start_cursor = cursor;

  const resp = await fetch(`https://api.notion.com/v1/databases/${NOTION_DB_ID}/query`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Notion-Version": "2022-06-28",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) throw new Error(`Notion API error: ${resp.status} ${await resp.text()}`);
  return resp.json() as Promise<{ results: unknown[]; has_more: boolean; next_cursor: string | null }>;
}

function extractMember(page: Record<string, unknown>): NotionMember {
  const props = page.properties as Record<string, Record<string, unknown>>;

  const nameParts = ((props["Name"]?.title as Array<{ plain_text: string }>) ?? [])
    .map((t) => t.plain_text)
    .join("")
    .trim()
    .split(/\s+/);
  const firstName = nameParts[0] ?? null;
  const lastName = nameParts.length > 1 ? nameParts.slice(1).join(" ") : null;

  const daliEmail = (props["dali email"]?.email as string | null) ?? null;
  const email = (props["dartmouth email"]?.email as string | null) ?? null;
  const didText = (props["did"]?.rich_text as Array<{ plain_text: string }> | undefined)?.[0]?.plain_text ?? null;
  const did = didText?.trim() || null;

  return { firstName, lastName, daliEmail, email, did };
}

async function main() {
  const members: NotionMember[] = [];
  let cursor: string | undefined;

  do {
    const page = await queryNotion(cursor);
    for (const result of page.results) {
      members.push(extractMember(result as Record<string, unknown>));
    }
    cursor = page.has_more && page.next_cursor ? page.next_cursor : undefined;
  } while (cursor);

  mkdirSync(join(import.meta.dirname, "data"), { recursive: true });
  writeFileSync(OUTPUT_PATH, JSON.stringify(members, null, 2));
  console.log(`Fetched ${members.length} members → prisma/data/members.json`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
