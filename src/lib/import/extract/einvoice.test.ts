import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { looksLikeEInvoice } from "../files";
import { eInvoiceToItems, issuedByUs, readEInvoice } from "./einvoice";
import { unwrapSigned } from "./p7m";
import { ImportError } from "./tabular";

const fixture = (name: string) => new Uint8Array(readFileSync(path.join(process.cwd(), "test-data", name)));
const xml = (s: string) => new TextEncoder().encode(s);
const INVOICE = fixture("scenario-i-fattura-elettronica.xml");
const text = new TextDecoder().decode(INVOICE);
/** The fixture with one piece of text replaced. */
const variant = (from: string, to: string) => {
  if (!text.includes(from)) throw new Error(`fixture has no "${from}"`);
  return xml(text.replace(from, to));
};

describe("electronic invoices (FatturaPA)", () => {
  test("every value comes from its own field", () => {
    const file = readEInvoice(INVOICE);
    expect(file.supplier).toEqual({ name: "ABC Srl", vat: "IT01234567890", taxCode: null, country: "Italy" });
    expect(file.customer.name).toBe("Cereria Cicogna");
    expect(file.invoices).toHaveLength(1);
    const [inv] = file.invoices;
    expect(inv).toMatchObject({ type: "TD01", number: "FE/2026/118", date: "2026-09-30", currency: "EUR", total: 4312.7, paymentTermsDays: 61 });
    expect(inv.lines.map((l) => [l.number, l.description, l.quantity, l.unit, l.unitPrice, l.total, l.code])).toEqual([
      [1, "Vs. ordine n. 123 del 01/09/2026 - DDT n. 456 del 28/09/2026", null, null, 0, 0, null],
      [2, "PARAFFINA 58/60 IN PASTIGLIE", 2000, "KG", 1.6, 3200, "PAR5860"],
      [3, "Stoppino cotone 120 mm & fondello", 10000, "PZ", 0.035, 315, "STP120"],
      [4, "Spese di trasporto", null, null, 20, 20, null],
    ]);
    expect(inv.lines[1].ean).toBe("8001234567890");
    expect(inv.lines[2].adjustments).toEqual(["SC 10.00%"]);
  });

  test("goods become lines to import; notes are skipped, transport is spread, discounts give the price paid", () => {
    const { items, freight, notes } = eInvoiceToItems(readEInvoice(INVOICE));
    expect(notes).toBe(1);
    expect(freight).toBe(20);
    expect(items.map((i) => [i.line, i.extracted.productName, i.extracted.quantity, i.extracted.unit, i.extracted.unitPrice, i.extracted.total, i.extracted.freight])).toEqual([
      [2, "PARAFFINA 58/60 IN PASTIGLIE", 2000, "kg", 1.6, 3200, 18.21],
      [3, "Stoppino cotone 120 mm & fondello", 10000, "pcs", 0.0315, 315, 1.79],
    ]);
    const [paraffin, wick] = items.map((i) => i.extracted);
    expect(paraffin).toMatchObject({ supplierName: "ABC Srl", supplierVat: "IT01234567890", supplierCountry: "Italy", supplierSku: "PAR5860", ean: "8001234567890", invoiceReference: "FE/2026/118", invoiceLine: 2, documentType: "TD01", date: "2026-09-30", currency: "EUR", fxRate: 1, paymentTermsDays: 61 });
    // The list price is said next to the price actually paid.
    expect(wick.parseIssues.find((i) => i.code === "unit_price_derived")?.message).toBe("Unit price after the discount on the line: 0,0315 (list price 0,035)");
    expect(paraffin.parseIssues.map((i) => i.code)).toEqual(["freight_allocated"]);
    // Read from fields, not interpreted: no confidence to doubt.
    expect(items.every((i) => i.confidence === null)).toBe(true);
    // What the line said in the file stays with it.
    expect(items[1].raw).toMatchObject({ Descrizione: "Stoppino cotone 120 mm & fondello", Quantita: "10000.00", PrezzoUnitario: "0.03500000", ScontoMaggiorazione: "SC 10.00%", PrezzoTotale: "315.00", CodiceArticolo: "FORNITORE STP120" });
  });

  test("what the format leaves out is asked, not filled in", () => {
    const unknownUnit = eInvoiceToItems(readEInvoice(variant("<UnitaMisura>KG</UnitaMisura>", "<UnitaMisura>FUSTI</UnitaMisura>"))).items[0].extracted;
    expect(unknownUnit).toMatchObject({ unit: null, unitRaw: "FUSTI" });
    expect(unknownUnit.parseIssues.find((i) => i.code === "unit_unknown")?.severity).toBe("blocking");
    const badNumber = eInvoiceToItems(readEInvoice(variant("<Quantita>2000.00</Quantita>", "<Quantita>2.000,00</Quantita>"))).items[0].extracted;
    expect(badNumber.quantity).toBeNull();
    expect(badNumber.parseIssues.find((i) => i.code === "invalid_number")?.message).toBe('Quantity: "2.000,00" is not a valid number');
    // Several instalments are not one number of days.
    const twoPayments = variant("</DettaglioPagamento>", "</DettaglioPagamento><DettaglioPagamento><ModalitaPagamento>MP05</ModalitaPagamento><DataScadenzaPagamento>2026-12-31</DataScadenzaPagamento><ImportoPagamento>1</ImportoPagamento></DettaglioPagamento>");
    expect(readEInvoice(twoPayments).invoices[0].paymentTermsDays).toBeNull();
  });

  test("documents that are not purchases are not imported as purchases", () => {
    const creditNote = variant("<TipoDocumento>TD01</TipoDocumento>", "<TipoDocumento>TD04</TipoDocumento>");
    expect(() => eInvoiceToItems(readEInvoice(creditNote))).toThrow("This is a credit note");
    // Other special documents are read, and flagged for a look.
    const selfInvoice = eInvoiceToItems(readEInvoice(variant("<TipoDocumento>TD01</TipoDocumento>", "<TipoDocumento>TD17</TipoDocumento>"))).items[0].extracted;
    expect(selfInvoice.parseIssues.find((i) => i.code === "document_type")).toMatchObject({ severity: "review", message: "Document type TD17: not an ordinary invoice — check that these lines are purchases before importing" });
    // A discount written on its own line is pointed out, not hidden.
    const withDiscountLine = variant("<DatiRiepilogo>", "<DettaglioLinee><NumeroLinea>5</NumeroLinea><TipoCessionePrestazione>SC</TipoCessionePrestazione><Descrizione>Sconto incondizionato</Descrizione><PrezzoUnitario>-50.00</PrezzoUnitario><PrezzoTotale>-50.00</PrezzoTotale><AliquotaIVA>22.00</AliquotaIVA></DettaglioLinee><DatiRiepilogo>");
    const discounted = eInvoiceToItems(readEInvoice(withDiscountLine)).items;
    expect(discounted).toHaveLength(2);
    expect(discounted[0].extracted.parseIssues.find((i) => i.code === "discount_not_applied")).toMatchObject({ severity: "review", message: "Discounts written on separate lines of this invoice (-50,00) are not included in the line prices" });
  });

  test("a sale is told from a purchase by who issued the invoice", () => {
    const file = readEInvoice(INVOICE);
    expect(issuedByUs(file, { names: ["Cereria Cicogna"], vats: [] })).toBe(false);
    expect(issuedByUs(file, { names: ["ABC S.r.l."], vats: [] })).toBe(true);
    expect(issuedByUs(file, { names: ["Altro nome"], vats: ["01234567890"] })).toBe(true);
    // Our VAT number is known and it is not the seller's: a name that resembles ours decides nothing.
    expect(issuedByUs(file, { names: ["ABC Srl"], vats: ["09876543210"] })).toBe(false);
  });

  test("files that are not electronic invoices are refused in plain words", () => {
    const refused = (bytes: Uint8Array) => {
      try {
        readEInvoice(bytes);
        return null;
      } catch (err) {
        return err instanceof ImportError ? err.message : `unexpected: ${String(err)}`;
      }
    };
    expect(refused(xml('<?xml version="1.0"?><ns2:FileMetadati xmlns:ns2="x"><NomeFile>a.xml</NomeFile></ns2:FileMetadati>'))).toBe("This XML file is not an electronic invoice.");
    expect(refused(xml("<p:FatturaElettronica><FatturaElettronicaHeader>"))).toBe("We couldn't read this XML file. It may be damaged.");
    expect(refused(xml('<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "b">]><x>&a;</x>'))).toBe("This XML file is not an electronic invoice.");
    expect(refused(xml('<p:FatturaElettronicaSemplificata versione="FSM10" xmlns:p="x"><FatturaElettronicaHeader/></p:FatturaElettronicaSemplificata>'))).toContain("simplified electronic invoice");
    expect(refused(new Uint8Array(0))).toBe("We couldn't read this XML file. It may be damaged.");
  });

  test("an invoice is recognised by its first element, whatever the prefix; other XML is not", () => {
    expect(looksLikeEInvoice(INVOICE)).toBe(true);
    expect(looksLikeEInvoice(xml('<?xml version="1.0"?>\n<!-- c -->\n<ns3:FatturaElettronica versione="FPA12">'))).toBe(true);
    expect(looksLikeEInvoice(xml("<FatturaElettronica>"))).toBe(true);
    expect(looksLikeEInvoice(xml('<?xml version="1.0"?><ns2:FileMetadati xmlns:ns2="http://www.fatturapa.gov.it/sdi/messaggi/v1.0">'))).toBe(false);
    expect(looksLikeEInvoice(xml("not xml at all"))).toBe(false);
  });

  test("an old encoding does not garble the names", () => {
    const latin1 = Uint8Array.from(text.replace('encoding="UTF-8"', 'encoding="ISO-8859-1"').replace("ABC Srl", "Società Cerè").split("").map((c) => c.charCodeAt(0)));
    expect(readEInvoice(latin1).supplier.name).toBe("Società Cerè");
  });
});

describe("signed files (.p7m)", () => {
  const len = (n: number) => (n < 0x80 ? [n] : n < 0x100 ? [0x81, n] : [0x82, n >> 8, n & 0xff]);
  const der = (tag: number, ...parts: number[][]) => {
    const body = parts.flat();
    return [tag, ...len(body.length), ...body];
  };
  const SIGNED_DATA = der(0x06, [0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x07, 0x02]);
  const DATA = der(0x06, [0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x07, 0x01]);
  /** A signed-data envelope around `content` (already wrapped as an OCTET STRING), or with no content at all. */
  const envelope = (content: number[] | null) =>
    Uint8Array.from(der(0x30, SIGNED_DATA, der(0xa0, der(0x30, der(0x02, [1]), der(0x31), der(0x30, DATA, ...(content ? [der(0xa0, content)] : [])), der(0x31)))));
  const payload = [...xml("<p:FatturaElettronica>ciao è</p:FatturaElettronica>")];
  const read = (bytes: Uint8Array) => new TextDecoder().decode(unwrapSigned(bytes));

  test("the document comes out of the envelope exactly as it went in", () => {
    expect(read(envelope(der(0x04, payload)))).toBe("<p:FatturaElettronica>ciao è</p:FatturaElettronica>");
    // A real file, signed with openssl: the same invoice as the unsigned fixture.
    expect(unwrapSigned(fixture("scenario-i-fattura-elettronica.xml.p7m"))).toEqual(INVOICE);
  });

  test("content written in pieces, with lengths left open (how signing tools write large files)", () => {
    const pieces = [0x24, 0x80, ...der(0x04, payload.slice(0, 10)), ...der(0x04, payload.slice(10, 25)), ...der(0x04, payload.slice(25)), 0, 0];
    const open = Uint8Array.from([0x30, 0x80, ...SIGNED_DATA, 0xa0, 0x80, 0x30, 0x80, ...der(0x02, [1]), ...der(0x31), 0x30, 0x80, ...DATA, 0xa0, 0x80, ...pieces, 0, 0, 0, 0, ...der(0x31), 0, 0, 0, 0, 0, 0]);
    expect(read(open)).toBe("<p:FatturaElettronica>ciao è</p:FatturaElettronica>");
  });

  test("an envelope handed out as base64 text, with or without its header lines", () => {
    const b64 = btoa(String.fromCharCode(...envelope(der(0x04, payload))));
    expect(read(xml(b64.replace(/(.{64})/g, "$1\r\n")))).toBe("<p:FatturaElettronica>ciao è</p:FatturaElettronica>");
    expect(read(xml(`-----BEGIN PKCS7-----\n${b64}\n-----END PKCS7-----\n`))).toBe("<p:FatturaElettronica>ciao è</p:FatturaElettronica>");
  });

  test("a file signed twice is opened twice; a signed PDF comes out as the PDF", () => {
    const inner = envelope(der(0x04, payload));
    expect(read(envelope(der(0x04, [...inner])))).toBe("<p:FatturaElettronica>ciao è</p:FatturaElettronica>");
    expect(read(envelope(der(0x04, [...xml("%PDF-1.7 ...")])))).toBe("%PDF-1.7 ...");
  });

  test("what can't be opened is refused in plain words, never searched for something that looks like XML", () => {
    expect(() => unwrapSigned(envelope(null))).toThrow("holds only a signature");
    expect(() => unwrapSigned(xml("<p:FatturaElettronica>not signed</p:FatturaElettronica>"))).toThrow("We couldn't open this signed file");
    expect(() => unwrapSigned(envelope(der(0x04, payload)).subarray(0, 40))).toThrow("We couldn't open this signed file");
    expect(() => unwrapSigned(new Uint8Array(0))).toThrow(ImportError);
  });
});
