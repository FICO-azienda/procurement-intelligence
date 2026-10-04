/**
 * What the import accepts. No dependencies: shared by the browser (what can
 * be chosen, what is taken out of a zip) and by the server.
 */

export const MAX_FILE_BYTES = 20 * 1024 * 1024;

/**
 * Readable as they are: PDF invoices and quotes, electronic invoices (XML,
 * also signed: .xml.p7m), spreadsheets. A zip is not one of them: it is
 * opened, and what it holds is what gets imported.
 */
export const IMPORT_EXTENSIONS = ["pdf", "xml", "p7m", "csv", "txt", "tsv", "xlsx", "xls", "ods"] as const;

export const extensionOf = (name: string) => (/\.([^./\\]+)$/.exec(name)?.[1] ?? "").toLowerCase();
export const isImportable = (name: string) => (IMPORT_EXTENSIONS as readonly string[]).includes(extensionOf(name));
/** By its name only: an Excel file is a zip inside, and must not be opened as one. */
export const isArchive = (name: string) => extensionOf(name) === "zip";

/** For the file picker. */
export const ACCEPT =
  [...IMPORT_EXTENSIONS, "zip"].map((e) => `.${e}`).join(",") + ",application/pdf,text/csv,application/xml,text/xml,application/pkcs7-mime,application/zip,application/x-zip-compressed";

/**
 * True when an XML file is an electronic invoice, told by its first element.
 * Invoice archives also carry XML that is not an invoice (the delivery
 * receipts and metadata of the exchange system): those are not sent to be read.
 */
export function looksLikeEInvoice(bytes: Uint8Array): boolean {
  const wide = (bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff);
  const head = wide ? new TextDecoder(bytes[0] === 0xff ? "utf-16le" : "utf-16be").decode(bytes.subarray(0, 8192)) : String.fromCharCode(...bytes.subarray(0, 4096));
  const root = /<(?![?!])(?:[\w.-]+:)?([\w.-]+)/.exec(head)?.[1];
  return root === "FatturaElettronica" || root === "FatturaElettronicaSemplificata";
}
