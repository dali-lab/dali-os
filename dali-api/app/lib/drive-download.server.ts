import { randomUUID } from "node:crypto";
import { Zip, ZipPassThrough } from "fflate";
import { DRIVE_DOWNLOAD_PREFIX } from "~/lib/file-validation";
import { uniqueNames } from "~/lib/file-download-name";
import { deleteObject, getDownloadUrl, getObjectStream, putObjectStream } from "~/lib/s3";

export const MAX_ZIP_FILES = 100;
export const MAX_ZIP_BYTES = 500 * 1024 * 1024;
const ZIP_NAME = "Drive files.zip";
const ZIP_LINK_SECONDS = 15 * 60;

export type ZipSource = { name: string; s3Key: string; modified: Date };

/** A ZIP of stored (uncompressed) entries, yielded as it is read so memory stays flat. */
export async function* zipSources(
  sources: ZipSource[],
  onMissing: (source: ZipSource) => void,
): AsyncGenerator<Uint8Array> {
  const pending: Uint8Array[] = [];
  let failure: Error | null = null;
  const zip = new Zip((err, chunk) => {
    if (err) failure = err;
    else pending.push(chunk);
  });
  const names = uniqueNames(sources.map((s) => s.name));

  for (const [i, source] of sources.entries()) {
    const body = await getObjectStream(source.s3Key);
    if (!body) {
      onMissing(source);
      continue;
    }
    const entry = new ZipPassThrough(names[i]);
    entry.mtime = source.modified;
    zip.add(entry);
    for await (const chunk of body) {
      entry.push(chunk);
      if (failure) throw failure;
      yield* pending.splice(0);
    }
    entry.push(new Uint8Array(0), true);
    yield* pending.splice(0);
  }
  zip.end();
  if (failure) throw failure;
  yield* pending.splice(0);
}

/**
 * Builds the ZIP in S3 and returns a link to it. An S3 link is the one download
 * the desktop app can finish: the shell has no download handler, so a response
 * from our own origin goes nowhere, while nav.rs hands other origins to the
 * system browser.
 */
export async function buildDriveZip(
  sources: ZipSource[],
): Promise<{ url: string; included: number } | null> {
  const key = `${DRIVE_DOWNLOAD_PREFIX}${randomUUID()}.zip`;
  let missing = 0;
  await putObjectStream(key, zipSources(sources, () => missing++), "application/zip");
  const included = sources.length - missing;
  if (included === 0) {
    await deleteObject(key);
    return null;
  }
  const url = await getDownloadUrl(key, { fileName: ZIP_NAME, expiresIn: ZIP_LINK_SECONDS });
  return { url, included };
}
