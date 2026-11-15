// When a photo was taken, from the EXIF block JPEG, PNG and WebP files carry.

const TAG_DATE_TIME = 0x0132;
const TAG_EXIF_IFD = 0x8769;
const TAG_DATE_TIME_ORIGINAL = 0x9003;
const TAG_DATE_TIME_DIGITIZED = 0x9004;
const TAG_OFFSET_TIME = 0x9010;
const TAG_OFFSET_TIME_ORIGINAL = 0x9011;
const TAG_OFFSET_TIME_DIGITIZED = 0x9012;
const TYPE_ASCII = 2;
const TYPE_LONG = 4;

const ascii = (b: Uint8Array, start: number, length: number) =>
  String.fromCharCode(...b.subarray(start, start + length));

function readIfd(tiff: Uint8Array, offset: number, little: boolean): Map<number, string | number> {
  const view = new DataView(tiff.buffer, tiff.byteOffset, tiff.byteLength);
  const tags = new Map<number, string | number>();
  if (offset < 8 || offset + 2 > tiff.length) return tags;
  const count = view.getUint16(offset, little);
  for (let i = 0; i < count; i++) {
    const entry = offset + 2 + i * 12;
    if (entry + 12 > tiff.length) break;
    const tag = view.getUint16(entry, little);
    const type = view.getUint16(entry + 2, little);
    const length = view.getUint32(entry + 4, little);
    if (type === TYPE_LONG && length === 1) {
      tags.set(tag, view.getUint32(entry + 8, little));
    } else if (type === TYPE_ASCII && length <= 64) {
      const at = length > 4 ? view.getUint32(entry + 8, little) : entry + 8;
      if (at + length > tiff.length) continue;
      tags.set(tag, ascii(tiff, at, length).replace(/\0+$/, "").trim());
    }
  }
  return tags;
}

function tiffDate(tiff: Uint8Array): Date | null {
  if (tiff.length < 8) return null;
  const order = ascii(tiff, 0, 2);
  if (order !== "II" && order !== "MM") return null;
  const little = order === "II";
  const view = new DataView(tiff.buffer, tiff.byteOffset, tiff.byteLength);
  if (view.getUint16(2, little) !== 42) return null;
  const ifd0 = readIfd(tiff, view.getUint32(4, little), little);
  const exifAt = ifd0.get(TAG_EXIF_IFD);
  const exif = typeof exifAt === "number" ? readIfd(tiff, exifAt, little) : new Map();
  const candidates: [number, number, Map<number, string | number>][] = [
    [TAG_DATE_TIME_ORIGINAL, TAG_OFFSET_TIME_ORIGINAL, exif],
    [TAG_DATE_TIME_DIGITIZED, TAG_OFFSET_TIME_DIGITIZED, exif],
    [TAG_DATE_TIME, TAG_OFFSET_TIME, ifd0],
  ];
  for (const [tag, offsetTag, ifd] of candidates) {
    const stamp = ifd.get(tag);
    const offset = exif.get(offsetTag);
    if (typeof stamp !== "string") continue;
    const date = parseExifStamp(stamp, typeof offset === "string" ? offset : null);
    if (date) return date;
  }
  return null;
}

/** "2019:03:04 18:22:05" in its own offset, or the device's local time when it has none. */
export function parseExifStamp(stamp: string, offset: string | null): Date | null {
  const m = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(stamp);
  if (!m) return null;
  const [y, mo, d, h, mi, s] = m.slice(1).map(Number);
  if (y < 1900 || mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 59) return null;
  const zone = offset && /^[+-]\d{2}:\d{2}$/.test(offset) ? offset : null;
  const date = zone
    ? new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}${zone}`)
    : new Date(y, mo - 1, d, h, mi, s);
  return Number.isNaN(date.getTime()) ? null : date;
}

function jpegTiff(b: Uint8Array): Uint8Array | null {
  let i = 2;
  while (i + 4 <= b.length && b[i] === 0xff) {
    const marker = b[i + 1];
    if (marker === 0xda || marker === 0xd9) return null;
    const length = (b[i + 2] << 8) | b[i + 3];
    if (marker === 0xe1 && ascii(b, i + 4, 6) === "Exif\0\0") {
      return b.subarray(i + 10, i + 2 + length);
    }
    i += 2 + length;
  }
  return null;
}

function pngTiff(b: Uint8Array): Uint8Array | null {
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let i = 8;
  while (i + 8 <= b.length) {
    const length = view.getUint32(i);
    const type = ascii(b, i + 4, 4);
    if (type === "eXIf") return b.subarray(i + 8, i + 8 + length);
    if (type === "IDAT" || type === "IEND") return null;
    i += 12 + length;
  }
  return null;
}

function webpTiff(b: Uint8Array): Uint8Array | null {
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let i = 12;
  while (i + 8 <= b.length) {
    const type = ascii(b, i, 4);
    const length = view.getUint32(i + 4, true);
    if (type === "EXIF") {
      const chunk = b.subarray(i + 8, i + 8 + length);
      return ascii(chunk, 0, 6) === "Exif\0\0" ? chunk.subarray(6) : chunk;
    }
    i += 8 + length + (length % 2);
  }
  return null;
}

/** When the photo in these bytes was taken, or null when the file doesn't say. */
export function exifTakenAt(bytes: Uint8Array): Date | null {
  let tiff: Uint8Array | null = null;
  if (bytes[0] === 0xff && bytes[1] === 0xd8) tiff = jpegTiff(bytes);
  else if (ascii(bytes, 1, 3) === "PNG") tiff = pngTiff(bytes);
  else if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") tiff = webpTiff(bytes);
  return tiff ? tiffDate(tiff) : null;
}

// JPEG and PNG keep EXIF ahead of the image data; WebP keeps it at the end.
const HEAD_BYTES = 1024 * 1024;

export async function readTakenAt(file: File): Promise<Date | null> {
  try {
    const part = file.type === "image/webp" ? file : file.slice(0, HEAD_BYTES);
    return exifTakenAt(new Uint8Array(await part.arrayBuffer()));
  } catch {
    return null;
  }
}
