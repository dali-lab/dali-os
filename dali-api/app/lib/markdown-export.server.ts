import { blocksToMarkdown, type DocBlock } from "~/collab/blocknote-server";
import { buildDriveZip, MAX_ZIP_BYTES, MAX_ZIP_FILES, type ZipSource } from "~/drive/lib/drive-download.server";
import { downloadFileName, uniqueNames } from "~/lib/file-download-name";
import { isReservedUploadKey } from "~/lib/file-validation";
import { headObject } from "~/lib/s3";
import { RAW_UPLOAD_PATH } from "~/lib/upload-src";

const MEDIA_TYPES = new Set(["image", "video", "file"]);
const HEAD_BATCH = 10;
const UUID_PREFIX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-/i;

export type MarkdownExport = { kind: "markdown"; markdown: string } | { kind: "zip"; url: string };

function uploadKey(url: unknown): string | null {
  if (typeof url !== "string") return null;
  try {
    const parsed = new URL(url, "http://relative.invalid");
    const key = parsed.searchParams.get("key");
    if (parsed.origin !== "http://relative.invalid" || parsed.pathname !== RAW_UPLOAD_PATH) return null;
    return key?.startsWith("uploads/") && !isReservedUploadKey(key) ? key : null;
  } catch {
    return null;
  }
}

function uploadKeys(blocks: DocBlock[], into = new Set<string>()): Set<string> {
  for (const block of blocks) {
    const key = MEDIA_TYPES.has(block.type) ? uploadKey(block.props?.url) : null;
    if (key) into.add(key);
    uploadKeys(block.children ?? [], into);
  }
  return into;
}

function rewriteUrls(blocks: DocBlock[], replacements: Map<string, string>): DocBlock[] {
  return blocks.map((block) => {
    const key = MEDIA_TYPES.has(block.type) ? uploadKey(block.props?.url) : null;
    const url = key ? replacements.get(key) : undefined;
    return {
      ...block,
      props: url ? { ...block.props, url } : block.props,
      children: rewriteUrls(block.children ?? [], replacements),
    };
  });
}

function fileNameFromKey(key: string): string {
  const last = key.split("/").pop() ?? "file";
  const base = last.replace(UUID_PREFIX, "") || last;
  return downloadFileName(base, base);
}

async function sizesWithinCaps(keys: string[]): Promise<Map<string, number>> {
  const included = new Map<string, number>();
  let bytes = 0;
  for (let i = 0; i < keys.length && included.size < MAX_ZIP_FILES - 1; i += HEAD_BATCH) {
    const batch = keys.slice(i, i + HEAD_BATCH);
    const heads = await Promise.all(batch.map((key) => headObject(key).catch(() => null)));
    for (const [j, head] of heads.entries()) {
      if (!head || included.size >= MAX_ZIP_FILES - 1 || bytes + head.sizeBytes > MAX_ZIP_BYTES) continue;
      included.set(batch[j]!, head.sizeBytes);
      bytes += head.sizeBytes;
    }
  }
  return included;
}

/**
 * A document with uploaded media exports as a .zip (the .md beside a folder of its files, linked
 * relatively); one without stays a plain .md. Media past the zip caps, or missing from storage,
 * keep an absolute link to the DALI upload.
 */
export async function exportMarkdown(input: {
  title: string;
  fileName: string;
  blocks: DocBlock[];
  origin: string;
}): Promise<MarkdownExport> {
  const { title, fileName, blocks, origin } = input;
  const render = async (replacements: Map<string, string>) => {
    const body = blocks.length ? await blocksToMarkdown(rewriteUrls(blocks, replacements)) : "";
    return `# ${title}\n\n${body}`;
  };
  const keys = [...uploadKeys(blocks)];
  if (keys.length === 0) return { kind: "markdown", markdown: await render(new Map()) };

  const absolute = new Map(keys.map((key) => [key, `${origin}${RAW_UPLOAD_PATH}?key=${encodeURIComponent(key)}`]));
  const included = [...(await sizesWithinCaps(keys)).keys()];
  if (included.length === 0) return { kind: "markdown", markdown: await render(absolute) };

  const names = uniqueNames(included.map(fileNameFromKey));
  const relative = new Map(absolute);
  included.forEach((key, i) => relative.set(key, `${encodeURIComponent(fileName)}/${encodeURIComponent(names[i]!)}`));
  const modified = new Date();
  const sources: ZipSource[] = [
    { name: `${fileName}.md`, data: new TextEncoder().encode(await render(relative)), modified },
    ...included.map((key, i) => ({ name: `${fileName}/${names[i]}`, s3Key: key, modified })),
  ];
  const zip = await buildDriveZip(sources, `${fileName}.zip`);
  return zip ? { kind: "zip", url: zip.url } : { kind: "markdown", markdown: await render(absolute) };
}
