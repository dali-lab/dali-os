import { unzipSync } from "fflate";
import { markdownToBlocks, type DocBlock } from "~/collab/blocknote-server";
import { MAX_ZIP_FILES } from "~/drive/lib/drive-download.server";
import { MAX_UPLOAD_BYTES } from "~/lib/file-validation";
import { MAX_IMPORT_IMAGES, rewriteMarkdownImages, type ImageDeps } from "~/lib/markdown-images.server";

export class ImportError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = "ImportError";
  }
}

export const TEXT_EXTENSIONS = [".md", ".markdown", ".txt"];
const MARKDOWN_NAME = /\.(md|markdown)$/i;

export interface ImportSource {
  markdown: string;
  files?: Map<string, Uint8Array>;
  baseDir: string;
}

export const IMPORT_ZIP_BYTES = 50 * 1024 * 1024;

export interface ZipLimits {
  unzippedBytes: number;
  files: number;
}

const ZIP_LIMITS: ZipLimits = { unzippedBytes: 100 * 1024 * 1024, files: MAX_ZIP_FILES };

export const importLimitFor = (fileName: string) => (/\.zip$/i.test(fileName) ? IMPORT_ZIP_BYTES : MAX_UPLOAD_BYTES);

const clean = (name: string) => name.replaceAll("\\", "/").normalize("NFC");
const isIgnored = (name: string) => name.split("/").some((part, i) => part.startsWith(".") || (i === 0 && part === "__MACOSX"));
const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes).replace(/^﻿/, "");

function readZip(bytes: Uint8Array, limits: ZipLimits): ImportSource {
  let entries = 0;
  let total = 0;
  const unzipped = unzipSync(bytes, {
    filter(file) {
      const name = clean(file.name);
      total += file.originalSize;
      if (total > limits.unzippedBytes) throw new ImportError("This .zip is too large once unpacked.", 413);
      if (name.endsWith("/") || isIgnored(name)) return false;
      if (++entries > limits.files) throw new ImportError(`This .zip has more than ${limits.files} files.`, 413);
      return true;
    },
  });
  const files = new Map(Object.entries(unzipped).map(([name, data]) => [clean(name), data]));
  const markdownPaths = [...files.keys()].filter((name) => MARKDOWN_NAME.test(name));
  if (markdownPaths.length === 0) throw new ImportError("This .zip has no Markdown file.", 400);
  const depth = (name: string) => name.split("/").length;
  const shallowest = Math.min(...markdownPaths.map(depth));
  const top = markdownPaths.filter((name) => depth(name) === shallowest);
  if (top.length > 1) throw new ImportError("This .zip has more than one Markdown file at the top.", 400);
  const path = top[0]!;
  const markdown = decode(files.get(path)!);
  files.delete(path);
  return { markdown, files, baseDir: path.split("/").slice(0, -1).join("/") };
}

export function readImportFile(fileName: string, bytes: Uint8Array, limits: ZipLimits = ZIP_LIMITS): ImportSource {
  if (/\.zip$/i.test(fileName)) {
    try {
      return readZip(bytes, limits);
    } catch (error) {
      if (error instanceof ImportError) throw error;
      throw new ImportError("This .zip could not be read.", 400);
    }
  }
  if (!TEXT_EXTENSIONS.some((ext) => fileName.toLowerCase().endsWith(ext))) {
    throw new ImportError("Choose a .md, .markdown, .txt or .zip file.", 400);
  }
  return { markdown: decode(bytes), baseDir: "" };
}

export async function importMarkdownFile(input: {
  fileName: string;
  bytes: Uint8Array;
  pageId: string;
  ownOrigin?: string;
  deps?: Partial<ImageDeps>;
}): Promise<{ blocks: DocBlock[]; skipped: number }> {
  const source = readImportFile(input.fileName, input.bytes);
  const pass = await rewriteMarkdownImages(source.markdown, {
    uploadPrefix: `uploads/doc-images/${input.pageId}/`,
    maxImages: MAX_IMPORT_IMAGES,
    files: source.files,
    baseDir: source.baseDir,
    ownOrigin: input.ownOrigin,
    deps: input.deps,
  });
  return { blocks: await markdownToBlocks(pass.markdown), skipped: pass.skipped };
}
