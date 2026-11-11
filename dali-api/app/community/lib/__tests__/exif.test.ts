import { describe, expect, it } from "vitest";
import { exifTakenAt, parseExifStamp, readTakenAt } from "../exif";

type Entry = { tag: number; text: string };

// A TIFF block: IFD0 (DateTime, pointer to the Exif IFD) then the Exif IFD.
function tiff({ ifd0 = [], exif = [], little = true }: { ifd0?: Entry[]; exif?: Entry[]; little?: boolean }) {
  const bytes: number[] = [];
  const u16 = (n: number) => (little ? [n & 0xff, n >> 8] : [n >> 8, n & 0xff]);
  const u32 = (n: number) => {
    const b = [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff];
    return little ? b : b.reverse();
  };
  const ifdSize = (n: number) => 2 + n * 12 + 4;
  const ifd0Entries = ifd0.length + (exif.length ? 1 : 0);
  const ifd0At = 8;
  const exifAt = ifd0At + ifdSize(ifd0Entries);
  let dataAt = exifAt + (exif.length ? ifdSize(exif.length) : 0);
  const data: number[] = [];
  const entry = (e: Entry) => {
    const text = [...e.text].map((c) => c.charCodeAt(0)).concat(0);
    const at = dataAt;
    dataAt += text.length;
    data.push(...text);
    return [...u16(e.tag), ...u16(2), ...u32(text.length), ...u32(at)];
  };
  bytes.push(...(little ? [0x49, 0x49] : [0x4d, 0x4d]), ...u16(42), ...u32(ifd0At));
  bytes.push(...u16(ifd0Entries));
  for (const e of ifd0) bytes.push(...entry(e));
  if (exif.length) bytes.push(...u16(0x8769), ...u16(4), ...u32(1), ...u32(exifAt));
  bytes.push(...u32(0));
  if (exif.length) {
    bytes.push(...u16(exif.length));
    for (const e of exif) bytes.push(...entry(e));
    bytes.push(...u32(0));
  }
  return new Uint8Array([...bytes, ...data]);
}

const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));
const be32 = (n: number) => [(n >>> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
const le32 = (n: number) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff];

function jpeg(block: Uint8Array) {
  const app0 = [0xff, 0xe0, 0x00, 0x10, ...ascii("JFIF\0"), 1, 1, 0, 0, 1, 0, 1, 0, 0];
  const payload = [...ascii("Exif\0\0"), ...block];
  const app1 = [0xff, 0xe1, (payload.length + 2) >> 8, (payload.length + 2) & 0xff, ...payload];
  return new Uint8Array([0xff, 0xd8, ...app0, ...app1, 0xff, 0xda, 0, 2, 0xff, 0xd9]);
}

function png(block: Uint8Array) {
  const chunk = (type: string, body: number[]) => [...be32(body.length), ...ascii(type), ...body, 0, 0, 0, 0];
  return new Uint8Array([
    0x89, ...ascii("PNG\r\n\x1a\n"),
    ...chunk("IHDR", new Array(13).fill(0)),
    ...chunk("eXIf", [...block]),
    ...chunk("IDAT", [0]),
    ...chunk("IEND", []),
  ]);
}

function webp(block: Uint8Array, prefixed = false) {
  const body = [...(prefixed ? ascii("Exif\0\0") : []), ...block];
  const pad = body.length % 2 ? [0] : [];
  const chunks = [...ascii("VP8 "), ...le32(3), 1, 2, 3, 0, ...ascii("EXIF"), ...le32(body.length), ...body, ...pad];
  return new Uint8Array([...ascii("RIFF"), ...le32(chunks.length + 4), ...ascii("WEBP"), ...chunks]);
}

const ORIGINAL = { tag: 0x9003, text: "2019:03:04 18:22:05" };
const OFFSET = { tag: 0x9011, text: "-05:00" };
const AT_OFFSET = new Date("2019-03-04T23:22:05.000Z");

describe("exifTakenAt", () => {
  it("reads DateTimeOriginal in its own offset from a JPEG", () => {
    expect(exifTakenAt(jpeg(tiff({ exif: [ORIGINAL, OFFSET] })))).toEqual(AT_OFFSET);
  });

  it("reads big-endian TIFF too", () => {
    expect(exifTakenAt(jpeg(tiff({ exif: [ORIGINAL, OFFSET], little: false })))).toEqual(AT_OFFSET);
  });

  it("reads the eXIf chunk of a PNG", () => {
    expect(exifTakenAt(png(tiff({ exif: [ORIGINAL, OFFSET] })))).toEqual(AT_OFFSET);
  });

  it("reads the EXIF chunk of a WebP, with or without the Exif prefix", () => {
    expect(exifTakenAt(webp(tiff({ exif: [ORIGINAL, OFFSET] })))).toEqual(AT_OFFSET);
    expect(exifTakenAt(webp(tiff({ exif: [ORIGINAL, OFFSET] }), true))).toEqual(AT_OFFSET);
  });

  it("reads a stamp with no offset as the device's local time", () => {
    expect(exifTakenAt(jpeg(tiff({ exif: [ORIGINAL] })))).toEqual(new Date(2019, 2, 4, 18, 22, 5));
  });

  it("falls back to DateTimeDigitized, then IFD0 DateTime", () => {
    const digitized = { tag: 0x9004, text: "2018:01:02 03:04:05" };
    expect(exifTakenAt(jpeg(tiff({ exif: [digitized] })))).toEqual(new Date(2018, 0, 2, 3, 4, 5));
    const modified = { tag: 0x0132, text: "2017:06:07 08:09:10" };
    expect(exifTakenAt(jpeg(tiff({ ifd0: [modified] })))).toEqual(new Date(2017, 5, 7, 8, 9, 10));
  });

  it("skips a blank DateTimeOriginal for the next stamp", () => {
    const blank = { tag: 0x9003, text: "0000:00:00 00:00:00" };
    const digitized = { tag: 0x9004, text: "2018:01:02 03:04:05" };
    expect(exifTakenAt(jpeg(tiff({ exif: [blank, digitized] })))).toEqual(new Date(2018, 0, 2, 3, 4, 5));
  });

  it("is null for files without EXIF, GIFs and garbage", () => {
    expect(exifTakenAt(jpeg(tiff({})))).toBeNull();
    expect(exifTakenAt(new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0, 2]))).toBeNull();
    expect(exifTakenAt(new Uint8Array(ascii("GIF89a")))).toBeNull();
    expect(exifTakenAt(new Uint8Array(0))).toBeNull();
    expect(exifTakenAt(new Uint8Array(64).fill(0xff))).toBeNull();
  });

  it("doesn't read past a truncated block", () => {
    const whole = jpeg(tiff({ exif: [ORIGINAL, OFFSET] }));
    for (let cut = 2; cut < whole.length; cut += 7) {
      expect(() => exifTakenAt(whole.subarray(0, cut))).not.toThrow();
    }
  });
});

describe("parseExifStamp", () => {
  it("rejects malformed and out-of-range stamps", () => {
    expect(parseExifStamp("2019-03-04", null)).toBeNull();
    expect(parseExifStamp("2019:13:04 10:00:00", null)).toBeNull();
    expect(parseExifStamp("1850:01:01 10:00:00", null)).toBeNull();
  });

  it("ignores an offset it can't read", () => {
    expect(parseExifStamp("2019:03:04 18:22:05", "EST")).toEqual(new Date(2019, 2, 4, 18, 22, 5));
  });
});

describe("readTakenAt", () => {
  it("reads a File", async () => {
    const file = new File([jpeg(tiff({ exif: [ORIGINAL, OFFSET] }))], "a.jpg", { type: "image/jpeg" });
    expect(await readTakenAt(file)).toEqual(AT_OFFSET);
  });

  it("is null when the file can't be read", async () => {
    const broken = { type: "image/jpeg", slice: () => ({ arrayBuffer: () => Promise.reject(new Error("x")) }) };
    expect(await readTakenAt(broken as unknown as File)).toBeNull();
  });
});
