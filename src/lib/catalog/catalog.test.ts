import { describe, expect, test } from "vitest";
import { translator } from "../i18n";
import { classify, dominantKind } from "./classify";
import { cleanName } from "./clean";
import { isStrategic } from "./kinds";
import { proposeProducts, splitDraft, type CatalogLine } from "./propose";
import { matchKey, numbersOf, sameNumbers } from "./specs";

describe("clean names", () => {
  test("decoration and shouting go, technical information stays", () => {
    expect(cleanName("** TRECCIOLINO ST 18/08")).toBe("Trecciolino ST 18/08");
    expect(cleanName("  PARAFFINA   SER 52/54 (XXF) ")).toBe("Paraffina SER 52/54 (XXF)");
    expect(cleanName("GASOLIO PER RISCALDAMENTO")).toBe("Gasolio per Riscaldamento");
    expect(cleanName("* TUBOLARE B 2,5")).toBe("Tubolare B 2,5");
    expect(cleanName("KG1 CAFFE&apos; CLASSICO GRANI")).toBe("KG1 Caffe' Classico Grani");
  });

  test("codes, sizes and abbreviations are never rewritten", () => {
    expect(cleanName("TL 10 15 A 1 0 P 30 CC 12 CICOGNA BEST CHOICE 30X12")).toBe("TL 10 15 A 1 0 P 30 CC 12 Cicogna Best Choice 30X12");
    expect(cleanName("F60/8N - Fondelli diam.60")).toBe("F60/8N - Fondelli diam.60");
    expect(cleanName("FIAMMETTA PP BIANCA")).toBe("Fiammetta PP Bianca");
  });

  test("text already written properly is left alone", () => {
    expect(cleanName("Candela Liturgica Altare Ø 22x400 mm 3200pz.")).toBe("Candela Liturgica Altare Ø 22x400 mm 3200pz.");
    expect(cleanName("Bicch ASSO100")).toBe("Bicch ASSO100");
    expect(cleanName("")).toBe("");
  });
});

describe("numbers are the specification", () => {
  test("each number is read one way", () => {
    expect(numbersOf("PARAFFINA 52/54")).toEqual(["52", "54"]);
    expect(numbersOf("TRECCIOLINO ST 18/08")).toEqual(["18", "8"]);
    expect(numbersOf("TUBOLARE B 2,5")).toEqual(["2.5"]);
    expect(numbersOf("LEGNO NF (0.76) 19.1X128 MM")).toEqual(["0.76", "19.1", "128"]);
    expect(numbersOf("Paraffina")).toEqual([]);
  });

  test("a different number is a different product", () => {
    expect(sameNumbers(numbersOf("TRECCIOLINO TG 1204"), numbersOf("TRECCIOLINO TG 1206"))).toBe(false);
    expect(sameNumbers(numbersOf("ST 18/08"), numbersOf("ST 18-08"))).toBe(true);
  });

  test("the same description written twice has one key", () => {
    expect(matchKey("PARAFFINA SER 52/54")).toBe(matchKey("Paraffina  SER 52-54"));
    expect(matchKey("ART.60L BLU Contenitori x ceri")).toBe(matchKey("ART. 60 L BLU Contenitori per ceri"));
    // "x" between numbers is a size, not a filler word.
    expect(matchKey("Scatola 30 x 12")).toBe(matchKey("SCATOLA 30X12"));
    expect(matchKey("ART. 60 L BIA")).not.toBe(matchKey("ART. 60 L GIA"));
  });
});

describe("what a line is", () => {
  const kind = (text: string, supplierName?: string) => classify({ text, supplierName }).kind;

  test("the examples that define the kinds", () => {
    expect(kind("PARAFFINA SER 52/54 (XXF)")).toBe("direct_material");
    expect(kind("Fragranza Incenso")).toBe("direct_material");
    expect(kind("STOPPINO LEGNO NF (0.76) 19.1 X 65")).toBe("component");
    expect(kind("* TRECCIOLINO TG 1206")).toBe("component");
    expect(kind("Bicch ASSO100")).toBe("component");
    expect(kind("SCATOLA AMERICANA C12 - F.TO 420X310X240")).toBe("packaging");
    expect(kind("ADDEBITO TRASPORTO")).toBe("logistics");
    expect(kind("Consulenza fiscale mese di maggio")).toBe("service");
    expect(kind("(D)50 BICCH. CAFFE CARTA")).toBe("indirect");
    expect(kind("Risma Carta A4 per Stampante")).toBe("indirect");
    expect(kind("MONITORAGGIO ALLARMI E INTERVENTO FA")).toBe("service");
    expect(kind("Energia elettrica - quota consumi")).toBe("energy");
    expect(kind("ELETTROV.PARKER:7321B AN00 - 1/2")).toBe("equipment");
    expect(kind("Contributo Conai Carta Fascia 1")).toBe("other");
  });

  test("a word decides only where it can't mean something else", () => {
    // Transport at the start of the line is transport; inside a product name it is not.
    expect(kind("Spese di trasporto")).toBe("logistics");
    expect(kind("Scatola rinforzata per trasporto candele")).toBe("packaging");
    // The container is not what was bought.
    expect(kind("SCATOLE DI CARBONCINI ACC. RAPIDA")).toBe("direct_material");
    expect(kind("CARTONI DA N. 50.000 FERMAGLI METALLICI")).toBe("component");
    // The first product named decides: containers for candles are containers.
    expect(kind("ART. LC TR. Contenitori per ceri")).toBe("component");
    expect(kind("CERA PER STOPPINI CTJW")).toBe("direct_material");
    // A wick tube is not a pipe; a grapefruit fragrance is not a pump.
    expect(kind("TUBOLARE CR 43")).toBe("component");
    expect(kind("FRAGRANZA POMPELMO ROSA")).toBe("direct_material");
  });

  test("a charge is never the product, even when the line names one", () => {
    expect(kind("COMPAR.SPESE IMP.STAMPA - SCATOLA AMERICANA C26")).toBe("other");
    expect(kind("Down Payment no. 2640552")).toBe("other");
    // On a utility bill a discount is part of that spend.
    expect(classify({ text: "Sconto promozione", supplierKind: "energy" })).toEqual({ kind: "service", by: "words" });
    expect(classify({ text: "Accredito mese parziale", supplierKind: "energy" })).toEqual({ kind: "energy", by: "supplier" });
    expect(classify({ text: "Accredito mese parziale", supplierKind: "component" })).toEqual({ kind: "other", by: "words" });
  });

  test("a carrier's lines are transport whatever they mention", () => {
    expect(classify({ text: "PALLET NON SOVRAPPONIBILE 8369307704", supplierName: "DHL EXPRESS (ITALY) S.R.L." })).toEqual({ kind: "logistics", by: "supplier" });
    expect(classify({ text: "Rif.cl 959 del 12/05/2026 linea MB- -OT-1 co 1 KG 145,0 Nolo", supplierName: "CALONI GROUPAGE S.R.L." }).kind).toBe("logistics");
  });

  test("words that say nothing are left unclassified, never guessed", () => {
    expect(classify({ text: "GELSOMINO SAMBAC ING00037", supplierName: "GRC Parfum S.p.A." })).toEqual({ kind: "needs_review", by: "none" });
    expect(classify({ text: "50x70 - BEST CHOICE - ARTICOLO 60T" })).toEqual({ kind: "needs_review", by: "none" });
    expect(isStrategic("needs_review")).toBe(true);
    expect(isStrategic("logistics")).toBe(false);
    expect(isStrategic(undefined)).toBe(true);
  });

  test("what a supplier sells is taken only from lines that are clear, and only when they agree", () => {
    expect(dominantKind([{ kind: "component", amount: 900 }, { kind: null, amount: 100 }])).toBe("component");
    // Too little is known.
    expect(dominantKind([{ kind: "service", amount: 100 }, { kind: null, amount: 900 }])).toBeNull();
    // The clear lines disagree.
    expect(dominantKind([{ kind: "component", amount: 500 }, { kind: "packaging", amount: 500 }])).toBeNull();
    // Fees say nothing about what the supplier sells.
    expect(dominantKind([{ kind: "other", amount: 900 }, { kind: null, amount: 100 }])).toBeNull();
  });
});

describe("proposing products", () => {
  let n = 0;
  const line = (supplierName: string, text: string, o: Partial<CatalogLine> = {}): CatalogLine => ({ id: String(++n), supplierId: supplierName, supplierName, text, unit: "kg", unitPrice: 1, amount: 100, ...o });
  const it = translator("it");

  test("the same description written in different ways is one product, with every spelling kept", () => {
    const a = proposeProducts([line("SER", "PARAFFINA SER 52/54", { amount: 4000 }), line("SER", "Paraffina  SER 52-54", { amount: 1000 }), line("SER", "PARAFFINA SER 52/54", { amount: 500 })]);
    expect(a.descriptions).toBe(2);
    expect(a.confident).toHaveLength(1);
    expect(a.confident[0]).toMatchObject({ name: "Paraffina SER 52/54", kind: "direct_material", strategic: true, unit: "kg", lines: 3, amount: 5500, descriptions: 2 });
    expect(a.confident[0].mentions[0].texts.sort()).toEqual(["PARAFFINA SER 52/54", "Paraffina SER 52-54"]);
    expect(a.grouped).toBe(2);
    expect(a.questions).toEqual([]);
  });

  test("names that differ in a number are two products — and nobody is asked", () => {
    const a = proposeProducts([
      line("Monterosa", "* TRECCIOLINO TG 1204", { supplierSku: "PFTRTG1204", unitPrice: 34.48 }),
      line("Monterosa", "* TRECCIOLINO TG 1206", { supplierSku: "PFTRTG1206", unitPrice: 33.48 }),
    ]);
    expect(a.confident.map((d) => d.name).sort()).toEqual(["Trecciolino TG 1204", "Trecciolino TG 1206"]);
    expect(a.questions).toEqual([]);
    expect(a.grouped).toBe(0);
  });

  test("the supplier's own code joins two descriptions when the sizes agree", () => {
    const a = proposeProducts([
      line("Domus", "Ostie sottili conf. 25 pezzi 74 mm spessore 1 mm", { supplierSku: "OS-25", unit: "box" }),
      line("Domus", "(confezione larga) Ostie sottili conf. 25 pezzi 74 mm spessore 1 mm", { supplierSku: "OS-25", unit: "box" }),
    ]);
    expect(a.confident).toHaveLength(1);
    expect(a.confident[0]).toMatchObject({ reason: "Same supplier code, same sizes", descriptions: 2, lines: 2 });
    expect(splitDraft(a.confident[0]).map((d) => d.descriptions)).toEqual([1, 1]);
  });

  test("the same code with different sizes is a question, with what the evidence points to", () => {
    const a = proposeProducts([
      line("Bianchi", "Candela Liturgica Altare Ø 22x400 mm", { supplierSku: "CLA", unitPrice: 4.25, amount: 1700 }),
      line("Bianchi", "Candela Liturgica Altare Ø 25x160 mm", { supplierSku: "CLA", unitPrice: 4.25, amount: 270 }),
      line("Bianchi", "Candela Liturgica Altare Ø 35x200 mm", { supplierSku: "CLA", unitPrice: 4.25, amount: 240 }),
    ]);
    expect(a.confident).toEqual([]);
    expect(a.questions).toHaveLength(1);
    expect(a.questions[0]).toMatchObject({ type: "same", suggestion: "merge", mergedName: "Candela Liturgica Altare", lines: 3, amount: 2210 });
    expect(a.questions[0].drafts).toHaveLength(3);
    expect(it(a.questions[0].reason)).toBe("Stesso codice fornitore, ma le misure scritte sono diverse");
    // A different price says the sizes are priced apart: keep them separate.
    const b = proposeProducts([line("MG", "CARTA PAGLIA 27X35", { supplierSku: "PAGLIA", unitPrice: 1.89 }), line("MG", "CARTA PAGLIA 30X40", { supplierSku: "PAGLIA", unitPrice: 2.4 })]);
    expect(b.questions[0].suggestion).toBe("separate");
  });

  test("same words, unit and price with one number changed: asked, and the suggestion is to keep them apart", () => {
    const a = proposeProducts([line("Erre", "ART. 50/0 Contenitori per ceri", { unitPrice: 0.1037, unit: "pcs" }), line("Erre", "ART. 50/2 Contenitori per ceri", { unitPrice: 0.1037, unit: "pcs" })]);
    expect(a.questions).toHaveLength(1);
    expect(a.questions[0]).toMatchObject({ type: "same", suggestion: "separate" });
    // A different price: two products, no question.
    const b = proposeProducts([line("Erre", "ART. 20/2 Contenitori per ceri", { unitPrice: 0.07 }), line("Erre", "ART. 30/2 Contenitori per ceri", { unitPrice: 0.08 })]);
    expect(b.questions).toEqual([]);
    expect(b.confident).toHaveLength(2);
    // Our own codes on the supplier's invoice say they are two articles.
    const c = proposeProducts([line("Euro", "SCATOLA AMERICANA C7 - 421X342X217", { ownSku: "SCATOLA C7", unitPrice: 0.385 }), line("Euro", "SCATOLA AMERICANA C8 - 421X342X217", { ownSku: "SCATOLA C8", unitPrice: 0.385 })]);
    expect(c.questions).toEqual([]);
    expect(c.confident.map((d) => d.sku).sort()).toEqual(["SCATOLA C7", "SCATOLA C8"]);
  });

  test("the same description from two suppliers is a question, not a merge", () => {
    const a = proposeProducts([line("A", "Paraffina 58/60 in pastiglie"), line("B", "PARAFFINA 58/60 IN PASTIGLIE")]);
    expect(a.confident).toEqual([]);
    expect(a.questions[0]).toMatchObject({ type: "same", suggestion: "merge", reason: "Same description from two suppliers" });
    expect(a.questions[0].supplierIds.sort()).toEqual(["A", "B"]);
  });

  test("spend that is not a product becomes one item per supplier and kind, whatever each line says", () => {
    const lines = [
      ...[959, 997, 1002, 1011].map((ref) => line("CALONI GROUPAGE S.R.L.", `Rif.cl ${ref} del 12/05/2026 linea MB- -OT-1 co 1 KG 145,0 Nolo`, { unit: null, amount: 50 })),
      line("Esselunga S.p.A.", "Scarico bancale-Ordine 2600739740 ricevuto in data 30.07.2026", { unit: "pcs", amount: 12.8 }),
      line("Esselunga S.p.A.", "Scarico bancale-Ordine 2600572085 ricevuto in data 04.06.2026", { unit: "pcs", amount: 11.2 }),
      line("Esselunga S.p.A.", "Acconto per attività promozionale salvo conguaglio 2026", { unit: "pcs", amount: 5000 }),
      line("Bassignani", "GASOLIO PER RISCALDAMENTO", { unit: "l", unitPrice: 1.31, amount: 6550 }),
    ];
    const a = proposeProducts(lines, { t: it });
    expect(a.descriptions).toBe(8);
    expect(a.products).toBe(0);
    expect(a.otherSpend).toBe(4);
    expect(a.questions).toEqual([]);
    expect(a.confident.map((d) => [d.name, d.kind, d.unit, d.lines])).toEqual([
      ["Gasolio per Riscaldamento — Bassignani", "energy", "l", 1],
      ["Acconto per attività promozionale salvo conguaglio 2026 — Esselunga S.p.A.", "service", "pcs", 1],
      ["Trasporti e logistica — CALONI GROUPAGE S.R.L.", "logistics", "pcs", 4],
      ["Trasporti e logistica — Esselunga S.p.A.", "logistics", "pcs", 2],
    ]);
    expect(a.confident.every((d) => !d.strategic)).toBe(true);
    expect(a.grouped).toBe(6);
  });

  test("lines nobody can classify are one question per supplier, largest spend first", () => {
    const a = proposeProducts([
      line("Special Screen", "50x70 - BEST CHOICE - ARTICOLO 60T", { supplierSku: "290610", amount: 1000 }),
      line("Special Screen", "55x55 - MADONNA DEL FRASSINO", { supplierSku: "290675", amount: 675 }),
      line("GRC Parfum", "GELSOMINO SAMBAC ING00037", { amount: 9000 }),
      line("SER", "PARAFFINA SER 52/54", { amount: 400000 }),
    ]);
    expect(a.confident.map((d) => d.name)).toEqual(["Paraffina SER 52/54"]);
    expect(a.questions.map((q) => [q.type, q.supplierIds[0], q.drafts.length, q.amount])).toEqual([
      ["kind", "GRC Parfum", 1, 9000],
      ["kind", "Special Screen", 2, 1675],
    ]);
    // The user says what they are: products are one per description, spend is one item.
    const asProducts = proposeProducts([line("Special Screen", "50x70 - BEST CHOICE - ARTICOLO 60T"), line("Special Screen", "55x55 - MADONNA DEL FRASSINO")], { kindBySupplier: new Map([["Special Screen", "packaging"]]) });
    expect(asProducts.confident.map((d) => d.kind)).toEqual(["packaging", "packaging"]);
    const asSpend = proposeProducts([line("Magni", "ESSELUNGA Chiari"), line("Magni", "STAMPATI VS.DDT.")], { kindBySupplier: new Map([["Magni", "logistics"]]) });
    expect(asSpend.confident).toHaveLength(1);
    expect(asSpend.confident[0]).toMatchObject({ kind: "logistics", lines: 2, strategic: false });
  });

  test("what a supplier sells classifies its unclear lines", () => {
    const a = proposeProducts([
      line("Monterosa", "STOPPINO LEGNO NF (0.76) 19.1 X 65", { amount: 760 }),
      line("Monterosa", "* TRECCIOLINO TG 1206", { amount: 540 }),
      line("Monterosa", "LEGNO NF (0.76) 19.1X128 MM", { amount: 920 }),
    ]);
    expect(a.questions).toEqual([]);
    expect(a.confident.find((d) => d.name.startsWith("LEGNO") || d.name.startsWith("Legno"))).toMatchObject({ kind: "component" });
  });

  test("keys are stable, so a decision taken on what was shown applies to the same thing", () => {
    const lines = [line("SER", "PARAFFINA SER 52/54"), line("Bianchi", "Candela Ø 22x400", { supplierSku: "CLA" }), line("Bianchi", "Candela Ø 25x160", { supplierSku: "CLA" })];
    const [a, b] = [proposeProducts(lines), proposeProducts([...lines].reverse())];
    expect(a.confident.map((d) => d.key)).toEqual(b.confident.map((d) => d.key));
    expect(a.questions.map((q) => q.key)).toEqual(b.questions.map((q) => q.key));
  });
});
