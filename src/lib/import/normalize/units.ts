/**
 * Unit of measure normalization — the only place that knows unit spellings.
 *
 * To support a new spelling, add it to `synonyms`. To support a new unit, add
 * an entry. Units in the same `dimension` with a `factor` convert exactly
 * (t ↔ kg, ml ↔ l); packaging units (box, roll, pallet) never convert, because
 * their content differs per product.
 */

export type Dimension = "mass" | "volume" | "length" | "area" | "count" | "pack";

export interface UnitDef {
  /** Canonical code stored in the database. */
  code: string;
  label: string;
  dimension: Dimension;
  /** Size in the dimension's base unit (kg, l, m, m², pcs). Null = not convertible. */
  factor: number | null;
  synonyms: string[];
}

export const UNITS: UnitDef[] = [
  { code: "kg", label: "kilograms", dimension: "mass", factor: 1, synonyms: ["kg", "kgs", "kilo", "kilos", "kilogram", "kilograms", "kilogramme", "kilogrammes", "chilo", "chili", "chilogrammo", "chilogrammi", "kgm"] },
  { code: "g", label: "grams", dimension: "mass", factor: 0.001, synonyms: ["g", "gr", "grs", "gram", "grams", "gramme", "grammo", "grammi"] },
  { code: "t", label: "tonnes", dimension: "mass", factor: 1000, synonyms: ["t", "ton", "tons", "tonne", "tonnes", "tonn", "tonnellata", "tonnellate", "metric ton", "metric tons"] },
  { code: "l", label: "litres", dimension: "volume", factor: 1, synonyms: ["l", "lt", "lts", "ltr", "ltrs", "litre", "litres", "liter", "liters", "litro", "litri"] },
  { code: "ml", label: "millilitres", dimension: "volume", factor: 0.001, synonyms: ["ml", "millilitre", "millilitres", "milliliter", "milliliters", "millilitro", "millilitri"] },
  { code: "m", label: "metres", dimension: "length", factor: 1, synonyms: ["m", "mt", "mtr", "mtrs", "meter", "meters", "metre", "metres", "metro", "metri"] },
  { code: "cm", label: "centimetres", dimension: "length", factor: 0.01, synonyms: ["cm", "centimeter", "centimeters", "centimetre", "centimetres", "centimetro", "centimetri"] },
  { code: "mm", label: "millimetres", dimension: "length", factor: 0.001, synonyms: ["mm", "millimeter", "millimeters", "millimetre", "millimetres", "millimetro", "millimetri"] },
  { code: "m²", label: "square metres", dimension: "area", factor: 1, synonyms: ["m²", "m2", "mq", "sqm", "sq m", "square meter", "square meters", "square metre", "square metres", "metri quadri", "metro quadro"] },
  { code: "pcs", label: "pieces", dimension: "count", factor: 1, synonyms: ["pcs", "pc", "pce", "pces", "piece", "pieces", "pz", "pzz", "pezzo", "pezzi", "nr", "n", "no", "num", "numero", "ea", "each", "unit", "units", "unita", "u", "un", "stk", "stuck"] },
  { code: "box", label: "boxes", dimension: "pack", factor: null, synonyms: ["box", "boxes", "scatola", "scatole", "cf", "conf", "confezione", "confezioni", "pack", "packs", "pkt", "pk", "ct", "ctn", "carton", "cartons", "cartone", "cartoni"] },
  { code: "roll", label: "rolls", dimension: "pack", factor: null, synonyms: ["roll", "rolls", "rotolo", "rotoli", "bobina", "bobine"] },
  { code: "pallet", label: "pallets", dimension: "pack", factor: null, synonyms: ["pallet", "pallets", "bancale", "bancali", "plt"] },
];

const BY_SPELLING = new Map<string, UnitDef>();
for (const u of UNITS) for (const s of [u.code, ...u.synonyms]) BY_SPELLING.set(cleanSpelling(s), u);

function cleanSpelling(s: string) {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\./g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function unitDef(code: string | null | undefined): UnitDef | undefined {
  return code ? BY_SPELLING.get(cleanSpelling(code)) : undefined;
}

/** "KG", "Kilograms", "chilogrammi" → "kg". Null when not recognised. */
export function normalizeUnit(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const s = cleanSpelling(String(raw));
  if (!s) return null;
  return BY_SPELLING.get(s)?.code ?? null;
}

/**
 * Factor to convert a quantity from one unit to another (2 t → 2000 kg:
 * factor 1000). Null when the units are not exactly convertible.
 */
export function conversionFactor(from: string, to: string): number | null {
  if (from === to) return 1;
  const a = unitDef(from);
  const b = unitDef(to);
  if (!a || !b || a.dimension !== b.dimension || a.factor == null || b.factor == null) return null;
  return a.factor / b.factor;
}

/**
 * Splits "2.000 kg" or "25kg" into number text and unit. Returns the input as
 * number text when no known unit is attached.
 */
export function splitQuantityAndUnit(raw: string): { numberText: string; unit: string | null } {
  const m = /^\s*([-+(]?[\d.,'\s]*\d\)?)\s*([^\d\s].*)?$/.exec(raw);
  if (!m) return { numberText: raw, unit: null };
  const unit = m[2] ? normalizeUnit(m[2]) : null;
  return unit ? { numberText: m[1], unit } : { numberText: m[2] ? raw : m[1], unit: null };
}
