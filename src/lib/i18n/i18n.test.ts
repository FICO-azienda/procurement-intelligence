import { describe, expect, it as test } from "vitest";
import type { Dataset } from "../analytics";
import { countryKey, countryName, flagOf } from "../countries";
import * as f from "../format";
import { compareColumns, purchasingOverview } from "../intel/decision";
import { analyze } from "../intel/engine";
import { explanations } from "../intel/explain";
import { dataset, link, product, purchase, quote, supplier } from "../intel/fixtures";
import { fieldErrors, purchaseInput } from "../validation";
import { en, list, said, say, translator, type Msg } from "./index";
import { PARTS, it } from "./it";

const italian = translator("it");
const placeholders = (s: string) => [...s.matchAll(/\{~?\w+\}/g)].map((m) => m[0]).sort();

describe("the Italian dictionary", () => {
  test("keeps every placeholder of the English text", () => {
    const broken = Object.entries(it).filter(([key, value]) => placeholders(key).join() !== placeholders(value).join());
    expect(broken.map(([key]) => key)).toEqual([]);
  });

  test("leaves nothing empty", () => {
    expect(Object.entries(it).filter(([key, value]) => key.trim() !== "" && value.trim() === "").map(([key]) => key)).toEqual([]);
  });

  test("never translates the same text in two different ways", () => {
    const seen = new Map<string, string>();
    const conflicts: string[] = [];
    for (const part of Object.values(PARTS)) {
      for (const [key, value] of Object.entries(part)) {
        if (seen.has(key) && seen.get(key) !== value) conflicts.push(key);
        seen.set(key, value);
      }
    }
    expect(conflicts).toEqual([]);
  });

  test("keeps the vocabulary strict: no 'best supplier', no saving called realised", () => {
    const text = Object.values(it).join("\n").toLowerCase();
    expect(text).not.toMatch(/miglior fornitore|fornitore migliore|vincitore|fornitore consigliato/);
    expect(text).not.toMatch(/cambia fornitore\b/);
  });
});

describe("translator", () => {
  test("English is the text as written, without the context marker", () => {
    expect(en("Add purchase")).toBe("Add purchase");
    expect(en("Review|status")).toBe("Review");
    expect(en("Open|status")).toBe("Open");
    expect(en.locale).toBe("en");
  });

  test("Italian comes from the dictionary; the same word can have two meanings", () => {
    expect(italian("Add purchase")).toBe("Aggiungi acquisto");
    expect(italian("Review|status")).toBe("Da rivedere");
    expect(italian("Review|verb")).toBe("Controlla");
    expect(italian.locale).toBe("it");
  });

  test("fills values, and leaves a placeholder without a value as written", () => {
    expect(en("Price up {pct}% in 12 months.", { pct: "7,0" })).toBe("Price up 7,0% in 12 months.");
    expect(italian("Price up {pct}% in 12 months.", { pct: "7,0" })).toBe("Prezzo aumentato del 7,0% in 12 mesi.");
    expect(italian("{amount}/year")).toBe("{amount}/anno");
  });

  test("a value that is a message is translated on the way in", () => {
    expect(en("{~label} is required", { label: "Quantity" })).toBe("Quantity is required");
    expect(italian("{~label} is required", { label: "Quantity" })).toBe("Quantità: campo obbligatorio");
  });

  test("counts choose singular or plural and format the number", () => {
    expect(en.n(1, "{n} product", "{n} products")).toBe("1 product");
    expect(en.n(1200, "{n} product", "{n} products")).toBe("1.200 products");
    expect(italian.n(1, "{n} product", "{n} products")).toBe("1 prodotto");
    expect(italian.n(3, "{n} product", "{n} products")).toBe("3 prodotti");
  });

  test("text that is not a message comes back untouched", () => {
    expect(italian.any("Vetreria Rossi S.p.A.")).toBe("Vetreria Rossi S.p.A.");
    expect(italian.any("The file is empty.")).toBe("Il file è vuoto.");
  });

  test("Italian articles follow how the number is said", () => {
    const up = (pct: string) => italian("Price up {pct}% in 12 months.", { pct });
    expect(up("12,0")).toBe("Prezzo aumentato del 12,0% in 12 mesi.");
    expect(up("8,0")).toBe("Prezzo aumentato dell'8,0% in 12 mesi.");
    expect(up("11,3")).toBe("Prezzo aumentato dell'11,3% in 12 mesi.");
    expect(up("80,5")).toBe("Prezzo aumentato dell'80,5% in 12 mesi.");
    expect(up("1,5")).toBe("Prezzo aumentato dell'1,5% in 12 mesi.");
    expect(up("0,5")).toBe("Prezzo aumentato dello 0,5% in 12 mesi.");
    expect(up("18,0")).toBe("Prezzo aumentato del 18,0% in 12 mesi.");
    expect(up("100,0")).toBe("Prezzo aumentato del 100,0% in 12 mesi.");
    expect(italian("{share} of your spend is bought from one supplier", { share: "8,2%" })).toBe("L'8,2% della tua spesa è comprato da un solo fornitore");
    expect(italian("{share} of your spend is bought from one supplier", { share: "46,2%" })).toBe("Il 46,2% della tua spesa è comprato da un solo fornitore");
    // A date is not a quantity: it keeps the article as written.
    expect(italian("Uploaded {date}", { date: "08/09/2026 10:30" })).toBe("Caricato il 08/09/2026 10:30");
    // English is never touched.
    expect(en("Price up {pct}% in 12 months.", { pct: "8,0" })).toBe("Price up 8,0% in 12 months.");
    // A value is never rewritten: a name keeps the words it has.
    expect(italian('Unknown product "{name}"', { name: "Listino del 8 settembre.pdf" })).toBe('Prodotto sconosciuto "Listino del 8 settembre.pdf"');
  });

  test("lists read naturally in both languages", () => {
    expect(list(en, ["a", "b", "c"])).toBe("a, b and c");
    expect(list(italian, ["a", "b", "c"])).toBe("a, b e c");
    expect(list(italian, ["a"])).toBe("a");
  });
});

describe("messages kept in the database", () => {
  test("are stored in English with what is needed to say them in Italian later", () => {
    const stored = say("Converted from {from} to {to}", { from: "t", to: "kg" });
    expect(stored.message).toBe("Converted from t to kg");
    const back = JSON.parse(JSON.stringify(stored));
    expect(said(en, back)).toBe("Converted from t to kg");
    expect(said(italian, back)).toBe("Convertito da t a kg");
  });

  test("a message stored before translations existed is still shown", () => {
    expect(said(italian, { message: "Date missing" })).toBe("Manca la data");
    expect(said(italian, { message: "Something written by an older version" })).toBe("Something written by an older version");
  });

  test("a field name inside a stored message is translated too", () => {
    const stored = say('{~label}: "{value}" is not a valid number', { label: "Unit price", value: "abc" });
    expect(stored.message).toBe('Unit price: "abc" is not a valid number');
    expect(said(italian, stored)).toBe('Prezzo unitario: "abc" non è un numero valido');
  });
});

describe("formatting", () => {
  test("words follow the language, numbers and dates stay Italian", () => {
    expect(f.month("2026-09-15")).toBe("Sep 2026");
    expect(f.month("2026-09-15", italian)).toBe("set 2026");
    expect(f.month("2026-05-02")).toBe("May 2026");
    expect(f.month("2026-05-02", italian)).toBe("mag 2026");
    expect(f.days(1, italian)).toBe("1 giorno");
    expect(f.days(14, italian)).toBe("14 giorni");
    expect(f.days(14)).toBe("14 days");
    expect(f.paymentTerms(0, italian)).toBe("Anticipato");
    expect(f.paymentTerms(60, italian)).toBe("60 giorni");
    expect(f.paymentTerms(60)).toBe("60 days");
    expect(f.money(1234.5)).toBe("€1.234,50");
  });
});

describe("form errors", () => {
  test("name the field in the reader's language", () => {
    const parsed = purchaseInput.safeParse({ productId: "", supplierId: "", date: "", quantity: "-2", unitPrice: "abc", currency: "EUR" });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(fieldErrors(parsed.error)).toMatchObject({ productId: "Select a product", date: "Date is required", quantity: "Quantity must be greater than 0", unitPrice: "Unit price must be a number" });
    expect(fieldErrors(parsed.error, italian)).toMatchObject({
      productId: "Seleziona un prodotto",
      date: "Data: campo obbligatorio",
      quantity: "Quantità: deve essere maggiore di 0",
      unitPrice: "Prezzo unitario: deve essere un numero",
    });
  });
});

describe("countries", () => {
  test("one country, whatever language it was typed in", () => {
    expect(countryKey("Italia")).toBe(countryKey("Italy"));
    expect(countryKey(" turchia ")).toBe(countryKey("Turkey"));
    expect(countryKey("Italy")).not.toBe(countryKey("Germany"));
    expect(countryKey("Atlantis")).toBe("atlantis");
    expect(countryKey(null)).toBeNull();
  });

  test("named in the reader's language, as written when unknown", () => {
    expect(countryName("Italy", "it")).toBe("Italia");
    expect(countryName("Italia", "en")).toBe("Italy");
    expect(countryName("Atlantis", "it")).toBe("Atlantis");
    expect(countryName(null, "it")).toBeNull();
    expect(flagOf("Italia")).toBe(flagOf("Italy"));
  });
});

// ---------------- The engines, in Italian ----------------

const AS_OF = "2026-10-01";

/** A small company that touches every kind of sentence the engines write. */
function company() {
  const acme = supplier({ name: "Acme", country: "Italy", paymentTermsDays: 60, defaultLeadTimeDays: 12 });
  const borg = supplier({ name: "Borg", country: "Italia", paymentTermsDays: 30, defaultLeadTimeDays: 30 });
  const ankara = supplier({ name: "Ankara Cam", country: "Turkey", currency: "USD", paymentTermsDays: 0, defaultLeadTimeDays: 45 });
  const lone = supplier({ name: "Lone", country: "Germany" });

  const widget = product({ name: "Widget", category: "Parts", currentSupplierId: acme.id, specs: { weight: "210 g" } });
  const gadget = product({ name: "Gadget", category: "Parts", currentSupplierId: lone.id });
  const nothing = product({ name: "Nothing", category: "Other" });
  const stale = product({ name: "Stale", category: "Other", currentSupplierId: lone.id });

  const dates = ["2025-11-10", "2026-01-10", "2026-03-10", "2026-06-12", "2026-09-15"];
  const data: Dataset = dataset({
    suppliers: [acme, borg, ankara, lone],
    products: [widget, gadget, nothing, stale],
    purchases: [
      ...[1.4, 1.42, 1.45, 1.52, 1.62].map((unitPrice, i) => purchase({ productId: widget.id, supplierId: acme.id, date: dates[i], quantity: 5000, unitPrice })),
      ...[2, 2, 2.3].map((unitPrice, i) => purchase({ productId: gadget.id, supplierId: lone.id, date: dates[i + 2], quantity: 20_000, unitPrice })),
      purchase({ productId: stale.id, supplierId: lone.id, date: "2025-12-01", quantity: 100, unitPrice: 9 }),
    ],
    quotes: [
      quote({ productId: widget.id, supplierId: borg.id, date: "2026-09-20", unitPrice: 1.45, moq: 2000, leadTimeDays: 30, paymentTermsDays: 30, incoterm: "EXW" }),
      quote({ productId: widget.id, supplierId: ankara.id, date: "2026-03-01", unitPrice: 1.2, currency: "USD", fxRate: 0.92, moq: 40_000, leadTimeDays: 45, paymentTermsDays: 0, validUntil: "2026-04-01" }),
      quote({ productId: gadget.id, supplierId: ankara.id, date: "2026-09-25", unitPrice: 2, currency: "USD", fxRate: null }),
    ],
  });
  const links = [link({ supplierId: borg.id, productId: widget.id, specs: { weight: "180 g" } })];
  return { data, links, acme, borg, widget };
}

/** Words that only English sentences contain (names, units and codes never do). */
const ENGLISH = /\b(the|and|is|are|was|your|you|from|with|not|yet|only|price|supplier|suppliers|purchase|purchases|quote|quotes|spend|than|before|ask|check|of)\b/i;

describe("the engines write Italian when asked to", () => {
  const { data, links, acme, borg, widget } = company();
  const intel = analyze(data, links, [], AS_OF, undefined, italian);
  const overview = purchasingOverview(intel, italian);
  const english = purchasingOverview(analyze(data, links, [], AS_OF));

  const sentences = [
    ...overview.executiveSummary,
    ...overview.topOpportunities.map((o) => o.reason),
    ...overview.recentChanges.map((c) => c.text.replace(/Acme|Borg|Ankara Cam|Lone/g, "X")),
    ...overview.products.flatMap((d) => [
      d.statusReason,
      ...d.summary,
      d.supplyRisk.label,
      d.supplyRisk.detail,
      ...d.missingData,
      ...d.dataConfidenceReasons,
      ...(d.cheapestNotFirst ? [d.cheapestNotFirst.explanation] : []),
      ...d.nextActions.flatMap((a) => [a.label, ...a.why.flatMap((w) => [w.label, w.value])]),
      ...d.alternatives.flatMap((a) => [...a.flags.map((x) => x.label), ...(a.notComparableReason ? [a.notComparableReason] : [])]),
    ]),
    ...intel.opportunities.flatMap((o) => [o.reason, ...o.missing, ...o.factors.flatMap((x) => [x.label, x.detail])]),
    ...intel.products.flatMap((p) => [...p.summary, ...p.quality.factors.flatMap((q) => [q.label, q.detail]), ...p.comparison.flatMap((r) => r.comparabilityReasons), ...compareColumns(p, intel.config, italian).flatMap((c) => c.highlights)]),
    ...intel.suppliers.flatMap((s) => s.summary),
    ...Object.values(explanations(intel.config, italian)),
  ].map((s) => s.replace(/Acme|Borg|Ankara Cam|Lone|Widget|Gadget|Nothing|Stale|landed cost|TCO|Incoterm|EXW/g, "X"));

  test("no English is left in any sentence", () => {
    expect(sentences.length).toBeGreaterThan(120);
    expect(sentences.filter((s) => ENGLISH.test(s))).toEqual([]);
  });

  test("no placeholder is left unfilled", () => {
    expect(sentences.filter((s) => /\{~?\w+\}/.test(s))).toEqual([]);
  });

  test("the numbers are the same in both languages: only the words change", () => {
    expect(overview.totals).toEqual(english.totals);
    expect(overview.products.map((d) => [d.productId, d.status, d.potentialSaving, d.priority])).toEqual(english.products.map((d) => [d.productId, d.status, d.potentialSaving, d.priority]));
  });

  test("says the same thing, in Italian", () => {
    const d = overview.products.find((x) => x.productId === widget.id)!;
    expect(d.summary[0]).toBe("Paghi €1,62/kg a Acme, il 15,7% in più rispetto al tuo primo acquisto registrato (nov 2025).");
    expect(d.nextActions[0].label).toBe("Chiedi a Acme di rivedere il prezzo");
    expect(d.supplyRisk.label).toBe("Fornitore unico");
    expect(english.products.find((x) => x.productId === widget.id)!.nextActions[0].label).toBe("Ask Acme to review their price");
  });

  test("two suppliers in Italy are not an import, even if one says Italia", () => {
    const d = overview.products.find((x) => x.productId === widget.id)!;
    const alt = d.alternatives.find((a) => a.supplierId === borg.id)!;
    expect(acme.country).not.toBe(borg.country);
    expect(alt.flags.map((x) => x.key)).not.toContain("import");
  });
});

// Keeps the checked type honest: a text that is not in the dictionary must not compile.
// @ts-expect-error — not a message
const _notAMessage: Msg = "This sentence was never translated";
void _notAMessage;
