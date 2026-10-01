/**
 * Reads invoice and quote fields from PDF text lines. Rule-based and modular:
 * each field has its own finder with a confidence, so a smarter extractor
 * (layout models, LLM) can replace one finder at a time.
 *
 * A line item is trusted when quantity × unit price = line amount. Lines that
 * can't be verified get a low confidence and go to review.
 */
import { OWN_COMPANY_NAMES, OWN_VAT_NUMBERS } from "../../config";
import { currencyInText } from "../normalize/currency";
import { findDate, parseDate } from "../normalize/dates";
import { amountsMatch, detectDecimalStyle, parseNumber, round2, type DecimalStyle } from "../normalize/numbers";
import { parseIncoterm, parseLeadTime, parsePaymentTerms } from "../normalize/terms";
import { companyKey, tidy, vatKey } from "../normalize/text";
import { normalizeUnit } from "../normalize/units";
import { EMPTY_ITEM, type DraftItem, type Issue, type ItemData } from "../types";
import type { PdfLine } from "./pdf";

export type DocKind = "invoice" | "quote";

export interface Found<T> {
  value: T | null;
  /** 0–1. Labelled values ("Data fattura: …") are high, guesses are low. */
  confidence: number;
  raw?: string;
}

export interface ExtractedLine {
  line: number;
  text: string;
  description: string | null;
  code: string | null;
  quantity: number | null;
  unit: string | null;
  unitPrice: number | null;
  amount: number | null;
  confidence: number;
  ambiguousNumbers: boolean;
}

export interface DocumentExtraction {
  kind: DocKind;
  /** What the document says it is, if it says. */
  detectedKind: DocKind | null;
  supplierName: Found<string>;
  supplierVat: Found<string>;
  number: Found<string>;
  date: Found<string>;
  validUntil: Found<string>;
  currency: Found<string>;
  paymentTermsDays: Found<number>;
  incoterm: Found<string>;
  leadTimeDays: Found<number>;
  moq: Found<number>;
  freight: Found<number>;
  total: Found<number>;
  notes: string | null;
  lines: ExtractedLine[];
  /** All text, for matching known supplier names. */
  fullText: string;
}

const none = <T>(): Found<T> => ({ value: null, confidence: 0 });

const LEGAL_FORM = /\b(s\.?\s?r\.?\s?l\.?s?|s\.?\s?p\.?\s?a\.?|s\.?\s?a\.?\s?s\.?|s\.?\s?n\.?\s?c\.?|ltd\.?|limited|gmbh|s\.?a\.?r\.?l\.?|s\.?l\.?u?|b\.?v\.?|inc\.?|llc|sp\.?\s?z\s?o\.?\s?o\.?|a\.?\s?ş\.?|oy|ab)\b/i;
const CUSTOMER_LABEL = /\b(spett\.?le|destinatario|cliente|customer|bill\s*to|ship\s*to|sold\s*to|intestatario|consegna a|deliver to)\b/i;
const NUMERIC_TOKEN = /^[-+(]?[€$£]?\d[\d.,']*\)?$/;
const STOP_LINE = /^(totale|total|imponibile|subtotal|sub-total|iva\b|vat\b|importo\s+iva|tot\.|netto a pagare|amount due|grand total)/i;
const NOT_ITEM = /\b(iban|swift|bic|banca|bank|p\.?\s?iva|partita iva|vat\s*(no|number|id)|codice fiscale|tel\.?|fax|e-?mail|www\.|pec|cap\s*sociale|r\.?e\.?a\.?|pagina|page \d)\b/i;
/** Lines that state terms, not products (their values are read by the field finders). */
const TERMS_LINE = /^\s*(minimum order|minimo\s+d['’]?\s*ordine|moq|lotto minimo|quantit[aà] minima|lead\s*time|tempi di consegna|tempo di consegna|delivery|consegna|payment|pagamento|condizioni|valid|validit|scadenza|freight|trasporto|incoterm|resa|quote date|data offerta|date|data)\b/i;

function isOwn(text: string) {
  const k = companyKey(text);
  return OWN_COMPANY_NAMES.some((n) => {
    const own = companyKey(n);
    return own && (k === own || k.includes(own));
  });
}

function findLabelled(lines: PdfLine[], label: RegExp, value: RegExp): { match: RegExpExecArray; line: PdfLine } | null {
  for (const line of lines) {
    const re = new RegExp(label.source + String.raw`\s*[:.#°º]?\s*(?:n(?:r|o|um)?\.?\s*[:.°º]?\s*)?` + value.source, "i");
    const m = re.exec(line.text);
    if (m) return { match: m, line };
  }
  return null;
}

export function extractDocument(lines: PdfLine[], requested: DocKind): DocumentExtraction {
  const fullText = lines.map((l) => l.text).join("\n");
  const style: DecimalStyle | null = detectDecimalStyle(
    lines.flatMap((l) => l.text.split(/\s+/)).filter((t) => NUMERIC_TOKEN.test(t)),
  ).style;
  const num = (s: string) => parseNumber(s, style);

  // ---- What kind of document
  const head = lines.slice(0, 25).map((l) => l.text).join(" ");
  const detectedKind: DocKind | null = /\b(fattura|invoice|rechnung|factura|nota di credito|credit note)\b/i.test(head)
    ? "invoice"
    : /\b(offerta|preventivo|quotation|quote|proforma|pro-forma|price list|listino|angebot)\b/i.test(head)
      ? "quote"
      : null;

  // ---- Supplier: VAT numbers, then the letterhead line with a legal form
  const ownVats = new Set(OWN_VAT_NUMBERS.map(vatKey));
  const vats: string[] = [];
  for (const m of fullText.matchAll(/(?:p\.?\s?iva|partita\s+iva|vat(?:\s*(?:no|number|reg\.?|id))?|ust-?idnr|tax\s*id)\.?[ \t]*[:.]?[ \t]*((?:[A-Z]{2} ?)?[0-9][0-9 ]{6,16}[0-9])\b/gi)) {
    const v = m[1].replace(/\s/g, "");
    if (!ownVats.has(vatKey(v)) && !vats.includes(v)) vats.push(v);
  }
  const supplierVat: Found<string> = vats[0] ? { value: vats[0], confidence: 0.8 } : none();

  let supplierName: Found<string> = none();
  const top = lines.filter((l) => l.page === 1).slice(0, 18);
  let customerBlock = -1;
  for (const [i, l] of top.entries()) {
    if (CUSTOMER_LABEL.test(l.text)) customerBlock = i;
    // Letterhead: a line with a legal form, not ours, not inside the customer block.
    for (const cell of l.cells) {
      if (LEGAL_FORM.test(cell) && !isOwn(cell) && (customerBlock < 0 || i > customerBlock + 3 || i < customerBlock)) {
        const name = tidy(cell.replace(CUSTOMER_LABEL, "").replace(/^[:\s-]+/, ""));
        if (name.length >= 3 && !/\d{5,}/.test(name)) {
          supplierName = { value: name, confidence: 0.8, raw: l.text };
          break;
        }
      }
    }
    if (supplierName.value) break;
  }
  if (!supplierName.value) {
    const first = top.find((l) => /[a-z]{3,}/i.test(l.text) && !isOwn(l.text) && !/(fattura|invoice|offerta|preventivo|quotation)/i.test(l.text));
    if (first) supplierName = { value: tidy(first.cells[0]), confidence: 0.4, raw: first.text };
  }

  // ---- Document number and date
  const numLabel = requested === "quote" || detectedKind === "quote"
    ? /(?:offerta|preventivo|quotation|quote|proforma|rif\.?\s*offerta|numero\s+offerta)/
    : /(?:fattura|invoice|numero\s+documento|n\.?\s*documento|doc\.?|document)/;
  const numberHit = findLabelled(lines, numLabel, /([A-Z0-9][A-Z0-9/\-.]*\d[A-Z0-9/\-.]*)/);
  const number: Found<string> = numberHit ? { value: numberHit.match[1].replace(/[.,]$/, ""), confidence: 0.85, raw: numberHit.line.text } : none();

  const dateHit = findLabelled(
    lines,
    /(?:data\s+(?:fattura|documento|doc\.?|offerta|emissione)|invoice\s+date|quote\s+date|date\s+of\s+issue|data|date|del)/,
    /(\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4}|\d{4}-\d{2}-\d{2}|\d{1,2}\s+[a-zà-ù]+\s+\d{4}|[a-z]+\s+\d{1,2},?\s+\d{4})/,
  );
  let date: Found<string> = none();
  if (dateHit) {
    const d = parseDate(dateHit.match[1]);
    if (d) date = { value: d, confidence: 0.85, raw: dateHit.match[1] };
  }
  if (!date.value) {
    for (const l of lines.slice(0, 30)) {
      const d = findDate(l.text);
      if (d) {
        date = { value: d, confidence: 0.5, raw: l.text };
        break;
      }
    }
  }

  // ---- Validity (quotes)
  let validUntil: Found<string> = none();
  const validHit = findLabelled(lines, /(?:valid(?:o|a|it[aà])?\s*(?:fino\s+al|until|till|to)?|validity|scadenza\s+offerta|expires?)/, /(.+)/);
  if (validHit) {
    const text = validHit.match[1];
    const d = findDate(text);
    const days = /(\d{1,3})\s*(?:gg|giorni|days)/i.exec(text);
    if (d) validUntil = { value: d, confidence: 0.85, raw: text };
    else if (days && date.value) {
      const dt = new Date(date.value + "T00:00:00Z");
      dt.setUTCDate(dt.getUTCDate() + Number(days[1]));
      validUntil = { value: dt.toISOString().slice(0, 10), confidence: 0.8, raw: text };
    }
  }

  // ---- Currency, terms
  const currencies = new Map<string, number>();
  for (const t of fullText.split(/\s+/)) {
    const c = currencyInText(t);
    if (c) currencies.set(c, (currencies.get(c) ?? 0) + 1);
  }
  const topCurrency = [...currencies.entries()].sort((a, b) => b[1] - a[1])[0];
  const currency: Found<string> = topCurrency ? { value: topCurrency[0], confidence: currencies.size === 1 ? 0.9 : 0.6 } : none();

  const payHit = findLabelled(lines, /(?:condizioni\s+di\s+pagamento|modalit[aà]\s+di\s+pagamento|pagamento|payment\s+terms|payment|terms\s+of\s+payment)/, /(.+)/);
  const payDays = payHit ? parsePaymentTerms(payHit.match[1]) : null;
  const paymentTermsDays: Found<number> = payHit ? { value: payDays, confidence: payDays == null ? 0 : 0.8, raw: tidy(payHit.match[1]) } : none();

  const inco = parseIncoterm(fullText);
  const incoterm: Found<string> = inco ? { value: inco, confidence: 0.8 } : none();

  const leadHit = findLabelled(lines, /(?:tempi\s+di\s+consegna|tempo\s+di\s+consegna|consegna|lead\s*time|delivery(?:\s+time)?)/, /(.+)/);
  const lead = leadHit ? parseLeadTime(leadHit.match[1]) : null;
  const leadTimeDays: Found<number> = lead != null ? { value: lead, confidence: 0.8, raw: tidy(leadHit!.match[1]) } : none();

  const moqHit = findLabelled(lines, /(?:moq|minimo\s+d['’]?\s*ordine|lotto\s+minimo|minimum\s+order(?:\s+quantity)?|quantit[aà]\s+minima)/, /([\d.,']+)/);
  const moqVal = moqHit ? num(moqHit.match[1]).value : null;
  const moq: Found<number> = moqVal != null ? { value: moqVal, confidence: 0.8, raw: moqHit!.line.text } : none();

  let freight: Found<number> = none();
  const freightLine = lines.find((l) => /\b(spese\s+di\s+trasporto|trasporto|spese\s+spedizione|freight|shipping|carriage)\b/i.test(l.text));
  if (freightLine) {
    if (/\b(not included|non inclus[oa]|esclus[oa]|excluded|a carico|at buyer|extra)\b/i.test(freightLine.text)) {
      // Freight exists but its amount is unknown: leave empty, never 0.
      freight = { value: null, confidence: 0.7, raw: freightLine.text };
    } else if (/\b(inclus[oa]|included|franco destino|free delivery|free of charge)\b/i.test(freightLine.text)) {
      freight = { value: 0, confidence: 0.7, raw: freightLine.text };
    } else {
      const amounts = freightLine.text.split(/\s+/).filter((t) => NUMERIC_TOKEN.test(t)).map((t) => num(t).value).filter((n): n is number => n != null);
      if (amounts.length) freight = { value: amounts.at(-1)!, confidence: 0.75, raw: freightLine.text };
    }
  }

  let total: Found<number> = none();
  const totalLine = [...lines].reverse().find((l) => /\b(totale\s+(?:imponibile|merce|netto)|imponibile|total\s+net|net\s+total|subtotal|totale)\b/i.test(l.text));
  if (totalLine) {
    const amounts = totalLine.text.split(/\s+/).filter((t) => NUMERIC_TOKEN.test(t)).map((t) => num(t).value).filter((n): n is number => n != null);
    if (amounts.length) total = { value: amounts.at(-1)!, confidence: 0.7, raw: totalLine.text };
  }

  const notesIdx = lines.findIndex((l) => /^(note|notes|annotazioni|remarks)\s*[:.]?/i.test(l.text));
  const notes = notesIdx >= 0 ? tidy(lines.slice(notesIdx, notesIdx + 3).map((l) => l.text).join(" ").replace(/^(note|notes|annotazioni|remarks)\s*[:.]?\s*/i, "")) : null;

  // ---- Line items
  const headerIdx = lines.findIndex((l) => {
    const t = l.text.toLowerCase();
    const hits = [/descrizione|description|articolo|item|prodotto|product/, /q\.?\s?t[aàyà]|quantit|qty|q\.ty/, /prezzo|price|€\s*\/|unit/, /importo|amount|totale|total|valore/].filter((re) => re.test(t)).length;
    return hits >= 2;
  });
  const priceBeforeQty = headerIdx >= 0 && (() => {
    const t = lines[headerIdx].text.toLowerCase();
    const p = t.search(/prezzo|price/);
    const q = t.search(/q\.?\s?t[aày]|quantit|qty/);
    return p >= 0 && q >= 0 && p < q;
  })();
  const scope = headerIdx >= 0 ? lines.slice(headerIdx + 1) : lines;
  const items: ExtractedLine[] = [];
  for (const l of scope) {
    if (STOP_LINE.test(l.text.trim())) {
      if (headerIdx >= 0 && items.length) break;
      continue;
    }
    if (NOT_ITEM.test(l.text) || TERMS_LINE.test(l.text) || l === freightLine) continue;
    const parsed = parseItemLine(l, num, requested, priceBeforeQty);
    if (parsed) items.push(parsed);
  }

  return {
    kind: requested,
    detectedKind,
    supplierName,
    supplierVat,
    number,
    date,
    validUntil,
    currency,
    paymentTermsDays,
    incoterm,
    leadTimeDays,
    moq,
    freight,
    total,
    notes,
    lines: items,
    fullText,
  };
}

function parseItemLine(
  l: PdfLine,
  num: (s: string) => ReturnType<typeof parseNumber>,
  kind: DocKind,
  priceBeforeQty: boolean,
): ExtractedLine | null {
  const tokens = l.text.split(/\s+/).filter(Boolean);
  const numeric = tokens
    .map((t, i) => ({ i, t, p: NUMERIC_TOKEN.test(t) && !/%$/.test(t) ? num(t) : null }))
    .filter((x): x is { i: number; t: string; p: ReturnType<typeof parseNumber> } => !!x.p && x.p.value != null && !x.p.error);
  if (!numeric.length) return null;
  // Needs words: a product description, not just numbers.
  const words = tokens.filter((t) => /[a-zà-ù]{3,}/i.test(t) && !normalizeUnit(t));
  if (!words.length) return null;

  let q: (typeof numeric)[number] | null = null;
  let p: (typeof numeric)[number] | null = null;
  let a: (typeof numeric)[number] | null = null;
  // Find quantity × price = amount, preferring the rightmost numbers.
  outer: for (let k = numeric.length - 1; k >= 2; k--) {
    for (let j = k - 1; j >= 1; j--) {
      for (let i = j - 1; i >= 0; i--) {
        const [x, y, z] = [numeric[i].p.value!, numeric[j].p.value!, numeric[k].p.value!];
        if (x > 0 && y > 0 && amountsMatch(x * y, z)) {
          [q, p, a] = priceBeforeQty ? [numeric[j], numeric[i], numeric[k]] : [numeric[i], numeric[j], numeric[k]];
          break outer;
        }
      }
    }
  }
  let confidence = 0.9;
  if (!q || !p) {
    // Unverified line: quotes often list only a price (and maybe a quantity).
    if (kind === "quote") {
      p = numeric.at(-1)!;
      q = numeric.length >= 2 ? numeric.at(-2)! : null;
      if (q && priceBeforeQty) [q, p] = [p, q];
      // A price marked with its currency or unit ("EUR 1,29 /kg") is a clear quote line.
      const marked = /^(eur|usd|gbp|€|\$|£)$/i.test(tokens[p.i - 1] ?? "") || /^(?:[€$£]|eur)?\/\w+$/i.test(tokens[p.i + 1] ?? "") || /[€$£]/.test(p.t);
      confidence = marked ? 0.75 : 0.6;
    } else if (numeric.length >= 2) {
      [q, p] = priceBeforeQty ? [numeric.at(-1)!, numeric.at(-2)!] : [numeric.at(-2)!, numeric.at(-1)!];
      confidence = 0.5;
    } else {
      return null;
    }
  }

  const firstUsed = Math.min(...[q, p, a].filter(Boolean).map((x) => x!.i));
  // Currency markers before the numbers ("EUR 1,29") are not part of the description.
  let descTokens = tokens.slice(0, firstUsed).filter((t, i, arr) => !(i === arr.length - 1 && /^(eur|usd|gbp|chf|€|\$|£)$/i.test(t)));
  // Unit next to the quantity ("2.000 kg", "kg 2.000")
  let unit: string | null = null;
  if (q) {
    unit = normalizeUnit(tokens[q.i + 1] ?? "") ?? normalizeUnit(tokens[q.i - 1] ?? "");
  }
  if (!unit && p) {
    // Price per unit: "1,29 /kg", "€/kg 1,29"
    const after = tokens[p.i + 1] ?? "";
    const before = tokens[p.i - 1] ?? "";
    const m = /^(?:[€$£]|eur)?\/(\w+)$/i.exec(after) ?? /^(?:[€$£]|eur)?\/(\w+)$/i.exec(before);
    if (m) unit = normalizeUnit(m[1]);
  }
  if (!unit) {
    const u = normalizeUnit(descTokens.at(-1) ?? "");
    if (u) unit = u;
  }
  descTokens = descTokens.filter((t, i) => !(i === descTokens.length - 1 && normalizeUnit(t)));
  // Leading row number and supplier code
  if (/^\d{1,3}$/.test(descTokens[0] ?? "") && descTokens.length > 2) descTokens = descTokens.slice(1);
  let code: string | null = null;
  if (descTokens.length > 1 && /\d/.test(descTokens[0]) && /^[A-Z0-9][A-Z0-9\-/.]{2,}$/i.test(descTokens[0]) && /[A-Z]/i.test(descTokens[0])) {
    code = descTokens[0];
    descTokens = descTokens.slice(1);
  }
  const description = tidy(descTokens.join(" ").replace(/[€$£]\s*\/\s*\w+$/, "")) || null;
  if (!description) return null;

  return {
    line: l.index + 1,
    text: l.text,
    description,
    code,
    quantity: q ? q.p.value : null,
    unit,
    unitPrice: p ? p.p.value : null,
    amount: a ? a.p.value : null,
    confidence,
    ambiguousNumbers: [q, p, a].some((x) => x?.p.ambiguous),
  };
}

/** Document extraction → draft items (one per line item), header fields copied onto each. */
export function documentToItems(doc: DocumentExtraction): DraftItem[] {
  const goods = doc.lines.reduce((s, l) => s + (l.amount ?? (l.quantity ?? 0) * (l.unitPrice ?? 0)), 0);
  const freightTotal = doc.kind === "invoice" ? (doc.freight.value ?? 0) : 0;

  return doc.lines.map((l) => {
    const issues: Issue[] = [];
    const data: ItemData = { ...EMPTY_ITEM };
    data.date = doc.date.value;
    data.supplierName = doc.supplierName.value;
    data.supplierVat = doc.supplierVat.value;
    data.productName = l.description;
    data.supplierSku = l.code;
    data.quantity = l.quantity;
    data.unit = l.unit;
    data.unitPrice = l.unitPrice;
    data.total = l.amount;
    data.currency = doc.currency.value;
    data.fxRate = data.currency === "EUR" ? 1 : null;
    data.invoiceReference = doc.number.value;
    data.paymentTermsDays = doc.paymentTermsDays.value;
    data.incoterm = doc.incoterm.value;
    data.leadTimeDays = doc.leadTimeDays.value;
    data.moq = doc.moq.value;
    data.validUntil = doc.validUntil.value;
    data.notes = doc.kind === "quote" ? doc.notes : null;

    if (doc.kind === "invoice" && freightTotal > 0 && goods > 0) {
      const lineGoods = l.amount ?? (l.quantity ?? 0) * (l.unitPrice ?? 0);
      data.freight = round2((freightTotal * lineGoods) / goods);
      if (doc.lines.length > 1) {
        issues.push({ code: "freight_allocated", severity: "info", field: "freight", message: `Invoice freight ${freightTotal.toLocaleString("it-IT")} split across lines by value` });
      }
    }
    if (doc.kind === "quote" && doc.freight.value != null) data.freight = doc.freight.value;
    if (l.ambiguousNumbers) {
      issues.push({ code: "number_format_uncertain", severity: "review", message: "Some numbers on this line could be read in two ways — check quantity and price" });
    }
    if (doc.date.value && doc.date.confidence < 0.7) {
      issues.push({ code: "low_confidence", severity: "review", field: "date", message: "Document date found without a label — check it" });
    }
    if (doc.detectedKind && doc.detectedKind !== doc.kind) {
      issues.push({
        code: "low_confidence",
        severity: "review",
        message: `This document looks like ${doc.detectedKind === "quote" ? "a quote" : "an invoice"}, but was uploaded as ${doc.kind === "quote" ? "a quote" : "an invoice"}`,
      });
    }
    return {
      line: l.line,
      raw: { "Line on document": l.text },
      extracted: { ...data, parseIssues: issues },
      confidence: l.confidence,
    };
  });
}
