/**
 * A market directory: the companies of the world that make one kind of thing
 * — the plastic containers a candle maker fills, to begin with — found by
 * research, one record per company, each with the page that shows it.
 *
 * It is not a list of suppliers and not a marketplace. A company here was
 * found, not asked: it becomes a candidate for one of the buyer's products
 * only when the user says so, and a supplier only through an offer. Nothing
 * a page does not state is filled in — a field left out is "missing" — and a
 * research is never called complete: each file says which countries were
 * searched, how deeply, and what is still open.
 *
 * The directory belongs to no company: which of a buyer's products a market
 * serves is read from where those products are filed (`serves`), so the same
 * records answer the next buyer too.
 */
import { z } from "zod";
import type { Msg } from "../i18n";
import { countryKey } from "../countries";
import { companyKey, normalizeKey } from "../import/normalize/text";

export interface MarketDefinition {
  key: string;
  label: Msg;
  about: Msg;
  /** The built-in subcategories (lib/catalog/taxonomy.ts) whose products this market supplies. */
  serves: string[];
}

export const MARKETS: MarketDefinition[] = [
  {
    key: "plastic_candle_containers",
    label: "Plastic candle containers",
    about: "Makers of the empty plastic containers used for votive, cemetery and religious candles and for tealights: tubes, cups and shells in PP, PVC, PC and other plastics, moulded or blown.",
    serves: ["candle_container"],
  },
];
export const marketOf = (key: string | null | undefined) => MARKETS.find((m) => m.key === key) ?? null;

export const ROLES = ["manufacturer", "contract_moulder", "distributor", "importer", "candle_maker", "unknown"] as const;
export type MarketRole = (typeof ROLES)[number];
export const ROLE_LABEL: Record<MarketRole, Msg> = {
  manufacturer: "Manufacturer",
  contract_moulder: "Contract moulder",
  distributor: "Distributor",
  importer: "Importer",
  candle_maker: "Candle maker with its own plastics",
  unknown: "Not known",
};
/** Who makes the thing itself, who could make it to a drawing, who resells it. */
export const isMaker = (role: string) => role === "manufacturer";
export const isOem = (s: { role: string; profile?: { oem?: boolean | null } | null }) => s.role === "contract_moulder" || s.profile?.oem === true;

/** How far a company is along the way from a name to a validated source. The first five come from research; the others only from what the user records. */
export const STATUSES = ["discovered", "evidence_found", "manufacturer_confirmed", "technical_match_to_review", "rfq_ready", "contacted", "quote_received", "technically_validated"] as const;
export type MarketStatus = (typeof STATUSES)[number];
export const STATUS_LABEL: Record<MarketStatus, Msg> = {
  discovered: "Discovered",
  evidence_found: "Evidence found",
  manufacturer_confirmed: "Manufacturer confirmed",
  technical_match_to_review: "Technical match to review",
  rfq_ready: "Ready for a request",
  contacted: "Contacted",
  quote_received: "Quote received",
  technically_validated: "Technically validated",
};
export const STATUS_MEANING: Record<MarketStatus, Msg> = {
  discovered: "The company was found; what it makes is still to check.",
  evidence_found: "A page shows products of this kind; whether it makes them itself is not established.",
  manufacturer_confirmed: "Its own pages support that it produces them.",
  technical_match_to_review: "It makes the same kind of container as the buyer's references: materials and sizes are to be compared.",
  rfq_ready: "The specification and a contact are there: a request for quotation can be prepared.",
  contacted: "A request was sent and recorded.",
  quote_received: "An offer arrived.",
  technically_validated: "The equivalence was confirmed with the checks it needs.",
};
/** What research alone can establish: the rest is the user's to record. */
export const RESEARCH_STATUSES: MarketStatus[] = ["discovered", "evidence_found", "manufacturer_confirmed", "technical_match_to_review", "rfq_ready"];
export const statusRank = (status: string) => Math.max(0, (STATUSES as readonly string[]).indexOf(status));
export const isStatus = (v: unknown): v is MarketStatus => typeof v === "string" && (STATUSES as readonly string[]).includes(v);

export const TECHNOLOGIES = ["injection", "blow", "extrusion", "thermoforming"] as const;
export const TECHNOLOGY_LABEL: Record<(typeof TECHNOLOGIES)[number], Msg> = { injection: "Injection moulding", blow: "Blow moulding", extrusion: "Extrusion", thermoforming: "Thermoforming" };

export const PRODUCT_TYPES = ["votive_container", "tealight_cup", "lantern_housing", "lid", "base", "oil_insert", "electric_light", "custom"] as const;
export const PRODUCT_TYPE_LABEL: Record<(typeof PRODUCT_TYPES)[number], Msg> = {
  votive_container: "Containers and tubes for votive and cemetery candles",
  tealight_cup: "Tealight cups",
  lantern_housing: "Plastic grave-light housings",
  lid: "Lids and caps",
  base: "Bases",
  oil_insert: "Oil inserts",
  electric_light: "Electric votive lights",
  custom: "Custom moulding",
};

/** What the container is for: the four are not interchangeable, and only a test on the finished candle says a container is safe. */
export const INTENDED_USES = ["hot_fill", "finished_candle", "empty_container", "outer_support"] as const;
export const INTENDED_USE_LABEL: Record<(typeof INTENDED_USES)[number], Msg> = {
  hot_fill: "Made to receive hot wax",
  finished_candle: "For a candle already made",
  empty_container: "Sold empty, use not stated",
  outer_support: "Outer support or accessory",
};

export const SOURCE_LEVELS = ["supplier_official", "marketplace", "directory", "external"] as const;
export const SOURCE_LEVEL_LABEL: Record<(typeof SOURCE_LEVELS)[number], Msg> = {
  supplier_official: "The company's own site",
  marketplace: "A marketplace listing: a lead, not proof of production",
  directory: "A business directory or an association's list",
  external: "Another source",
};

export const RELIABILITY_LABEL: Record<"high" | "medium" | "low", Msg> = { high: "High", medium: "Medium", low: "Low" };

export const DEPTHS = ["deep", "preliminary", "none_found", "todo"] as const;
export const DEPTH_LABEL: Record<(typeof DEPTHS)[number], Msg> = { deep: "Searched in depth", preliminary: "First search only", none_found: "Searched, nothing relevant found", todo: "Still to search" };

const text = z.string().trim().min(1);
const optional = text.nullish();
const list = z.array(text).default([]);

/** What a company's page says beyond the columns the filters read. Every field is optional: left out means missing. */
export const profile = z.object({
  address: optional,
  registration: optional,
  /** What it offers, in the words of its page. */
  products: optional,
  sizes: optional,
  colours: optional,
  oem: z.boolean().nullish(),
  capacity: optional,
  catalogUrl: optional,
  contactUrl: optional,
  contactName: optional,
  languages: optional,
  moq: optional,
  export: optional,
  leadTime: optional,
  samples: optional,
  customisation: optional,
  intendedUse: z.enum(INTENDED_USES).nullish(),
  /** What its documents say about heat, filling temperature and tests. Nothing here: validation is required. */
  safety: optional,
  /** What the page shows, quoted or summed up. */
  evidence: optional,
  reliability: z.enum(["high", "medium", "low"]).nullish(),
  doubts: optional,
  notes: optional,
});
export type MarketProfile = z.infer<typeof profile>;

export const supplierInFile = profile.extend({
  name: text,
  tradeName: optional,
  country: text,
  city: optional,
  website: optional,
  email: optional,
  phone: optional,
  role: z.enum(ROLES).default("unknown"),
  status: z.enum(RESEARCH_STATUSES as [MarketStatus, ...MarketStatus[]]).default("discovered"),
  materials: list,
  technologies: z.array(z.enum(TECHNOLOGIES)).default([]),
  productTypes: z.array(z.enum(PRODUCT_TYPES)).default([]),
  /** The exact page that shows it. A company with no page is not kept. */
  evidenceUrl: z.string().url(),
  sourceLevel: z.enum(SOURCE_LEVELS).default("supplier_official"),
  checkedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
});
export type SupplierInFile = z.infer<typeof supplierInFile>;

export const coverage = z.object({
  countries: z
    .array(z.object({ country: text, depth: z.enum(DEPTHS), queries: list, sources: list, found: z.number().int().nonnegative().nullish(), note: optional }))
    .default([]),
  /** What is still open, in words. */
  gaps: list,
  /** Names met on the way and not verified: where they were seen, and why they are worth a look. Not suppliers. */
  leads: z.array(z.object({ name: text, country: optional, where: text, why: optional })).default([]),
});
export type MarketCoverage = z.infer<typeof coverage>;

export const marketFile = z.object({
  kind: z.literal("market_suppliers"),
  market: text,
  researchedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  source: text,
  cycle: optional,
  coverage: coverage.default({ countries: [], gaps: [], leads: [] }),
  suppliers: z.array(z.unknown()),
});

export interface ParsedMarketFile {
  market: string;
  researchedAt: string;
  source: string;
  cycle: string | null;
  coverage: MarketCoverage;
  suppliers: SupplierInFile[];
  /** Entries that could not be read, with the reason: they are never loaded half-understood. */
  rejected: { name: string; reason: string }[];
}

export function parseMarketFile(raw: string): { ok: true; file: ParsedMarketFile } | { ok: false; error: string } {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false, error: "not_json" };
  }
  const head = marketFile.safeParse(json);
  if (!head.success) return { ok: false, error: `${head.error.issues[0].path.join(".")}: ${head.error.issues[0].message}` };
  const suppliers: SupplierInFile[] = [];
  const rejected: ParsedMarketFile["rejected"] = [];
  for (const entry of head.data.suppliers) {
    const one = supplierInFile.safeParse(entry);
    if (one.success) suppliers.push({ ...one.data, checkedAt: one.data.checkedAt ?? head.data.researchedAt });
    else rejected.push({ name: String((entry as { name?: unknown })?.name ?? "?"), reason: `${one.error.issues[0].path.join(".")}: ${one.error.issues[0].message}` });
  }
  return { ok: true, file: { market: head.data.market, researchedAt: head.data.researchedAt, source: head.data.source, cycle: head.data.cycle ?? null, coverage: head.data.coverage, suppliers, rejected } };
}

/** A company as the directory holds it. */
export interface MarketSupplier {
  id: string;
  market: string;
  name: string;
  tradeName: string | null;
  country: string | null;
  city: string | null;
  website: string | null;
  email: string | null;
  phone: string | null;
  role: MarketRole;
  status: MarketStatus;
  materials: string[];
  technologies: string[];
  productTypes: string[];
  profile: MarketProfile;
  evidenceUrl: string;
  sourceLevel: string;
  checkedAt: string | null;
}

const host = (url: string | null | undefined) => {
  try {
    return url ? new URL(url).hostname.replace(/^www\./, "").toLowerCase() : null;
  } catch {
    return null;
  }
};
/** The same company found twice — under a trade name, on another platform — is one record: by its site, else by its name. */
export const sameCompany = (a: { name: string; website?: string | null }, b: { name: string; website?: string | null }) => {
  const [ha, hb] = [host(a.website), host(b.website)];
  if (ha && hb) return ha === hb;
  return companyKey(a.name) === companyKey(b.name);
};

const CONTINENT: Record<string, string[]> = {
  Europe: ["italy", "poland", "germany", "france", "spain", "portugal", "netherlands", "belgium", "austria", "czech republic", "czechia", "slovakia", "hungary", "romania", "bulgaria", "slovenia", "croatia", "serbia", "lithuania", "latvia", "estonia", "greece", "united kingdom", "ireland", "switzerland", "denmark", "sweden", "norway", "finland", "ukraine", "bosnia and herzegovina", "north macedonia", "albania", "moldova", "belarus", "luxembourg", "malta", "cyprus", "iceland", "montenegro", "kosovo"],
  Asia: ["china", "india", "vietnam", "taiwan", "thailand", "indonesia", "malaysia", "south korea", "japan", "pakistan", "bangladesh", "hong kong", "singapore", "philippines", "sri lanka", "turkey", "united arab emirates", "saudi arabia", "israel", "iran", "jordan", "lebanon", "qatar", "kuwait", "kazakhstan"],
  Americas: ["united states", "canada", "mexico", "brazil", "argentina", "colombia", "chile", "peru", "ecuador", "guatemala", "uruguay"],
  Africa: ["south africa", "egypt", "morocco", "tunisia", "nigeria", "kenya", "algeria", "ghana", "ethiopia"],
  Oceania: ["australia", "new zealand"],
};
export const CONTINENTS = ["Europe", "Asia", "Americas", "Africa", "Oceania"] as const;
export type Continent = (typeof CONTINENTS)[number];
export const CONTINENT_LABEL: Record<Continent, Msg> = { Europe: "Europe", Asia: "Asia and the Middle East", Americas: "Americas", Africa: "Africa", Oceania: "Oceania" };
export function continentOf(country: string | null | undefined): Continent | null {
  const key = normalizeKey(countryKey(country) ?? country);
  if (!key) return null;
  return (CONTINENTS.find((c) => CONTINENT[c].includes(key)) as Continent | undefined) ?? null;
}
