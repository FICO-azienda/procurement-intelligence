/**
 * A zip is a folder in one file: this opens it and lists what the import can
 * read, so every file inside goes through the same steps as a file dropped on
 * its own. It runs in the browser — the zip never travels, only the files in
 * it do, one at a time — and reads the zip piece by piece, so a large one is
 * never held in memory whole.
 *
 * Nothing is guessed: a file that can't be read (a password, damage, a type
 * the import doesn't know) is listed as left out, with the reason.
 */
import { inflateSync } from "fflate";
import { en, type Msg, type T } from "../i18n";
import { MAX_FILE_BYTES, extensionOf, isArchive, isImportable, looksLikeEInvoice } from "./files";

export type LeftOutReason = "unsupported" | "not_invoice" | "too_large" | "protected" | "unreadable";

export interface ArchiveFile {
  /** The file's own name, without folders. */
  name: string;
  /** Where it sits in the zip: "2026/settembre/fattura.pdf", or "inner.zip › fattura.pdf". */
  path: string;
  size: number;
  /** The file's bytes. Throws `ArchiveError` when the zip is damaged at this point. */
  read(): Promise<Uint8Array<ArrayBuffer>>;
}

export interface LeftOut {
  name: string;
  path: string;
  reason: LeftOutReason;
}

export interface Archive {
  files: ArchiveFile[];
  leftOut: LeftOut[];
}

/** The zip itself can't be opened: damaged, cut short, or not a zip at all. */
export class ArchiveError extends Error {}

/** A zip in a zip is opened too, this many levels down. */
const MAX_DEPTH = 2;
const MAX_INNER_ZIP_BYTES = 200 * 1024 * 1024;
const MAX_ENTRIES = 20_000;

const END = 0x06054b50;
const END_64 = 0x06064b50;
const LOCATOR_64 = 0x07064b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;
const ENCRYPTED = 0x0041;
const STORED = 0;
const DEFLATED = 8;

interface Entry {
  path: string;
  flags: number;
  method: number;
  crc: number;
  packed: number;
  size: number;
  offset: number;
}

async function slice(blob: Blob, start: number, end: number): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await blob.slice(start, end).arrayBuffer());
}
const view = (b: Uint8Array) => new DataView(b.buffer, b.byteOffset, b.byteLength);
const u64 = (v: DataView, at: number) => Number(v.getBigUint64(at, true));

// ---------------- File names ----------------

const UTF8 = new TextDecoder("utf-8", { fatal: true });
/** The upper half of code page 437, the encoding of a zip that doesn't say it uses UTF-8. */
const CP437 =
  "ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ";

/**
 * macOS writes UTF-8 names without flagging them, so the flag is not trusted:
 * a name that is valid UTF-8 is read as UTF-8, anything else as code page 437.
 */
export function decodeName(raw: Uint8Array): string {
  let name: string;
  try {
    name = UTF8.decode(raw);
  } catch {
    name = Array.from(raw, (b) => (b < 0x80 ? String.fromCharCode(b) : CP437[b - 0x80])).join("");
  }
  // macOS splits "à" into "a" + accent; put it back together.
  return name.normalize("NFC");
}

/** Files that operating systems add on their own: never something to import, never worth a mention. */
function isClutter(parts: string[]): boolean {
  const name = parts[parts.length - 1];
  return parts.includes("__MACOSX") || name.startsWith(".") || name.startsWith("~$") || /^(thumbs\.db|desktop\.ini)$/i.test(name);
}

// ---------------- Reading ----------------

/** The list of files, read from the directory at the end of the zip. */
async function directory(blob: Blob): Promise<Entry[]> {
  const tailStart = Math.max(0, blob.size - (0xffff + 22));
  const tail = await slice(blob, tailStart, blob.size);
  const tv = view(tail);
  let at = -1;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (tv.getUint32(i, true) === END) {
      at = i;
      break;
    }
  }
  if (at < 0) throw new ArchiveError("not a zip");

  let count = tv.getUint16(at + 10, true);
  let size = tv.getUint32(at + 12, true);
  let offset = tv.getUint32(at + 16, true);
  let endAt = tailStart + at;
  // Large zips keep the real numbers in a second record, pointed to from just before this one.
  const overflowed = count === 0xffff || size === 0xffffffff || offset === 0xffffffff;
  const record = at >= 20 && tv.getUint32(at - 20, true) === LOCATOR_64 ? view(await slice(blob, u64(tv, at - 12), u64(tv, at - 12) + 56)) : null;
  if (record && record.byteLength === 56 && record.getUint32(0, true) === END_64) {
    endAt = u64(tv, at - 12);
    count = u64(record, 32);
    size = u64(record, 40);
    offset = u64(record, 48);
  } else if (overflowed) throw new ArchiveError("damaged");
  if (count > MAX_ENTRIES) throw new ArchiveError("damaged");
  if (count === 0) return [];

  const starts = (b: Uint8Array) => b.length >= 4 && view(b).getUint32(0, true) === CENTRAL;
  let central = await slice(blob, offset, offset + size);
  let shift = 0;
  if (!starts(central)) {
    // Something was put in front of the zip (a self-extracting file): everything sits further on by the same amount.
    shift = endAt - size - offset;
    if (shift <= 0) throw new ArchiveError("damaged");
    central = await slice(blob, offset + shift, offset + shift + size);
  }
  const cv = view(central);
  const entries: Entry[] = [];
  let p = 0;
  for (let i = 0; i < count; i++) {
    if (p + 46 > central.length || cv.getUint32(p, true) !== CENTRAL) throw new ArchiveError("damaged");
    const nameLength = cv.getUint16(p + 28, true);
    const extraLength = cv.getUint16(p + 30, true);
    const commentLength = cv.getUint16(p + 32, true);
    const entry: Entry = {
      path: decodeName(central.subarray(p + 46, p + 46 + nameLength)),
      flags: cv.getUint16(p + 8, true),
      method: cv.getUint16(p + 10, true),
      crc: cv.getUint32(p + 16, true),
      packed: cv.getUint32(p + 20, true),
      size: cv.getUint32(p + 24, true),
      offset: cv.getUint32(p + 42, true),
    };
    let x = p + 46 + nameLength;
    const extraEnd = x + extraLength;
    while (x + 4 <= extraEnd) {
      const id = cv.getUint16(x, true);
      const length = cv.getUint16(x + 2, true);
      if (id === 0x0001) {
        // Sizes too large for the normal fields: only the ones that overflowed, in this order.
        let q = x + 4;
        for (const field of ["size", "packed", "offset"] as const) {
          if (entry[field] !== 0xffffffff) continue;
          entry[field] = u64(cv, q);
          q += 8;
        }
      } else if (id === 0x7075 && length > 5) {
        // The name again, in UTF-8, written by tools that keep the main one in an old encoding.
        entry.path = decodeName(central.subarray(x + 9, x + 4 + length));
      }
      x += 4 + length;
    }
    entry.offset += shift;
    entries.push(entry);
    p += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** One file out of the zip, checked against the size and checksum the zip declares for it. */
async function extract(blob: Blob, e: Entry): Promise<Uint8Array<ArrayBuffer>> {
  const head = await slice(blob, e.offset, e.offset + 30);
  if (head.length < 30 || view(head).getUint32(0, true) !== LOCAL) throw new ArchiveError("damaged");
  const start = e.offset + 30 + view(head).getUint16(26, true) + view(head).getUint16(28, true);
  const packed = await slice(blob, start, start + e.packed);
  if (packed.length !== e.packed) throw new ArchiveError("damaged");
  let data = packed;
  if (e.method === DEFLATED) {
    try {
      // Never more than the declared size, whatever the compressed data claims.
      data = e.size === 0 ? new Uint8Array(0) : inflateSync(packed, { out: new Uint8Array(e.size) });
    } catch {
      throw new ArchiveError("damaged");
    }
  }
  if (data.length !== e.size || crc32(data) !== e.crc) throw new ArchiveError("damaged");
  return data;
}

async function collect(blob: Blob, prefix: string, depth: number, out: Archive): Promise<void> {
  for (const e of await directory(blob)) {
    if (/[\\/]$/.test(e.path)) continue; // a folder
    const parts = e.path.split(/[\\/]+/).filter(Boolean);
    if (!parts.length || isClutter(parts)) continue;
    const name = parts[parts.length - 1];
    const path = prefix + parts.join("/");
    const leave = (reason: LeftOutReason) => void out.leftOut.push({ name, path, reason });
    const zip = isArchive(name);

    if (!zip && !isImportable(name)) leave("unsupported");
    else if (e.flags & ENCRYPTED) leave("protected");
    else if (e.method !== STORED && e.method !== DEFLATED) leave("unreadable");
    else if (e.size > (zip ? MAX_INNER_ZIP_BYTES : MAX_FILE_BYTES)) leave("too_large");
    else if (!zip) {
      // XML that is not an invoice (receipts, metadata of the exchange system) is told apart by looking at it.
      let invoice = true;
      if (extensionOf(name) === "xml") {
        try {
          invoice = looksLikeEInvoice(await extract(blob, e));
        } catch {
          // Damaged: said when the file is read.
        }
      }
      if (invoice) out.files.push({ name, path, size: e.size, read: () => extract(blob, e) });
      else leave("not_invoice");
    }
    else if (depth >= MAX_DEPTH) leave("unreadable");
    else {
      try {
        await collect(new Blob([await extract(blob, e)]), `${path} › `, depth + 1, out);
      } catch {
        leave("unreadable");
      }
    }
  }
}

/**
 * Opens a zip and lists the files the import can read, in the order of their
 * path. Throws `ArchiveError` when the zip itself can't be opened.
 */
export async function openArchive(blob: Blob): Promise<Archive> {
  const out: Archive = { files: [], leftOut: [] };
  try {
    await collect(blob, "", 0, out);
  } catch (err) {
    // A position outside the file, a number that makes no sense: the zip is damaged.
    throw err instanceof ArchiveError ? err : new ArchiveError("damaged");
  }
  const byPath = (a: { path: string }, b: { path: string }) => a.path.localeCompare(b.path, undefined, { numeric: true });
  out.files.sort(byPath);
  out.leftOut.sort(byPath);
  return out;
}

// ---------------- Saying what was left out ----------------

const LEFT_OUT: [reason: LeftOutReason, one: Msg, many: Msg][] = [
  [
    "unsupported",
    "{n} file in the zip is not a PDF, XML, Excel or CSV file and was left out: {names}.",
    "{n} files in the zip are not PDF, XML, Excel or CSV files and were left out: {names}.",
  ],
  ["not_invoice", "{n} XML file in the zip is not an invoice and was left out: {names}.", "{n} XML files in the zip are not invoices and were left out: {names}."],
  ["too_large", "{n} file in the zip is larger than 20 MB and was left out: {names}.", "{n} files in the zip are larger than 20 MB and were left out: {names}."],
  [
    "protected",
    "{n} file in the zip is protected by a password and was left out: {names}. Unzip it on your computer with the password, then upload the files.",
    "{n} files in the zip are protected by a password and were left out: {names}. Unzip it on your computer with the password, then upload the files.",
  ],
  ["unreadable", "{n} file in the zip couldn't be opened and was left out: {names}.", "{n} files in the zip couldn't be opened and were left out: {names}."],
];

const NAMED = 3;

/** One sentence per reason, with the first few names: what stayed out of the import, and why. */
export function leftOutNotes(leftOut: LeftOut[], t: T = en): string[] {
  const notes: string[] = [];
  for (const [reason, one, many] of LEFT_OUT) {
    const all = leftOut.filter((x) => x.reason === reason).map((x) => x.name);
    if (!all.length) continue;
    const shown = all.slice(0, NAMED).join(", ");
    const more = all.length - NAMED;
    notes.push(t.n(all.length, one, many, { names: more > 0 ? t.n(more, "{names} and one more", "{names} and {n} more", { names: shown }) : shown }));
  }
  return notes;
}
