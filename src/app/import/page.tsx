import type { Metadata } from "next";
import { Download, FileSpreadsheet, FileText, Mail, ReceiptText } from "lucide-react";
import { CsvImport, DataControls } from "@/components/csv-import";
import { Basis, PageHeader, Section } from "@/components/ui";
import { getDataset } from "@/lib/data";
import { TEMPLATE_COLUMNS } from "@/lib/import/purchases-csv";
import { plural } from "@/lib/lookups";

export const metadata: Metadata = { title: "Import" };

const NEXT = [
  {
    icon: FileSpreadsheet,
    title: "Excel (.xlsx)",
    body: "Upload the spreadsheet directly. Today: in Excel use File → Save as → CSV, then import above.",
  },
  {
    icon: ReceiptText,
    title: "PDF invoice",
    body: "Supplier, product, quantity, unit price, freight and payment terms extracted from the invoice.",
  },
  {
    icon: FileText,
    title: "PDF quote / price list",
    body: "Offers and price lists become quotes, with MOQ, lead time and validity.",
  },
  {
    icon: Mail,
    title: "Supplier emails",
    body: "Price increases, quotes and lead-time changes detected in Gmail or Outlook.",
  },
];

export default async function ImportPage() {
  const data = await getDataset();
  const demoPurchases = data.purchases.filter((p) => p.source === "demo").length;
  const counts = [
    plural(data.products.length, "product"),
    plural(data.suppliers.length, "supplier"),
    plural(data.purchases.length, "purchase"),
    plural(data.quotes.length, "quote"),
  ].join(", ");

  return (
    <>
      <PageHeader title="Import" meta="Bring in your real purchasing data. Every import is previewed before anything is saved." />

      <Section
        title="Purchases from CSV"
        description="Export purchase lines from your accounting software or ERP and import them here. Missing suppliers and products are created automatically."
        actions={
          <a href="/templates/purchases-template.csv" download className="inline-flex items-center gap-1.5 text-[13px] font-medium text-ledger hover:underline">
            <Download size={14} /> Template
          </a>
        }
      >
        <CsvImport />
        <details className="mt-4 text-[12.5px] text-ink-3">
          <summary className="cursor-pointer font-medium text-ink-2 select-none">Columns</summary>
          <p className="mt-2">
            Required: <code className="font-mono text-ink-2">date, supplier, quantity, unit_price</code> and{" "}
            <code className="font-mono text-ink-2">sku</code> or <code className="font-mono text-ink-2">product</code>{" "}
            (<code className="font-mono text-ink-2">unit</code> for new products). Optional:{" "}
            <code className="font-mono text-ink-2">
              {TEMPLATE_COLUMNS.filter((c) => !["date", "supplier", "quantity", "unit_price", "sku", "product", "unit"].includes(c)).join(", ")}
            </code>
            . Italian headers work too (data, fornitore, codice, descrizione, quantità, prezzo, valuta, fattura…).
            Existing products are matched by SKU, then by name; suppliers by name.
          </p>
        </details>
      </Section>

      <h2 className="mt-10 mb-3 text-[14px] font-semibold">Coming next</h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {NEXT.map(({ icon: Icon, title, body }) => (
          <div key={title} className="rounded-lg border border-rule p-4">
            <div className="flex items-center justify-between">
              <Icon size={17} strokeWidth={1.75} className="text-ink-3" />
              <Basis tone="muted">Planned</Basis>
            </div>
            <div className="mt-3 text-[13.5px] font-medium">{title}</div>
            <p className="mt-1 text-[12.5px] text-ink-3">{body}</p>
          </div>
        ))}
      </div>
      <p className="mt-3 text-[12.5px] text-ink-3">
        Automatic extraction will always produce a proposal to review — nothing is written to your data without approval.
      </p>

      <Section
        className="mt-10"
        title="Data"
        description={
          demoPurchases > 0
            ? `You are looking at demo data (${plural(demoPurchases, "demo purchase")}). Clear it before loading your company's real data.`
            : `Currently stored: ${counts}.`
        }
      >
        <DataControls counts={counts} />
      </Section>
    </>
  );
}
