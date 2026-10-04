/**
 * A signed file (.xml.p7m, .pdf.p7m) is an envelope: the document plus the
 * supplier's digital signature, in one binary file (CAdES, a PKCS#7
 * "signed data"). This takes the document out of the envelope.
 *
 * The signature is not checked: the app reads what the file says, it does not
 * certify who signed it. Nothing is searched for or guessed either — the
 * content is taken from the one place the format keeps it, or the file is
 * refused.
 */
import { ImportError } from "./tabular";

/** One element of the envelope: its tag, where its content is, where the next one starts. */
interface Element {
  tag: number;
  constructed: boolean;
  start: number;
  end: number;
  next: number;
}

class Malformed extends Error {}

const SEQUENCE = 0x30;
const OBJECT_ID = 0x06;
const OCTET_STRING = 0x04;
const EXPLICIT_0 = 0xa0;
/** 1.2.840.113549.1.7.2 — "signed data". */
const SIGNED_DATA = [0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x07, 0x02];
const MAX_DEPTH = 64;

function element(b: Uint8Array, at: number, limit: number, depth = 0): Element {
  if (at + 2 > limit || depth > MAX_DEPTH) throw new Malformed();
  const tag = b[at];
  const constructed = (tag & 0x20) !== 0;
  let p = at + 1;
  if ((tag & 0x1f) === 0x1f) {
    // A tag number written on several bytes: not used here, stepped over.
    while (p < limit && b[p] & 0x80) p++;
    p++;
  }
  if (p >= limit) throw new Malformed();
  const first = b[p++];
  if (first === 0x80) {
    // Length not declared: the content runs until an end marker (00 00).
    if (!constructed) throw new Malformed();
    let q = p;
    for (;;) {
      if (q + 2 > limit) throw new Malformed();
      if (b[q] === 0 && b[q + 1] === 0) return { tag, constructed, start: p, end: q, next: q + 2 };
      q = element(b, q, limit, depth + 1).next;
    }
  }
  let length = first;
  if (first > 0x80) {
    const bytes = first & 0x7f;
    if (bytes > 6 || p + bytes > limit) throw new Malformed();
    length = 0;
    for (let i = 0; i < bytes; i++) length = length * 256 + b[p++];
  }
  if (p + length > limit) throw new Malformed();
  return { tag, constructed, start: p, end: p + length, next: p + length };
}

/** The first `count` elements inside another (what follows is not read: certificates, signatures). */
function inside(b: Uint8Array, parent: Element, count: number): Element[] {
  const out: Element[] = [];
  for (let p = parent.start; p < parent.end && out.length < count; ) {
    const e = element(b, p, parent.end);
    out.push(e);
    p = e.next;
  }
  return out;
}

/** The bytes of a byte string, which large files write in pieces. */
function octets(b: Uint8Array, e: Element, out: Uint8Array[], depth = 0): void {
  if ((e.tag & 0x1f) !== OCTET_STRING || depth > MAX_DEPTH) throw new Malformed();
  if (!e.constructed) {
    out.push(b.subarray(e.start, e.end));
    return;
  }
  for (let p = e.start; p < e.end; ) {
    const piece = element(b, p, e.end);
    octets(b, piece, out, depth + 1);
    p = piece.next;
  }
}

/** What the envelope holds; null when it holds only the signature (the content travels apart). */
function content(b: Uint8Array): Uint8Array<ArrayBuffer> | null {
  const envelope = element(b, 0, b.length);
  const [type, wrapped] = inside(b, envelope, 2);
  if (envelope.tag !== SEQUENCE || type?.tag !== OBJECT_ID || wrapped?.tag !== EXPLICIT_0) throw new Malformed();
  if (type.end - type.start !== SIGNED_DATA.length || SIGNED_DATA.some((x, i) => b[type.start + i] !== x)) throw new Malformed();
  const [signed] = inside(b, wrapped, 1);
  if (signed?.tag !== SEQUENCE) throw new Malformed();
  // version · digest algorithms · the content · (certificates, signatures: not read)
  const [, , holder] = inside(b, signed, 3);
  if (holder?.tag !== SEQUENCE) throw new Malformed();
  const [, explicit] = inside(b, holder, 2);
  if (!explicit) return null;
  if (explicit.tag !== EXPLICIT_0) throw new Malformed();
  const [data] = inside(b, explicit, 1);
  if (!data) throw new Malformed();
  const pieces: Uint8Array[] = [];
  octets(b, data, pieces);
  const out = new Uint8Array(pieces.reduce((n, piece) => n + piece.length, 0));
  let at = 0;
  for (const piece of pieces) {
    out.set(piece, at);
    at += piece.length;
  }
  return out;
}

/** Some systems hand out the envelope as base64 text, with or without "-----BEGIN PKCS7-----" lines. */
function fromBase64(bytes: Uint8Array): Uint8Array | null {
  let text = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    const chunk = bytes.subarray(i, i + 0x8000);
    if (chunk.some((x) => x > 0x7f)) return null;
    text += String.fromCharCode(...chunk);
  }
  const body = text.replace(/-----[A-Z0-9 ]+-----/g, "").replace(/\s+/g, "");
  if (!body || !/^[A-Za-z0-9+/]+={0,2}$/.test(body)) return null;
  try {
    return Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

/**
 * The file inside a signed envelope — an XML invoice, sometimes a PDF. A file
 * signed more than once is an envelope in an envelope: they are opened one
 * after the other.
 */
export function unwrapSigned(bytes: Uint8Array): Uint8Array {
  const binary = bytes[0] === SEQUENCE ? bytes : fromBase64(bytes);
  let current: Uint8Array | null;
  try {
    if (!binary) throw new Malformed();
    current = content(binary);
  } catch {
    throw new ImportError("We couldn't open this signed file (.p7m). It may be damaged.");
  }
  if (!current) throw new ImportError("This .p7m file holds only a signature, without the document inside. Upload the document itself.");
  for (let layer = 0; layer < 3 && current[0] === SEQUENCE; layer++) {
    let inner: Uint8Array | null;
    try {
      inner = content(current);
    } catch {
      break; // not another envelope: this is the document
    }
    if (!inner) break;
    current = inner;
  }
  return current;
}
