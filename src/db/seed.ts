/**
 * Demo dataset: a small candle manufacturer, purchases Oct 2025 → Sep 2026.
 * Quantities over the last 12 months match the target annual volumes
 * (paraffin 20.000 kg, glass 50.000 pcs, wick 120.000 pcs, fragrance 450 kg,
 * boxes 30.000 pcs). Every number shown in the app is computed from these rows.
 */
import type { DB } from "./index";
import { getStorage } from "../lib/storage";
import {
  documents,
  importItems,
  importSessions,
  opportunities,
  productAliases,
  products,
  purchases,
  quotes,
  supplierAliases,
  supplierProducts,
  suppliers,
} from "./schema";

type SupplierKey =
  | "abc"
  | "rossi"
  | "filati"
  | "essenza"
  | "pack"
  | "def"
  | "turkish"
  | "szklo"
  | "stoppini";

const SUPPLIERS: Record<SupplierKey, typeof suppliers.$inferInsert> = {
  abc: {
    name: "ABC Srl",
    country: "Italy",
    city: "Milano",
    contactName: "Marco Bianchi",
    email: "vendite@abc-srl.example",
    phone: "+39 02 1234 5678",
    paymentTermsDays: 60,
    defaultLeadTimeDays: 12,
  },
  rossi: {
    name: "Vetreria Rossi",
    country: "Italy",
    city: "Empoli",
    contactName: "Giulia Rossi",
    email: "ordini@vetreriarossi.example",
    phone: "+39 0571 123 456",
    paymentTermsDays: 60,
    defaultLeadTimeDays: 15,
  },
  filati: {
    name: "Filati Italia",
    country: "Italy",
    city: "Biella",
    contactName: "Paolo Ferri",
    email: "commerciale@filatiitalia.example",
    paymentTermsDays: 60,
    defaultLeadTimeDays: 10,
  },
  essenza: {
    name: "Essenza Italia",
    country: "Italy",
    city: "Milano",
    contactName: "Laura Conti",
    email: "info@essenzaitalia.example",
    paymentTermsDays: 30,
    defaultLeadTimeDays: 7,
  },
  pack: {
    name: "Pack Solutions",
    country: "Italy",
    city: "Verona",
    contactName: "Andrea Galli",
    email: "sales@packsolutions.example",
    paymentTermsDays: 60,
    defaultLeadTimeDays: 20,
  },
  def: {
    name: "DEF Srl",
    country: "Italy",
    city: "Bergamo",
    contactName: "Sara Moretti",
    email: "offerte@def-srl.example",
    paymentTermsDays: 30,
    defaultLeadTimeDays: 18,
  },
  turkish: {
    name: "Turkish Wax Ltd",
    country: "Turkey",
    city: "Izmir",
    contactName: "Emre Yılmaz",
    email: "export@turkishwax.example",
    paymentTermsDays: 0,
    defaultLeadTimeDays: 30,
    notes: "Payment in advance. Price FOB Izmir.",
  },
  szklo: {
    name: "Szkło Nova Sp. z o.o.",
    country: "Poland",
    city: "Kraków",
    contactName: "Anna Nowak",
    email: "export@szklonova.example",
    paymentTermsDays: 30,
    defaultLeadTimeDays: 35,
  },
  stoppini: {
    name: "Stoppini Lombardi",
    country: "Italy",
    city: "Busto Arsizio",
    contactName: "Elena Riva",
    email: "commerciale@stoppinilombardi.example",
    paymentTermsDays: 60,
    defaultLeadTimeDays: 12,
  },
};

type ProductKey = "par" | "gls" | "wck" | "frg" | "box";

const PRODUCTS: Record<ProductKey, typeof products.$inferInsert & { supplier: SupplierKey }> = {
  par: {
    sku: "PAR-5860",
    name: "Paraffina 58/60",
    category: "Wax",
    kind: "direct_material",
    unit: "kg",
    description: "Paraffina fully refined in pastiglie, punto di fusione 58–60 °C.",
    technicalSpecifications: "Melting point 58–60 °C · Oil content < 0,5% · Pastilles",
    supplier: "abc",
  },
  gls: {
    sku: "GLS-300",
    name: "Vetro Trasparente 300 ml",
    category: "Glass",
    kind: "component",
    unit: "pcs",
    description: "Bicchiere in vetro trasparente per candela, 300 ml.",
    technicalSpecifications: "Capacity 300 ml · Ø 85 mm · H 95 mm · Flint glass",
    supplier: "rossi",
  },
  wck: {
    sku: "WCK-120",
    name: "Stoppino Cotone 120 mm",
    category: "Wick",
    kind: "component",
    unit: "pcs",
    description: "Stoppino in cotone cerato con piastrina, 120 mm.",
    technicalSpecifications: "Length 120 mm · Waxed cotton · Metal sustainer",
    supplier: "filati",
  },
  frg: {
    sku: "FRG-INC",
    name: "Fragranza Incenso",
    category: "Fragrance",
    kind: "direct_material",
    unit: "kg",
    description: "Olio profumato per candele, nota incenso.",
    technicalSpecifications: "Flash point > 70 °C · IFRA compliant",
    supplier: "essenza",
  },
  box: {
    sku: "BOX-HC",
    name: "Scatola Home Collection",
    category: "Packaging",
    kind: "packaging",
    unit: "pcs",
    description: "Scatola in cartoncino stampato per linea Home Collection.",
    technicalSpecifications: "Board 350 g/m² · 4-colour print · 90×90×105 mm",
    supplier: "pack",
  },
};

// [date, quantity, unit price, freight]
type Row = [string, number, number, number?];

const PURCHASES: Record<ProductKey, Row[]> = {
  par: [
    ["2025-10-13", 2000, 1.42],
    ["2025-11-17", 2000, 1.42],
    ["2025-12-15", 1500, 1.42],
    ["2026-01-10", 2000, 1.42],
    ["2026-02-16", 1500, 1.42],
    ["2026-03-10", 2000, 1.45],
    ["2026-04-20", 2000, 1.45],
    ["2026-06-12", 2500, 1.52],
    ["2026-07-20", 2500, 1.52],
    ["2026-09-15", 2000, 1.58],
  ],
  gls: [
    ["2025-10-20", 5000, 1.06, 90],
    ["2025-12-09", 6000, 1.06, 90],
    ["2026-01-19", 5000, 1.06, 90],
    ["2026-02-23", 6000, 1.06, 90],
    ["2026-04-14", 6000, 1.09, 90],
    ["2026-05-26", 5000, 1.09, 90],
    ["2026-07-07", 6000, 1.13, 95],
    ["2026-08-18", 5000, 1.13, 95],
    ["2026-09-22", 6000, 1.18, 95],
  ],
  wck: [
    ["2025-11-05", 40000, 0.071],
    ["2026-03-03", 40000, 0.071],
    ["2026-08-25", 40000, 0.074],
  ],
  frg: [
    ["2025-10-28", 100, 29, 35],
    ["2026-01-27", 100, 29, 35],
    ["2026-04-15", 125, 29, 35],
    ["2026-07-14", 125, 31, 35],
  ],
  box: [
    ["2025-12-02", 10000, 0.44],
    ["2026-04-08", 10000, 0.44],
    ["2026-08-04", 10000, 0.46],
  ],
};

type QuoteRow = {
  product: ProductKey;
  supplier: SupplierKey;
  date: string;
  unitPrice: number;
  moq: number;
  leadTimeDays: number;
  paymentTermsDays: number;
  incoterm: string;
  validUntil?: string;
  notes?: string;
};

const QUOTES: QuoteRow[] = [
  // Current suppliers' latest price lists
  { product: "par", supplier: "abc", date: "2026-09-01", unitPrice: 1.58, moq: 1000, leadTimeDays: 12, paymentTermsDays: 60, incoterm: "DAP", validUntil: "2026-12-31", notes: "Price increase notice from 1 Sep 2026." },
  { product: "gls", supplier: "rossi", date: "2026-09-05", unitPrice: 1.18, moq: 5000, leadTimeDays: 15, paymentTermsDays: 60, incoterm: "DAP", validUntil: "2026-12-31" },
  { product: "wck", supplier: "filati", date: "2026-08-01", unitPrice: 0.074, moq: 20000, leadTimeDays: 10, paymentTermsDays: 60, incoterm: "DAP" },
  { product: "frg", supplier: "essenza", date: "2026-07-01", unitPrice: 31, moq: 25, leadTimeDays: 7, paymentTermsDays: 30, incoterm: "DAP" },
  { product: "box", supplier: "pack", date: "2026-07-15", unitPrice: 0.46, moq: 5000, leadTimeDays: 20, paymentTermsDays: 60, incoterm: "DAP" },
  // Alternatives
  { product: "par", supplier: "def", date: "2026-09-10", unitPrice: 1.49, moq: 2000, leadTimeDays: 18, paymentTermsDays: 30, incoterm: "DAP", validUntil: "2026-10-31" },
  { product: "par", supplier: "turkish", date: "2026-09-18", unitPrice: 1.31, moq: 5000, leadTimeDays: 30, paymentTermsDays: 0, incoterm: "FOB", validUntil: "2026-10-31", notes: "FOB Izmir. Freight, duties and insurance excluded." },
  { product: "gls", supplier: "szklo", date: "2026-09-12", unitPrice: 1.02, moq: 20000, leadTimeDays: 35, paymentTermsDays: 30, incoterm: "FCA", validUntil: "2026-11-30", notes: "FCA Kraków." },
  // An alternative that is not cheaper: a product can simply be fairly priced.
  { product: "wck", supplier: "stoppini", date: "2026-09-08", unitPrice: 0.076, moq: 20000, leadTimeDays: 12, paymentTermsDays: 60, incoterm: "DAP", validUntil: "2026-12-31" },
];

export async function seedDemo(db: DB) {
  await db.transaction(async (tx) => {
    const supplierIds = {} as Record<SupplierKey, string>;
    for (const [key, s] of Object.entries(SUPPLIERS) as [SupplierKey, typeof suppliers.$inferInsert][]) {
      const [row] = await tx.insert(suppliers).values(s).returning({ id: suppliers.id });
      supplierIds[key] = row.id;
    }

    const productIds = {} as Record<ProductKey, string>;
    for (const [key, { supplier, ...p }] of Object.entries(PRODUCTS) as [ProductKey, (typeof PRODUCTS)[ProductKey]][]) {
      const [row] = await tx
        .insert(products)
        .values({ ...p, currentSupplierId: supplierIds[supplier], mappedAt: new Date() })
        .returning({ id: products.id });
      productIds[key] = row.id;
    }

    let invoice = 1;
    const purchaseRows = (Object.keys(PURCHASES) as ProductKey[]).flatMap((key) =>
      PURCHASES[key].map(([date, quantity, unitPrice, freight = 0]) => ({
        productId: productIds[key],
        supplierId: supplierIds[PRODUCTS[key].supplier],
        date,
        quantity: String(quantity),
        unit: PRODUCTS[key].unit,
        unitPrice: String(unitPrice),
        freightCost: String(freight),
        totalAmount: String(round2(quantity * unitPrice + freight)),
        invoiceReference: `FT ${date.slice(0, 4)}/${String(invoice++).padStart(4, "0")}`,
        source: "demo" as const,
      })),
    );
    await tx.insert(purchases).values(purchaseRows);

    // How Vetreria Rossi codes our glass: lets imports recognise "VR-8821".
    await tx.insert(supplierProducts).values({
      supplierId: supplierIds.rossi,
      productId: productIds.gls,
      supplierSku: "VR-8821",
      supplierProductName: "Bicchiere 300 cc trasparente",
      moq: "5000",
      leadTimeDays: 15,
    });

    await tx.insert(quotes).values(
      QUOTES.map((q) => ({
        productId: productIds[q.product],
        supplierId: supplierIds[q.supplier],
        date: q.date,
        unitPrice: String(q.unitPrice),
        moq: String(q.moq),
        leadTimeDays: q.leadTimeDays,
        paymentTermsDays: q.paymentTermsDays,
        incoterm: q.incoterm,
        validUntil: q.validUntil,
        notes: q.notes,
        source: "demo" as const,
      })),
    );
  });
}

/** Deletes every record and stored file. Used by "Clear all data" before loading real data. */
export async function clearAll(db: DB) {
  await db.transaction(async (tx) => {
    await tx.delete(opportunities);
    await tx.delete(purchases);
    await tx.delete(quotes);
    await tx.delete(importItems);
    await tx.delete(importSessions);
    await tx.delete(documents);
    await tx.delete(productAliases);
    await tx.delete(supplierAliases);
    await tx.delete(supplierProducts);
    await tx.delete(products);
    await tx.delete(suppliers);
  });
  await getStorage().clear();
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}
