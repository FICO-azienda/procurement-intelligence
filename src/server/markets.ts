/**
 * Market directories on the database (lib/markets/): research files are
 * checked and loaded on the user's confirmation, companies are read with what
 * the buyer's own records say about them, and the whole directory goes out as
 * a workbook.
 *
 * Rules that must hold: (1) a company of the directory is not a supplier and
 * not a candidate — nothing here writes to `suppliers`, and a candidate for a
 * product is created only by the user's click (`makeCandidate`, through the
 * same `addCandidate` as any other); (2) the same company is one record: a
 * file that names it again refreshes what its pages say and never takes back
 * a status the user recorded; (3) what a file does not state stays empty —
 * shown and exported as "missing" — and a file is never loaded half-read.
 */
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { and, asc, eq } from "drizzle-orm";
import * as XLSX from "xlsx";
import type { DB } from "@/db";
import { marketResearch, marketSuppliers, rfqRequests, rfqSuppliers, supplierCandidates, suppliers } from "@/db/schema";
import { basePrice, baseTotal, isPriced, todayISO } from "@/lib/analytics";
import { isStrategic } from "@/lib/catalog/kinds";
import { countryName } from "@/lib/countries";
import { readDataset, readLearning } from "@/lib/data";
import { en, type T } from "@/lib/i18n";
import { normalizeKey } from "@/lib/import/normalize/text";
import { NO_LINKS, isMatch, type Row, type SupplierLinks } from "@/lib/markets/filter";
import {
  CONTINENTS, CONTINENT_LABEL, DEPTH_LABEL, INTENDED_USE_LABEL, PRODUCT_TYPE_LABEL, RELIABILITY_LABEL, ROLE_LABEL, SOURCE_LEVEL_LABEL, STATUS_LABEL, TECHNOLOGY_LABEL,
  continentOf, isMaker, isOem, isStatus, marketOf, parseMarketFile, profile as profileSchema, sameCompany, statusRank,
  type MarketCoverage, type MarketProfile, type MarketRole, type MarketStatus, type MarketSupplier, type SupplierInFile,
} from "@/lib/markets/types";
import { addCandidate, readRfqLines } from "./sourcing";
import { readNaming } from "./categories";

export class MarketError extends Error {}

const toSupplier = (r: typeof marketSuppliers.$inferSelect): MarketSupplier => ({
  id: r.id,
  market: r.market,
  name: r.name,
  tradeName: r.tradeName,
  country: r.country,
  city: r.city,
  website: r.website,
  email: r.email,
  phone: r.phone,
  role: r.role as MarketRole,
  status: (isStatus(r.status) ? r.status : "discovered") as MarketStatus,
  materials: r.materials ?? [],
  technologies: r.technologies ?? [],
  productTypes: r.productTypes ?? [],
  profile: (r.profile ?? {}) as MarketProfile,
  evidenceUrl: r.evidenceUrl,
  sourceLevel: r.sourceLevel,
  checkedAt: r.checkedAt,
});

export async function readMarketSuppliers(db: DB, market: string): Promise<MarketSupplier[]> {
  return (await db.select().from(marketSuppliers).where(eq(marketSuppliers.market, market)).orderBy(asc(marketSuppliers.name))).map(toSupplier);
}

// ---------------- Research files kept on this computer ----------------

const dir = () => path.join(process.env.RESEARCH_DIR ?? path.join(process.cwd(), ".data", "research"), "markets");
const SAFE = /^[\w.-]+\.json$/;

export async function listMarketFiles(): Promise<{ name: string; modified: string }[]> {
  let names: string[];
  try {
    names = await readdir(dir());
  } catch {
    return [];
  }
  const files = await Promise.all(names.filter((n) => SAFE.test(n)).map(async (name) => ({ name, modified: (await stat(path.join(dir(), name))).mtime.toISOString() })));
  return files.sort((a, b) => a.name.localeCompare(b.name));
}

export async function readMarketFile(name: string): Promise<string | null> {
  if (!SAFE.test(name)) return null;
  try {
    return await readFile(path.join(dir(), name), "utf8");
  } catch {
    return null;
  }
}

// ---------------- Loading a file ----------------

export interface MarketImport {
  market: string;
  researchedAt: string;
  /** Companies not on file yet. */
  added: string[];
  /** Companies already on file, whose record the file refreshes. */
  updated: string[];
  /** The same company written twice in the file: read once. */
  repeated: string[];
  rejected: { name: string; reason: string }[];
  countries: number;
  leads: number;
  /** False: only checked, nothing written. */
  loaded: boolean;
}

function values(s: SupplierInFile, market: string, file: string | null) {
  const { name, tradeName, country, city, website, email, phone, role, status, materials, technologies, productTypes, evidenceUrl, sourceLevel, checkedAt, ...rest } = s;
  // Only what the file states is kept: an absent field is not written as an empty one.
  const profile = profileSchema.parse(Object.fromEntries(Object.entries(rest).filter(([, v]) => v != null && v !== "")));
  return { market, name, tradeName: tradeName ?? null, country, city: city ?? null, website: website ?? null, email: email ?? null, phone: phone ?? null, role, status, materials, technologies, productTypes, profile, evidenceUrl, sourceLevel, checkedAt: checkedAt ?? null, sourceFile: file };
}

/** Checks a research file and, on the user's confirmation, loads it. The check alone writes nothing. */
export async function importMarketFile(db: DB, raw: string, opts: { confirm: boolean; file?: string | null }, t: T = en): Promise<MarketImport> {
  const parsed = parseMarketFile(raw);
  if (!parsed.ok) throw new MarketError(parsed.error === "not_json" ? t("This is not a research file: it cannot be read.") : t("This research file cannot be read: {where}", { where: parsed.error }));
  const { file } = parsed;
  if (!marketOf(file.market)) throw new MarketError(t("This file is about a market the app does not know: “{market}”.", { market: file.market }));
  const existing = await db.select().from(marketSuppliers).where(eq(marketSuppliers.market, file.market));
  const out: MarketImport = { market: file.market, researchedAt: file.researchedAt, added: [], updated: [], repeated: [], rejected: file.rejected, countries: file.coverage.countries.length, leads: file.coverage.leads.length, loaded: opts.confirm };
  const seen: SupplierInFile[] = [];
  for (const s of file.suppliers) {
    if (seen.some((x) => sameCompany(x, s))) {
      out.repeated.push(s.name);
      continue;
    }
    seen.push(s);
    const on = existing.find((x) => sameCompany(x, s));
    (on ? out.updated : out.added).push(s.name);
    if (!opts.confirm) continue;
    const v = values(s, file.market, opts.file ?? null);
    if (!on) {
      await db.insert(marketSuppliers).values(v);
      continue;
    }
    // What the user recorded (contacted, a quote, a validation) is further along than any research: it stays.
    const status = statusRank(on.status) > statusRank(v.status) ? on.status : v.status;
    await db.update(marketSuppliers).set({ ...v, status, email: v.email ?? on.email, phone: v.phone ?? on.phone, updatedAt: new Date() }).where(eq(marketSuppliers.id, on.id));
  }
  if (opts.confirm) {
    const name = opts.file ?? `${file.researchedAt}-${file.cycle ?? "file"}`;
    await db.delete(marketResearch).where(and(eq(marketResearch.market, file.market), eq(marketResearch.file, name)));
    await db.insert(marketResearch).values({ market: file.market, file: name, researchedAt: file.researchedAt, cycle: file.cycle, source: file.source, coverage: file.coverage });
  }
  return out;
}

export interface ResearchLog {
  file: string;
  researchedAt: string;
  cycle: string | null;
  source: string | null;
  coverage: MarketCoverage;
}
export async function readMarketResearch(db: DB, market: string): Promise<ResearchLog[]> {
  const rows = await db.select().from(marketResearch).where(eq(marketResearch.market, market)).orderBy(asc(marketResearch.researchedAt), asc(marketResearch.file));
  return rows.map((r) => ({ file: r.file, researchedAt: r.researchedAt, cycle: r.cycle, source: r.source, coverage: { countries: [], gaps: [], leads: [], ...(r.coverage as Partial<MarketCoverage>) } }));
}

/** The latest word on each country, across the files loaded: a later, deeper search replaces an earlier one. */
export function countryCoverage(logs: ResearchLog[]): MarketCoverage["countries"] {
  const DEPTH = { todo: 0, none_found: 1, preliminary: 2, deep: 3 } as const;
  const by = new Map<string, MarketCoverage["countries"][number]>();
  for (const log of logs) {
    for (const c of log.coverage.countries) {
      const key = normalizeKey(c.country);
      const on = by.get(key);
      if (!on) by.set(key, { ...c, queries: [...c.queries], sources: [...c.sources] });
      else by.set(key, { ...on, depth: DEPTH[c.depth] >= DEPTH[on.depth] ? c.depth : on.depth, queries: [...new Set([...on.queries, ...c.queries])], sources: [...new Set([...on.sources, ...c.sources])], found: (on.found ?? 0) + (c.found ?? 0), note: c.note ?? on.note });
    }
  }
  return [...by.values()].sort((a, b) => DEPTH[b.depth] - DEPTH[a.depth] || a.country.localeCompare(b.country));
}

// ---------------- The directory and the buyer's own records ----------------

/** One of the buyer's products this market supplies, with what is on file about it — and what is not. */
export interface Reference {
  productId: string;
  name: string;
  /** As the invoices write it. */
  original: string | null;
  supplier: string | null;
  unit: string;
  typicalOrder: number | null;
  annual: number | null;
  annualConfirmed: boolean;
  lastPrice: number | null;
  averagePrice: number | null;
  spend: number;
  /** The technical facts a supplier needs, as far as they are on file: material, sizes, capacity… Empty: missing. */
  specs: Record<string, string>;
  technical: string | null;
  documents: number;
}

export async function readReferences(db: DB, market: string, t: T = en): Promise<Reference[]> {
  const def = marketOf(market);
  if (!def) return [];
  const [data, learning, naming] = await Promise.all([readDataset(db), readLearning(db), readNaming(db, t)]);
  const mine = data.products.filter((p) => isStrategic(p.kind) && def.serves.includes(naming.subKeyOf(p.category, p.subcategory) ?? ""));
  const lines = await readRfqLines(db, mine.map((p) => p.id), t);
  const supplierName = new Map(data.suppliers.map((s) => [s.id, s.name]));
  return mine
    .map((p) => {
      const bought = data.purchases.filter((x) => x.productId === p.id).filter(isPriced).sort((a, b) => (a.date < b.date ? -1 : 1));
      const quantity = bought.filter((x) => x.unit === p.unit).reduce((s, x) => s + x.quantity, 0);
      const spend = bought.reduce((s, x) => s + baseTotal(x), 0);
      const line = lines.get(p.id);
      const last = bought.at(-1);
      return {
        productId: p.id,
        name: p.name,
        original: learning.productAliases.find((a) => a.productId === p.id)?.alias ?? null,
        supplier: last ? (supplierName.get(last.supplierId) ?? null) : null,
        unit: p.unit,
        typicalOrder: line?.typicalOrderQuantity ?? null,
        annual: line?.annualQuantity ?? null,
        annualConfirmed: line?.annualConfirmed ?? false,
        lastPrice: last ? basePrice(last) : null,
        averagePrice: quantity ? bought.filter((x) => x.unit === p.unit).reduce((s, x) => s + baseTotal(x), 0) / quantity : null,
        spend,
        specs: p.specs ?? {},
        technical: p.technicalSpecifications ?? null,
        documents: line?.documents.length ?? 0,
      };
    })
    .sort((a, b) => b.spend - a.spend);
}

/** What the buyer's own records say of each company: a supplier already, a candidate for some products, asked, answered. */
export async function readLinks(db: DB, list: MarketSupplier[]): Promise<Map<string, SupplierLinks>> {
  const [data, candidates, requests, own, replied] = await Promise.all([
    readDataset(db),
    db.select().from(supplierCandidates),
    db.select().from(rfqRequests),
    db.select({ name: suppliers.name, website: suppliers.website }).from(suppliers),
    db.select({ id: rfqSuppliers.id, name: rfqSuppliers.name, website: rfqSuppliers.website }).from(rfqSuppliers),
  ]);
  const productName = new Map(data.products.map((p) => [p.id, p.name]));
  const asked = new Set(requests.flatMap((r) => (r.candidateIds as string[] | null) ?? []));
  const out = new Map<string, SupplierLinks>();
  for (const s of list) {
    const mine = candidates.filter((c) => sameCompany(c, s));
    const reply = replied.find((r) => sameCompany(r, s)) ?? null;
    if (!mine.length && !reply && !own.some((o) => sameCompany(o, s))) {
      out.set(s.id, NO_LINKS);
      continue;
    }
    const quoted = mine.some((c) => c.status === "quote_received" || c.supplierId != null);
    const contacted = mine.some((c) => asked.has(c.id) || c.status === "contacted" || c.status === "quote_requested");
    out.set(s.id, {
      current: own.some((o) => sameCompany(o, s)),
      candidateFor: [...new Map(mine.filter((c) => productName.has(c.productId)).map((c) => [c.productId, { productId: c.productId, name: productName.get(c.productId)! }])).values()],
      rfq: quoted ? "quote_received" : reply ? "answered" : contacted ? "contacted" : mine.length ? "candidate" : "none",
      replyId: reply?.id ?? null,
    });
  }
  return out;
}

export async function readDirectory(db: DB, market: string): Promise<Row[]> {
  const list = await readMarketSuppliers(db, market);
  const links = await readLinks(db, list);
  return list.map((s) => ({ ...s, links: links.get(s.id) ?? NO_LINKS }));
}

/** How far along the user says a company is. Research never moves a company past "ready for a request". */
export async function setMarketStatus(db: DB, id: string, status: string): Promise<void> {
  if (!isStatus(status)) throw new MarketError("Unknown status");
  await db.update(marketSuppliers).set({ status, updatedAt: new Date() }).where(eq(marketSuppliers.id, id));
}

/**
 * A company of the directory becomes a candidate for one of the buyer's products — on the user's click, with the page
 * that shows it, to review like any other candidate. It does not become a supplier, and it is not asked anything.
 */
export async function makeCandidate(db: DB, id: string, productId: string, t: T = en): Promise<void> {
  const [row] = await db.select().from(marketSuppliers).where(eq(marketSuppliers.id, id));
  if (!row) throw new MarketError(t("This company is no longer in the directory."));
  const s = toSupplier(row);
  const on = (await db.select().from(supplierCandidates).where(eq(supplierCandidates.productId, productId))).some((c) => sameCompany(c, s));
  if (on) throw new MarketError(t("It is already a candidate for this product."));
  await addCandidate(db, productId, {
    name: s.name,
    country: s.country,
    website: s.website,
    sourceUrl: s.evidenceUrl,
    sourceDate: s.checkedAt ?? todayISO(),
    sourceLevel: s.sourceLevel === "supplier_official" ? "supplier_official" : "external",
    productMatched: s.profile.products ?? null,
    matchReason: s.profile.evidence ?? null,
    technicalCompatibility: null,
    priceLow: null,
    priceHigh: null,
    priceSourceUrl: null,
    currency: "EUR",
    unit: null,
    incoterm: null,
    moq: null,
    leadTimeDays: null,
    paymentTerms: null,
    certifications: null,
    shippingOrigin: s.country,
    notes: [s.profile.doubts, s.email ? `Email: ${s.email}` : null, s.phone ? `Tel: ${s.phone}` : null].filter(Boolean).join(" · ") || null,
  });
}

// ---------------- The workbook ----------------

/** What a cell says when the page did not: the word the research uses, so that an empty cell is never read as "none". */
const MISSING = "MISSING";

export async function marketWorkbook(db: DB, market: string, t: T = en): Promise<Uint8Array> {
  const [rows, logs, references] = await Promise.all([readDirectory(db, market), readMarketResearch(db, market), readReferences(db, market, t)]);
  const or = (v: unknown) => (v == null || v === "" || (Array.isArray(v) && !v.length) ? MISSING : Array.isArray(v) ? v.join(", ") : v);
  const yes = (v: boolean | null | undefined) => (v == null ? MISSING : v ? t("Yes") : t("No"));
  const HEAD = [
    t("Company"), t("Trade name"), t("Country"), t("Continent"), t("City"), t("Address"), t("Website"), t("Registration"), t("Role"), t("Makes to a drawing (OEM)"), t("Technologies"), t("Materials"), t("Product types"),
    t("Products, as its page says"), t("Sizes"), t("Colours"), t("Catalogue"), t("Email"), t("Phone"), t("Contact page"), t("Languages"), t("Minimum order"), t("Samples"), t("Customisation"), t("Intended use"), t("Safety documents"),
    t("Research status"), t("Request status"), t("Already a supplier"), t("Candidate for"), t("Evidence"), t("Evidence page"), t("Kind of source"), t("Reliability"), t("Last checked"), t("Doubts to clear"),
  ];
  const line = (s: Row) => [
    s.name, or(s.tradeName), s.country ? countryName(s.country, t.locale) : MISSING, continentOf(s.country) ? t(CONTINENT_LABEL[continentOf(s.country)!]) : MISSING, or(s.city), or(s.profile.address), or(s.website), or(s.profile.registration),
    t(ROLE_LABEL[s.role]), yes(s.role === "contract_moulder" ? true : s.profile.oem), or(s.technologies.map((x) => t(TECHNOLOGY_LABEL[x as keyof typeof TECHNOLOGY_LABEL] ?? "Not known"))), or(s.materials), or(s.productTypes.map((x) => t(PRODUCT_TYPE_LABEL[x as keyof typeof PRODUCT_TYPE_LABEL] ?? "Not known"))),
    or(s.profile.products), or(s.profile.sizes), or(s.profile.colours), or(s.profile.catalogUrl), or(s.email), or(s.phone), or(s.profile.contactUrl), or(s.profile.languages), or(s.profile.moq), or(s.profile.samples), or(s.profile.customisation),
    s.profile.intendedUse ? t(INTENDED_USE_LABEL[s.profile.intendedUse]) : t("Technical validation required"), or(s.profile.safety),
    t(STATUS_LABEL[s.status]), t(RFQ_LABEL[s.links.rfq]), s.links.current ? t("Yes") : t("No"), or(s.links.candidateFor.map((c) => c.name)), or(s.profile.evidence), s.evidenceUrl,
    t(SOURCE_LEVEL_LABEL[s.sourceLevel as keyof typeof SOURCE_LEVEL_LABEL] ?? "Another source"), s.profile.reliability ? t(RELIABILITY_LABEL[s.profile.reliability]) : MISSING, or(s.checkedAt), or(s.profile.doubts),
  ];
  const sheet = (data: unknown[][], widths: number[]) => {
    const ws = XLSX.utils.aoa_to_sheet(data);
    ws["!cols"] = widths.map((wch) => ({ wch }));
    if (data.length > 1) ws["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: data.length - 1, c: data[0].length - 1 } }) };
    return ws;
  };
  const W = [34, 18, 14, 12, 20, 30, 28, 22, 20, 12, 22, 14, 34, 48, 34, 26, 28, 30, 20, 28, 20, 18, 16, 22, 24, 26, 24, 16, 10, 30, 60, 44, 28, 10, 12, 50];
  const list = (filter: (s: Row) => boolean) => sheet([HEAD, ...rows.filter(filter).map(line)], W);
  const asia = (s: Row) => continentOf(s.country) === "Asia";
  const europe = (s: Row) => continentOf(s.country) === "Europe" && normalizeKey(s.country) !== "italy";
  const italy = (s: Row) => normalizeKey(s.country) === "italy";
  // The most compatible first: a technical match, a maker before the others, a way to write to it.
  const shortlist = rows.filter((s) => isMatch(s)).sort((a, b) => statusRank(b.status) - statusRank(a.status) || Number(isMaker(b.role)) - Number(isMaker(a.role)) || Number(!!b.email) - Number(!!a.email) || a.name.localeCompare(b.name));
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, list(() => true), "GLOBAL MASTER LIST");
  XLSX.utils.book_append_sheet(book, list(italy), "ITALY");
  XLSX.utils.book_append_sheet(book, list(europe), "EUROPE");
  XLSX.utils.book_append_sheet(book, list(asia), "CHINA & ASIA");
  XLSX.utils.book_append_sheet(book, list((s) => !italy(s) && !europe(s) && !asia(s)), "REST OF WORLD");
  XLSX.utils.book_append_sheet(book, sheet([HEAD, ...shortlist.map(line)], W), "PRIORITY SHORTLIST");
  XLSX.utils.book_append_sheet(
    book,
    sheet(
      [
        [t("Company"), t("Country"), t("Email"), t("Contact name"), t("Phone"), t("Contact page"), t("Language of the request"), t("Product of interest"), t("Research status"), t("Request status"), t("Date sent"), t("Notes")],
        ...rows.filter((s) => s.email || s.profile.contactUrl || s.phone).map((s) => [
          s.name, s.country ? countryName(s.country, t.locale) : MISSING, or(s.email), or(s.profile.contactName), or(s.phone), or(s.profile.contactUrl), or(s.profile.languages),
          or(s.links.candidateFor.map((c) => c.name).join(", ") || s.productTypes.map((x) => t(PRODUCT_TYPE_LABEL[x as keyof typeof PRODUCT_TYPE_LABEL] ?? "Not known")).join(", ")), t(STATUS_LABEL[s.status]), t(RFQ_LABEL[s.links.rfq]), "", "",
        ]),
      ],
      [34, 14, 32, 22, 20, 30, 22, 40, 24, 16, 12, 40],
    ),
    "RFQ CONTACTS",
  );
  const coverageRows = countryCoverage(logs);
  XLSX.utils.book_append_sheet(
    book,
    sheet(
      [
        [t("Kind"), t("Country or company"), t("State"), t("Companies found"), t("Searches made"), t("Sources read"), t("Notes"), t("Research file")],
        ...coverageRows.map((c) => [t("Country"), countryName(c.country, t.locale), t(DEPTH_LABEL[c.depth]), c.found ?? 0, c.queries.join(" · "), c.sources.join(" · "), c.note ?? "", ""]),
        ...logs.flatMap((l) => l.coverage.gaps.map((g) => [t("Gap"), "", "", "", "", "", g, l.file])),
        ...logs.flatMap((l) => l.coverage.leads.map((x) => [t("Name still to verify"), `${x.name}${x.country ? ` (${countryName(x.country, t.locale)})` : ""}`, "", "", "", x.where, x.why ?? "", l.file])),
        ...rows.filter((s) => s.profile.doubts).map((s) => [t("Company to look into"), s.name, t(STATUS_LABEL[s.status]), "", "", s.evidenceUrl, s.profile.doubts, ""]),
      ],
      [22, 34, 30, 12, 70, 60, 80, 34],
    ),
    "SOURCES & GAPS",
  );
  XLSX.utils.book_append_sheet(
    book,
    sheet(
      [
        [t("Product"), t("As written on the invoices"), t("Current supplier"), t("Unit"), t("Usual order"), t("Yearly quantity"), t("Yearly quantity: basis"), t("Last unit price"), t("Average unit price"), t("Spend on file"), t("Material"), t("Diameter"), t("Height"), t("Capacity"), t("Weight"), t("Wall thickness"), t("Shape"), t("Colour"), t("Bottom and rim"), t("Lid"), t("Production method"), t("Technical notes"), t("Documents on file")],
        ...references.map((r) => {
          const spec = (...keys: string[]) => or(keys.map((k) => r.specs[k]).find(Boolean));
          return [r.name, or(r.original), or(r.supplier), r.unit, or(r.typicalOrder), or(r.annual), r.annual == null ? MISSING : r.annualConfirmed ? t("Confirmed") : t("Estimated from the invoices"), or(r.lastPrice), or(r.averagePrice == null ? null : Math.round(r.averagePrice * 10000) / 10000), Math.round(r.spend),
            spec("material"), spec("diameter"), spec("height"), spec("capacity"), spec("weight"), spec("thickness"), spec("shape"), spec("colour", "color"), spec("bottom", "rim"), spec("lid"), spec("method", "process"), or(r.technical), r.documents || MISSING];
        }),
      ],
      [36, 40, 22, 6, 12, 14, 24, 12, 12, 12, 12, 10, 10, 10, 10, 12, 12, 12, 14, 10, 16, 30, 12],
    ),
    "REFERENCES",
  );
  return new Uint8Array(XLSX.write(book, { type: "array", bookType: "xlsx" }) as ArrayBuffer);
}

export const RFQ_LABEL = { none: "Not a candidate yet", candidate: "Candidate, not asked", contacted: "Contacted", answered: "Answered a request", quote_received: "Quote received" } as const;

/** The directory in figures: what was found, by what it is and where. */
export function summary(rows: Row[]) {
  const by = new Map<string, number>();
  for (const s of rows) by.set(s.country ?? "", (by.get(s.country ?? "") ?? 0) + 1);
  return {
    total: rows.length,
    makers: rows.filter((s) => isMaker(s.role) && statusRank(s.status) >= statusRank("manufacturer_confirmed")).length,
    distributors: rows.filter((s) => s.role === "distributor" || s.role === "importer").length,
    oem: rows.filter((s) => isOem(s)).length,
    withContact: rows.filter((s) => s.email).length,
    continents: CONTINENTS.map((c) => [c, rows.filter((s) => continentOf(s.country) === c).length] as const).filter(([, n]) => n > 0),
    countries: [...by].sort((a, b) => b[1] - a[1]),
  };
}
