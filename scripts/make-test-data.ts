/**
 * Generates the import test files in test-data/ (scenarios A–H + a PDF quote).
 * Run: npx tsx scripts/make-test-data.ts
 * They work against the demo dataset (npm run db:reset).
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { strToU8, zipSync } from "fflate";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import * as XLSX from "xlsx";

const OUT = path.join(process.cwd(), "test-data");
mkdirSync(OUT, { recursive: true });
const write = (name: string, content: string | Uint8Array) => {
  writeFileSync(path.join(OUT, name), content);
  console.log("wrote", name);
};

// A — perfect CSV: English headers, SKUs, all known. 10 purchases at current prices.
write(
  "scenario-a-perfect.csv",
  [
    "Date,Supplier,SKU,Product,Quantity,Unit,Unit Price,Currency,Invoice",
    "2026-09-24,ABC Srl,PAR-5860,Paraffina 58/60,1000,kg,1.58,EUR,FT 2026/0901",
    "2026-09-24,ABC Srl,PAR-5860,Paraffina 58/60,1000,kg,1.58,EUR,FT 2026/0902",
    "2026-09-25,Vetreria Rossi,GLS-300,Vetro Trasparente 300 ml,5000,pcs,1.18,EUR,FT 2026/0903",
    "2026-09-25,Vetreria Rossi,GLS-300,Vetro Trasparente 300 ml,4000,pcs,1.18,EUR,FT 2026/0904",
    "2026-09-26,Filati Italia,WCK-120,Stoppino Cotone 120 mm,30000,pcs,0.074,EUR,FT 2026/0905",
    "2026-09-26,Essenza Italia,FRG-INC,Fragranza Incenso,100,kg,31.00,EUR,FT 2026/0906",
    "2026-09-27,Essenza Italia,FRG-INC,Fragranza Incenso,75,kg,31.00,EUR,FT 2026/0907",
    "2026-09-28,Pack Solutions,BOX-HC,Scatola Home Collection,8000,pcs,0.46,EUR,FT 2026/0908",
    "2026-09-28,Pack Solutions,BOX-HC,Scatola Home Collection,6000,pcs,0.46,EUR,FT 2026/0909",
    "2026-09-29,ABC Srl,PAR-5860,Paraffina 58/60,1500,kg,1.58,EUR,FT 2026/0910",
  ].join("\n") + "\n",
);

// B — Italian CSV as saved by Excel: ";" separator, comma decimals, Windows-1252.
const b = [
  "Data;Fornitore;Descrizione;Quantità;Prezzo",
  "22/09/2026;Essenza Italia;Fragranza Incenso;50;31,00",
  "23/09/2026;Pack Solutions;Scatola Home Collection;5.000;0,46",
  "23/09/2026;Filati Italia;Stoppino Cotone 120 mm;20.000;0,074",
].join("\r\n");
write("scenario-b-italiano.csv", new Uint8Array([...b].map((c) => (c === "à" ? 0xe0 : c.charCodeAt(0)))));

// C — supplier written differently: "ABC S.r.l." for "ABC Srl".
write(
  "scenario-c-fornitore.csv",
  ["Data fattura;Nome fornitore;Codice;Descrizione;Qta;Prezzo unitario;Numero fattura", "20/09/2026;ABC S.r.l.;PAR-5860;Paraffina 58/60;1.000;1,58;FT 2026/0950"].join("\n") + "\n",
);

// D — product written differently: "PARAFFIN WAX 58/60" for "Paraffina 58/60".
write(
  "scenario-d-alias.csv",
  ["Invoice Date,Vendor,Item,Qty,Unit Price,Currency,Invoice", "09/21/2026,ABC Srl,PARAFFIN WAX 58/60,500,1.58,EUR,INV-2026-77"].join("\n") + "\n",
);

// E — Excel with a new product (and real date/number cells).
{
  const rows = [
    ["Acquisti settembre 2026"],
    [],
    ["Data", "Fornitore", "Descrizione articolo", "Q.tà", "U.M.", "Prezzo unitario", "Importo"],
    [new Date(2026, 8, 18), "Vetreria Rossi", "Glass Jar Green 500 ml", 3000, "pz", 1.42, 4260],
    [new Date(2026, 8, 18), "Vetreria Rossi", "Vetro Trasparente 300 ml", 2000, "pz", 1.18, 2360],
  ];
  const ws = XLSX.utils.aoa_to_sheet(rows, { cellDates: true });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Acquisti");
  write("scenario-e-nuovo-prodotto.xlsx", XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
}

// G — price increases: paraffin €1,58 → €1,64 (+3,8%), glass €1,18 → €1,25 (+5,9%).
write(
  "scenario-g-aumento-prezzi.csv",
  [
    "Data;Fornitore;Codice;Descrizione;Quantità;UM;Prezzo;Fattura",
    "29/09/2026;ABC Srl;PAR-5860;Paraffina 58/60;2.000;kg;1,64;FT 2026/0990",
    "29/09/2026;Vetreria Rossi;GLS-300;Vetro Trasparente 300 ml;6.000;pz;1,25;FT 2026/0991",
  ].join("\n") + "\n",
);

// ---------------- PDFs ----------------

function text(page: PDFPage, font: PDFFont, s: string, x: number, y: number, size = 9) {
  page.drawText(s, { x, y, size, font, color: rgb(0.1, 0.1, 0.1) });
}
function right(page: PDFPage, font: PDFFont, s: string, xRight: number, y: number, size = 9) {
  text(page, font, s, xRight - font.widthOfTextAtSize(s, size), y, size);
}

async function invoicePdf() {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595, 842]);
  const f = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  text(page, bold, "ABC S.r.l.", 40, 790, 14);
  text(page, f, "Via dell'Industria 12 - 20100 Milano (MI)", 40, 774);
  text(page, f, "P.IVA IT09876543210 - Tel. 02 1234 5678", 40, 762);
  text(page, f, "Spett.le", 340, 740);
  text(page, bold, "Cereria Cicogna", 340, 728);
  text(page, f, "Via Roma 1 - Verona", 340, 716);
  text(page, bold, "FATTURA N. 2026/481 del 25/09/2026", 40, 680, 12);
  const y0 = 640;
  const cols = { code: 40, desc: 110, qty: 360, um: 395, price: 470, amount: 550 };
  text(page, bold, "Codice", cols.code, y0);
  text(page, bold, "Descrizione", cols.desc, y0);
  right(page, bold, "Q.tà", cols.qty + 20, y0);
  text(page, bold, "U.M.", cols.um, y0);
  right(page, bold, "Prezzo", cols.price, y0);
  right(page, bold, "Importo", cols.amount, y0);
  const lines = [
    ["AB-PAR58", "Paraffina raffinata 58-60 pastiglie", "2.000", "kg", "1,64", "3.280,00"],
    ["AB-PAR58S", "Paraffina 58/60 sacco 25 kg", "500", "kg", "1,64", "820,00"],
  ];
  lines.forEach((l, i) => {
    const y = y0 - 20 - i * 16;
    text(page, f, l[0], cols.code, y);
    text(page, f, l[1], cols.desc, y);
    right(page, f, l[2], cols.qty + 20, y);
    text(page, f, l[3], cols.um, y);
    right(page, f, l[4], cols.price, y);
    right(page, f, l[5], cols.amount, y);
  });
  text(page, f, "Spese di trasporto", cols.desc, y0 - 60);
  right(page, f, "60,00", cols.amount, y0 - 60);
  text(page, bold, "Imponibile", 400, y0 - 100);
  right(page, bold, "4.160,00", cols.amount, y0 - 100);
  text(page, f, "IVA 22%", 400, y0 - 116);
  right(page, f, "915,20", cols.amount, y0 - 116);
  text(page, bold, "Totale fattura EUR", 400, y0 - 132);
  right(page, bold, "5.075,20", cols.amount, y0 - 132);
  text(page, f, "Pagamento: Bonifico bancario 60 gg d.f.f.m.", 40, y0 - 170);
  text(page, f, "IBAN IT60X0542811101000000123456", 40, y0 - 184);
  write("scenario-f-fattura-abc.pdf", await pdf.save());
}

async function quotePdf() {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595, 842]);
  const f = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  text(page, bold, "Turkish Wax Ltd", 40, 790, 14);
  text(page, f, "Kemalpasa OSB, 35730 Izmir - Turkey", 40, 774);
  text(page, f, "VAT No TR8390012345", 40, 762);
  text(page, f, "To: Cereria Cicogna, Verona - Italy", 340, 740);
  text(page, bold, "QUOTATION No. TW-Q-2291", 40, 700, 12);
  text(page, f, "Quote date: 28/09/2026", 40, 684);
  text(page, f, "Valid until: 31/10/2026", 40, 670);
  const y0 = 630;
  text(page, bold, "Item code", 40, y0);
  text(page, bold, "Description", 120, y0);
  right(page, bold, "Unit price", 520, y0);
  text(page, f, "TW-5860", 40, y0 - 20);
  text(page, f, "Paraffin Wax 58/60 fully refined, slabs", 120, y0 - 20);
  right(page, f, "EUR 1,29 /kg", 520, y0 - 20);
  text(page, f, "Minimum order quantity: 5.000 kg", 40, y0 - 60);
  text(page, f, "Lead time: 4 weeks", 40, y0 - 74);
  text(page, f, "Payment terms: 100% advance payment", 40, y0 - 88);
  text(page, f, "Delivery terms: FOB Izmir (Incoterms 2020)", 40, y0 - 102);
  text(page, f, "Freight: not included", 40, y0 - 116);
  write("quote-turkish-wax.pdf", await pdf.save());
}

// I — an Italian electronic invoice (FatturaPA), as it comes from the exchange system: a line with a
// discount, a note without amounts, transport charged apart. And the same file signed (.p7m).
const E_INVOICE = `<?xml version="1.0" encoding="UTF-8"?>
<?xml-stylesheet type="text/xsl" href="fatturaordinaria_v1.2.1.xsl"?>
<p:FatturaElettronica versione="FPR12" xmlns:p="http://ivaservizi.agenziaentrate.gov.it/docs/xsd/fatture/v1.2" xmlns:ds="http://www.w3.org/2000/09/xmldsig#">
  <FatturaElettronicaHeader>
    <DatiTrasmissione>
      <IdTrasmittente><IdPaese>IT</IdPaese><IdCodice>01234567890</IdCodice></IdTrasmittente>
      <ProgressivoInvio>00118</ProgressivoInvio>
      <FormatoTrasmissione>FPR12</FormatoTrasmissione>
      <CodiceDestinatario>0000000</CodiceDestinatario>
    </DatiTrasmissione>
    <CedentePrestatore>
      <DatiAnagrafici>
        <IdFiscaleIVA><IdPaese>IT</IdPaese><IdCodice>01234567890</IdCodice></IdFiscaleIVA>
        <Anagrafica><Denominazione>ABC Srl</Denominazione></Anagrafica>
        <RegimeFiscale>RF01</RegimeFiscale>
      </DatiAnagrafici>
      <Sede><Indirizzo>Via delle Industrie 12</Indirizzo><CAP>20100</CAP><Comune>Milano</Comune><Provincia>MI</Provincia><Nazione>IT</Nazione></Sede>
    </CedentePrestatore>
    <CessionarioCommittente>
      <DatiAnagrafici>
        <IdFiscaleIVA><IdPaese>IT</IdPaese><IdCodice>09876543210</IdCodice></IdFiscaleIVA>
        <Anagrafica><Denominazione>Cereria Cicogna</Denominazione></Anagrafica>
      </DatiAnagrafici>
      <Sede><Indirizzo>Via Roma 1</Indirizzo><CAP>37100</CAP><Comune>Verona</Comune><Provincia>VR</Provincia><Nazione>IT</Nazione></Sede>
    </CessionarioCommittente>
  </FatturaElettronicaHeader>
  <FatturaElettronicaBody>
    <DatiGenerali>
      <DatiGeneraliDocumento>
        <TipoDocumento>TD01</TipoDocumento>
        <Divisa>EUR</Divisa>
        <Data>2026-09-30</Data>
        <Numero>FE/2026/118</Numero>
        <ImportoTotaleDocumento>4312.70</ImportoTotaleDocumento>
      </DatiGeneraliDocumento>
    </DatiGenerali>
    <DatiBeniServizi>
      <DettaglioLinee>
        <NumeroLinea>1</NumeroLinea>
        <Descrizione>Vs. ordine n. 123 del 01/09/2026 - DDT n. 456 del 28/09/2026</Descrizione>
        <PrezzoUnitario>0.00</PrezzoUnitario>
        <PrezzoTotale>0.00</PrezzoTotale>
        <AliquotaIVA>22.00</AliquotaIVA>
      </DettaglioLinee>
      <DettaglioLinee>
        <NumeroLinea>2</NumeroLinea>
        <CodiceArticolo><CodiceTipo>FORNITORE</CodiceTipo><CodiceValore>PAR5860</CodiceValore></CodiceArticolo>
        <CodiceArticolo><CodiceTipo>EAN</CodiceTipo><CodiceValore>8001234567890</CodiceValore></CodiceArticolo>
        <Descrizione>PARAFFINA 58/60 IN PASTIGLIE</Descrizione>
        <Quantita>2000.00</Quantita>
        <UnitaMisura>KG</UnitaMisura>
        <PrezzoUnitario>1.60000000</PrezzoUnitario>
        <PrezzoTotale>3200.00</PrezzoTotale>
        <AliquotaIVA>22.00</AliquotaIVA>
      </DettaglioLinee>
      <DettaglioLinee>
        <NumeroLinea>3</NumeroLinea>
        <CodiceArticolo><CodiceTipo>FORNITORE</CodiceTipo><CodiceValore>STP120</CodiceValore></CodiceArticolo>
        <Descrizione>Stoppino cotone 120 mm &amp; fondello</Descrizione>
        <Quantita>10000.00</Quantita>
        <UnitaMisura>PZ</UnitaMisura>
        <PrezzoUnitario>0.03500000</PrezzoUnitario>
        <ScontoMaggiorazione><Tipo>SC</Tipo><Percentuale>10.00</Percentuale></ScontoMaggiorazione>
        <PrezzoTotale>315.00</PrezzoTotale>
        <AliquotaIVA>22.00</AliquotaIVA>
      </DettaglioLinee>
      <DettaglioLinee>
        <NumeroLinea>4</NumeroLinea>
        <TipoCessionePrestazione>AC</TipoCessionePrestazione>
        <Descrizione>Spese di trasporto</Descrizione>
        <PrezzoUnitario>20.00</PrezzoUnitario>
        <PrezzoTotale>20.00</PrezzoTotale>
        <AliquotaIVA>22.00</AliquotaIVA>
      </DettaglioLinee>
      <DatiRiepilogo><AliquotaIVA>22.00</AliquotaIVA><ImponibileImporto>3535.00</ImponibileImporto><Imposta>777.70</Imposta></DatiRiepilogo>
    </DatiBeniServizi>
    <DatiPagamento>
      <CondizioniPagamento>TP02</CondizioniPagamento>
      <DettaglioPagamento><ModalitaPagamento>MP05</ModalitaPagamento><DataScadenzaPagamento>2026-11-30</DataScadenzaPagamento><ImportoPagamento>4312.70</ImportoPagamento></DettaglioPagamento>
    </DatiPagamento>
  </FatturaElettronicaBody>
</p:FatturaElettronica>
`;
/** What the exchange system adds next to each invoice: XML, but not an invoice. */
const METADATA = `<?xml version="1.0" encoding="UTF-8"?><ns2:FileMetadati xmlns:ns2="http://www.fatturapa.gov.it/sdi/messaggi/v1.0" versione="1.0"><IdentificativoSdI>111</IdentificativoSdI><NomeFile>IT01234567890_00118.xml</NomeFile></ns2:FileMetadati>`;

function eInvoice() {
  write("scenario-i-fattura-elettronica.xml", E_INVOICE);
  // Signed like the files suppliers send (.xml.p7m): needs openssl; skipped where it is not installed.
  const dir = mkdtempSync(path.join(tmpdir(), "p7m-"));
  try {
    const key = path.join(dir, "key.pem");
    const cert = path.join(dir, "cert.pem");
    execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", key, "-out", cert, "-days", "3650", "-subj", "/CN=ABC Srl (test)"], { stdio: "ignore" });
    execFileSync("openssl", ["smime", "-sign", "-binary", "-nodetach", "-outform", "DER", "-in", path.join(OUT, "scenario-i-fattura-elettronica.xml"), "-signer", cert, "-inkey", key, "-out", path.join(OUT, "scenario-i-fattura-elettronica.xml.p7m")], { stdio: "ignore" });
    console.log("wrote", "scenario-i-fattura-elettronica.xml.p7m");
  } catch {
    console.log("skipped scenario-i-fattura-elettronica.xml.p7m (openssl not available)");
  }
}

// H — a zip, as a folder of documents arrives: an invoice, a quote in a subfolder, a spreadsheet,
// an electronic invoice in XML, and two files the import leaves out and must say so.
function archive() {
  const file = (name: string) => new Uint8Array(readFileSync(path.join(OUT, name)));
  const files = {
    "Fatture settembre/Fattura ABC del 8 settembre.pdf": file("scenario-f-fattura-abc.pdf"),
    "Fatture settembre/preventivi/quote-turkish-wax.pdf": file("quote-turkish-wax.pdf"),
    "Fatture settembre/nuovo-prodotto.xlsx": file("scenario-e-nuovo-prodotto.xlsx"),
    "Fatture settembre/IT01234567890_00118.xml": file("scenario-i-fattura-elettronica.xml"),
    "Fatture settembre/IT01234567890_00118_metaDato.xml": strToU8(METADATA),
    "Fatture settembre/foto-bancale.jpg": strToU8("not a document"),
  };
  write("scenario-h-fatture.zip", zipSync(files, { mtime: new Date(2026, 9, 1) }));
}

Promise.all([invoicePdf(), quotePdf()]).then(eInvoice).then(archive).catch((err) => {
  console.error(err);
  process.exit(1);
});
