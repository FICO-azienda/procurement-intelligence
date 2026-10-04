import { describe, expect, test } from "vitest";
import { strToU8, zipSync, type Zippable } from "fflate";
import { translator } from "../i18n";
import { ArchiveError, decodeName, leftOutNotes, openArchive, type LeftOut } from "./archive";
import { SPREADSHEET_TYPES } from "./extract/tabular";
import { ACCEPT, IMPORT_EXTENSIONS, MAX_FILE_BYTES, extensionOf, isArchive, isImportable } from "./files";

const text = (s: string) => strToU8(s);
const zip = (files: Zippable) => zipSync(files);
const open = (bytes: Uint8Array) => openArchive(new Blob([bytes as Uint8Array<ArrayBuffer>]));
const read = async (bytes: Uint8Array, path: string) => {
  const file = (await open(bytes)).files.find((f) => f.path === path);
  if (!file) throw new Error(`${path} is not in the zip`);
  return new TextDecoder().decode(await file.read());
};

/** Changes the entry of one file in the zip's directory (and nothing else), to imitate zips made by other tools. */
function patch(bytes: Uint8Array, name: string, change: (view: DataView, at: number) => void): Uint8Array {
  const out = bytes.slice();
  const view = new DataView(out.buffer);
  for (let at = 0; at + 46 <= out.length; at++) {
    if (view.getUint32(at, true) !== 0x02014b50) continue;
    const length = view.getUint16(at + 28, true);
    if (new TextDecoder().decode(out.subarray(at + 46, at + 46 + length)) === name) change(view, at);
  }
  return out;
}

describe("files the import accepts", () => {
  test("the same list in the browser and on the server", () => {
    expect([...IMPORT_EXTENSIONS].sort()).toEqual(["pdf", "xml", "p7m", "txt", "tsv", ...SPREADSHEET_TYPES].sort());
    for (const e of [...IMPORT_EXTENSIONS, "zip"]) expect(ACCEPT).toContain(`.${e}`);
  });

  test("a file is what its name says", () => {
    expect(extensionOf("Fattura 12.PDF")).toBe("pdf");
    expect(extensionOf("senza estensione")).toBe("");
    expect(extensionOf("cartella.v2/senza")).toBe("");
    expect(isImportable("listino.XLSX")).toBe(true);
    expect(isImportable("fattura.xml")).toBe(true);
    expect(isImportable("IT01234567890_00001.xml.p7m")).toBe(true);
    expect(isImportable("foto.jpg")).toBe(false);
    expect(isArchive("Fatture 2026.ZIP")).toBe(true);
    // An Excel file is a zip inside: it is a spreadsheet, not an archive to open.
    expect(isArchive("listino.xlsx")).toBe(false);
  });
});

describe("opening a zip", () => {
  test("lists the files the import can read, wherever they sit, in the order of their path", async () => {
    const bytes = zip({
      "fatture/settembre/fattura-10.pdf": text("%PDF dieci"),
      "fatture/settembre/fattura-2.pdf": text("%PDF due"),
      "fatture/acquisti.csv": text("data;quantita\n2026-09-01;10\n"),
      "listino.xlsx": [text("PK listino"), { level: 0 }],
    });
    const { files, leftOut } = await open(bytes);
    expect(files.map((f) => f.path)).toEqual(["fatture/acquisti.csv", "fatture/settembre/fattura-2.pdf", "fatture/settembre/fattura-10.pdf", "listino.xlsx"]);
    expect(files.map((f) => f.name)).toEqual(["acquisti.csv", "fattura-2.pdf", "fattura-10.pdf", "listino.xlsx"]);
    expect(files[0].size).toBe(28);
    expect(leftOut).toEqual([]);
  });

  test("gives back each file exactly as it went in, compressed or not", async () => {
    const long = "riga;di;prova\n".repeat(5000);
    const bytes = zip({ "compresso.csv": text(long), "non-compresso.csv": [text(long), { level: 0 }], "vuoto.csv": new Uint8Array(0) });
    expect(bytes.length).toBeLessThan(long.length * 1.5); // the first one really is compressed
    expect(await read(bytes, "compresso.csv")).toBe(long);
    expect(await read(bytes, "non-compresso.csv")).toBe(long);
    expect(await read(bytes, "vuoto.csv")).toBe("");
  });

  test("ignores folders and the files operating systems add on their own", async () => {
    const bytes = zip({
      "Fatture/": new Uint8Array(0),
      "Fatture/fattura.pdf": text("%PDF"),
      "__MACOSX/Fatture/._fattura.pdf": text("resource fork"),
      "Fatture/.DS_Store": text("x"),
      "Fatture/Thumbs.db": text("x"),
      "Fatture/desktop.ini": text("x"),
      "Fatture/~$listino.xlsx": text("lock"),
    });
    const { files, leftOut } = await open(bytes);
    expect(files.map((f) => f.path)).toEqual(["Fatture/fattura.pdf"]);
    expect(leftOut).toEqual([]);
  });

  test("says what it left out, and why", async () => {
    let bytes: Uint8Array = zip({
      "fattura.pdf": text("%PDF"),
      "IT01234567890_abc.xml": text('<?xml version="1.0"?><p:FatturaElettronica versione="FPR12" xmlns:p="http://ivaservizi.agenziaentrate.gov.it/docs/xsd/fatture/v1.2"></p:FatturaElettronica>'),
      "IT01234567890_abc_metaDato.xml": text('<?xml version="1.0"?><ns2:FileMetadati xmlns:ns2="http://www.fatturapa.gov.it/sdi/messaggi/v1.0"></ns2:FileMetadati>'),
      "foto.jpg": text("jpeg"),
      "enorme.pdf": new Uint8Array(MAX_FILE_BYTES + 1),
      "segreta.pdf": text("%PDF segreta"),
      "strana.pdf": text("%PDF strana"),
    });
    bytes = patch(bytes, "segreta.pdf", (v, at) => v.setUint16(at + 8, v.getUint16(at + 8, true) | 1, true)); // encrypted
    bytes = patch(bytes, "strana.pdf", (v, at) => v.setUint16(at + 10, 14, true)); // a compression this reader doesn't know (LZMA)
    const { files, leftOut } = await open(bytes);
    // An XML invoice goes through; XML that is not an invoice (the exchange system's receipts) does not.
    expect(files.map((f) => f.name)).toEqual(["fattura.pdf", "IT01234567890_abc.xml"]);
    expect(Object.fromEntries(leftOut.map((x) => [x.name, x.reason]))).toEqual({
      "IT01234567890_abc_metaDato.xml": "not_invoice",
      "foto.jpg": "unsupported",
      "enorme.pdf": "too_large",
      "segreta.pdf": "protected",
      "strana.pdf": "unreadable",
    });
  });

  test("opens a zip inside a zip, but not without end", async () => {
    const level3 = zip({ "troppo-in-fondo.pdf": text("%PDF") });
    const level2 = zip({ "ottobre.pdf": text("%PDF ottobre"), "ancora.zip": level3 });
    const level1 = zip({ "settembre.pdf": text("%PDF settembre"), "altro.zip": level2 });
    const bytes = zip({ "2026/mesi.zip": level1, "rotto.zip": text("this is not a zip") });
    const { files, leftOut } = await open(bytes);
    expect(files.map((f) => f.path)).toEqual(["2026/mesi.zip › altro.zip › ottobre.pdf", "2026/mesi.zip › settembre.pdf"]);
    expect(await read(bytes, "2026/mesi.zip › altro.zip › ottobre.pdf")).toBe("%PDF ottobre");
    expect(leftOut).toEqual([
      { name: "ancora.zip", path: "2026/mesi.zip › altro.zip › ancora.zip", reason: "unreadable" },
      { name: "rotto.zip", path: "rotto.zip", reason: "unreadable" },
    ]);
  });

  test("reads names with accents however the zip wrote them", async () => {
    // Flagged as UTF-8 (what most tools do).
    expect((await open(zip({ "Società è già.pdf": text("%PDF") }))).files[0].name).toBe("Società è già.pdf");
    // UTF-8 without the flag, and accents split in two (macOS).
    const mac = patch(zip({ "Società.pdf": text("%PDF") }), "Società.pdf", (v, at) => v.setUint16(at + 8, v.getUint16(at + 8, true) & ~0x800, true));
    expect((await open(mac)).files[0].name).toBe("Società.pdf");
    // The old DOS encoding (code page 437), when the name is not UTF-8.
    expect(decodeName(Uint8Array.from([0x53, 0x6f, 0x63, 0x69, 0x65, 0x74, 0x85, 0x2e, 0x70, 0x64, 0x66]))).toBe("Società.pdf");
    expect(decodeName(Uint8Array.from([0x8a, 0x82, 0x8d, 0x95, 0x97, 0xff]))).toBe("èéìòù ");
    // Backslashes as folder separators (old Windows tools).
    expect((await open(zip({ "Fatture\\2026\\a.pdf": text("%PDF") }))).files[0]).toMatchObject({ name: "a.pdf", path: "Fatture/2026/a.pdf" });
  });

  test("large-zip records (ZIP64) are understood", async () => {
    // Written by Python's zipfile with every size forced into the ZIP64 fields.
    const zip64 = Uint8Array.from(
      atob(
        "UEsDBC0AAAAIAAZvQ1083RDt//////////8TABQAZ3JhbmRlL2FjcXVpc3RpLmNzdgEAEABEAAAAAAAAAEUAAAAAAAAAS0ksSbROyy/KyyzJL0q1LijKT8kvKcm3LixNzCvJBMoVFKVWVeVzGRkYmekaWOoaGFo7OjlbO6cWJVobGlgb6phacAEAUEsBAi0DLQAAAAgABm9DXTzdEO3//////////xMAFAAAAAAAAAAAAIABAAAAAGdyYW5kZS9hY3F1aXN0aS5jc3YBABAARAAAAAAAAABFAAAAAAAAAFBLBgYsAAAAAAAAAC0ALQAAAAAAAAAAAAEAAAAAAAAAAQAAAAAAAABVAAAAAAAAAIoAAAAAAAAAUEsGBwAAAADfAAAAAAAAAAEAAABQSwUGAAAAAAEAAQBVAAAAigAAAAAA",
      ),
      (c) => c.charCodeAt(0),
    );
    const expected = "data;fornitore;prodotto;quantita;prezzo\n2026-09-01;ABC;Cera;10;1,58\n";
    expect(await read(zip64, "grande/acquisti.csv")).toBe(expected);
    // The same zip as a tool would write it past 4 GB: the short record says only "look in the long one".
    const overflowed = zip64.slice();
    const view = new DataView(overflowed.buffer);
    const end = overflowed.length - 22;
    view.setUint16(end + 8, 0xffff, true);
    view.setUint16(end + 10, 0xffff, true);
    view.setUint32(end + 12, 0xffffffff, true);
    view.setUint32(end + 16, 0xffffffff, true);
    expect(await read(overflowed, "grande/acquisti.csv")).toBe(expected);
  });

  test("a zip with something in front of it (self-extracting) still opens", async () => {
    const bytes = zip({ "a.csv": text("uno;due\n1;2\n") });
    const prefixed = new Uint8Array(1000 + bytes.length);
    prefixed.set(bytes, 1000);
    expect(await read(prefixed, "a.csv")).toBe("uno;due\n1;2\n");
  });

  test("an empty zip is opened and holds nothing", async () => {
    expect(await open(zip({}))).toEqual({ files: [], leftOut: [] });
  });

  test("what is not a zip, or is cut short, is refused as a whole", async () => {
    await expect(open(text("%PDF-1.7 this is a PDF called .zip"))).rejects.toBeInstanceOf(ArchiveError);
    await expect(open(new Uint8Array(0))).rejects.toBeInstanceOf(ArchiveError);
    const bytes = zip({ "a.pdf": text("%PDF a"), "b.pdf": text("%PDF b") });
    await expect(open(bytes.subarray(0, bytes.length - 30))).rejects.toBeInstanceOf(ArchiveError);
    // The directory points outside the file.
    const lost = bytes.slice();
    new DataView(lost.buffer).setUint32(lost.length - 22 + 16, 0x7fffffff, true);
    await expect(open(lost)).rejects.toBeInstanceOf(ArchiveError);
  });

  test("a damaged file inside is caught when it is read, and the others are not affected", async () => {
    const long = "riga;di;prova\n".repeat(2000);
    const bytes = zip({ "a.csv": text(long), "b.csv": [text(long), { level: 0 }], "c.csv": text("sano\n") });
    const damaged = bytes.slice();
    damaged[60] ^= 0xff; // inside a.csv's compressed data
    damaged[bytes.indexOf(0x72, 300) + 4000] ^= 0xff; // further on, inside b.csv
    const { files } = await open(damaged);
    const [a, b, c] = files;
    await expect(a.read()).rejects.toBeInstanceOf(ArchiveError);
    await expect(b.read()).rejects.toBeInstanceOf(ArchiveError);
    expect(new TextDecoder().decode(await c.read())).toBe("sano\n");
  });

  test("a file that unpacks to more than it declares is refused, not unpacked", async () => {
    const bomb = patch(zip({ "piccolo.csv": new Uint8Array(5_000_000) }), "piccolo.csv", (v, at) => v.setUint32(at + 24, 100, true));
    const { files } = await open(bomb);
    expect(files[0].size).toBe(100);
    await expect(files[0].read()).rejects.toBeInstanceOf(ArchiveError);
  });
});

describe("saying what was left out", () => {
  const it = translator("it");
  const out = (name: string, reason: LeftOut["reason"]): LeftOut => ({ name, path: name, reason });

  test("one sentence per reason, with the names", () => {
    expect(leftOutNotes([])).toEqual([]);
    expect(leftOutNotes([out("foto.jpg", "unsupported")])).toEqual(["1 file in the zip is not a PDF, XML, Excel or CSV file and was left out: foto.jpg."]);
    expect(leftOutNotes([out("a.pdf", "protected"), out("b.pdf", "protected"), out("c.pdf", "too_large"), out("d.pdf", "unreadable")])).toEqual([
      "1 file in the zip is larger than 20 MB and was left out: c.pdf.",
      "2 files in the zip are protected by a password and were left out: a.pdf, b.pdf. Unzip it on your computer with the password, then upload the files.",
      "1 file in the zip couldn't be opened and was left out: d.pdf.",
    ]);
  });

  test("a long list names the first few and counts the rest", () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => out(`foto-${i + 1}.jpg`, "unsupported"));
    expect(leftOutNotes(many(4))[0]).toBe("4 files in the zip are not PDF, XML, Excel or CSV files and were left out: foto-1.jpg, foto-2.jpg, foto-3.jpg and one more.");
    expect(leftOutNotes(many(1203))[0]).toBe("1.203 files in the zip are not PDF, XML, Excel or CSV files and were left out: foto-1.jpg, foto-2.jpg, foto-3.jpg and 1.200 more.");
    expect(leftOutNotes(many(4), it)[0]).toBe("4 file nello zip non sono PDF, XML, Excel o CSV e sono rimasti fuori: foto-1.jpg, foto-2.jpg, foto-3.jpg e un altro.");
    expect(leftOutNotes(many(9), it)[0]).toBe("9 file nello zip non sono PDF, XML, Excel o CSV e sono rimasti fuori: foto-1.jpg, foto-2.jpg, foto-3.jpg e altri 6.");
  });

  test("XML that is not an invoice is said apart from files of the wrong type", () => {
    const notes = leftOutNotes([out("IT01234567890_00001_metaDato.xml", "not_invoice"), out("IT01234567890_00002_metaDato.xml", "not_invoice"), out("foto.jpg", "unsupported")], it);
    expect(notes).toEqual([
      "1 file nello zip non è un PDF, XML, Excel o CSV ed è rimasto fuori: foto.jpg.",
      "2 file XML nello zip non sono fatture e sono rimasti fuori: IT01234567890_00001_metaDato.xml, IT01234567890_00002_metaDato.xml.",
    ]);
  });

  test("a file name is shown as the file is called", () => {
    expect(leftOutNotes([out("Foto del 8 settembre.jpg", "unsupported")], it)[0]).toContain("Foto del 8 settembre.jpg");
  });
});
