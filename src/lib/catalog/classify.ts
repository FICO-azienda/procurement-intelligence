/**
 * What an invoice line is, read from its words: a material, a component,
 * packaging — or transport, a service, a utility, an office purchase.
 *
 * Rules, not a model: a list of words per kind, in Italian and English, in the
 * order in which they are trusted. A word says what the line is only when it
 * can't mean something else ("trasporto" at the start of a line is transport;
 * in "scatola per trasporto" it is a box). A line whose words say nothing is
 * left unclassified: the supplier's other lines may tell (see `dominantKind`),
 * otherwise the user is asked.
 *
 * To teach a new word, add it to the list of its kind.
 */
import { normalizeKey } from "../import/normalize/text";
import { isStrategic, type ProductKind } from "./kinds";

interface Rule {
  kind: ProductKind;
  pattern: RegExp;
}

const rule = (kind: ProductKind, words: string): Rule => ({ kind, pattern: new RegExp(words) });
/** The word must open the line, after at most the words for a charge ("spese di…", "addebito…"). */
const HEAD = String.raw`^(?:(?:addebito|contributo|rimborso|recupero|spes[ae]|costi|costo|di|del|delle|per) )*`;

/** Charges that are never the product, whatever else the line says. Checked first, in order. */
const CHARGES: Rule[] = [
  rule("other", String.raw`\bconai\b|contributo ambientale|\baccis[ae]\b|contrassegn|\bboll[oi]\b|spese (di )?incasso|\brivalsa\b|spese (di )?fatturazione|spese bancarie|\bcommission[ei]\b|spese emissione|spese (di )?istruttoria|interessi (di )?mora`),
  // Reverse-charge documents for purchases abroad: the amount of the purchase, with no product on it.
  rule("other", String.raw`\biva\b.*\bacquisti\b.*\b(ue|cee|intra\w*)\b`),
  rule("logistics", String.raw`scarico bancal|movimentazion|servizi logistici|facchinaggio|\bdogan|\bthc\b|supplemento carburante|addizionale fuel|fuel surcharge|\bpedagg|\btelepass\b|\bsosta\b|\breefer\b`),
  rule("logistics", HEAD + String.raw`(trasport\w*|spedizion\w*|corriere|freight|shipping|carriage|nolo)\b`),
];

/** Spend that is not a product to compare. Checked after the charges, in order. */
const SPEND: Rule[] = [
  rule("energy", String.raw`\benergia\b|\bgas\b|\bmetano\b|\bgasolio\b|\bcarburant[ei]\b|\bbenzina\b|\bdiesel\b|\bgpl\b|\bacqua\b|depurazione|fognatura|\btariffa\b|quota fissa|\binternet\b|\bfibra\b|ultrafibra|\btelefon|\bvoip\b|connettivit|\bricariche\b|\badsl\b`),
  rule(
    "service",
    String.raw`\bcanon[ei]\b|\bnoleggio\b|\bleasing\b|abbonament|\bassistenza\b|manutenzion|manodopera|mano d opera|\bintervent[oi]\b|consulenz|predisposizione|elaborazione|\bcedolin|\bcompetenze\b|\bprestazion|monitoraggio|vigilanza|\bcompens[oi]\b|promozional|\bpromozione\b|corrispettiv|\bserviz[io]\b|\bservice\b|\bfee\b|\bdominio\b|\blicenz[ae]\b|\bsoftware\b|\bpratica\b|\btrasferta\b|diritto di chiamata|\brata n\b|\bcontratto\b|spese anticipate|\bintrastat\b|\bonorari|lavori eseguiti|\bedi\b`,
  ),
  rule("indirect", String.raw`\bcaffe\b|cancelleria|\brisma\b|carta a4|\btoner\b|registrator|pronto soccorso|detersiv|\bpulizi[ae]\b|ghiacciol|\bspiedi\b`),
  rule(
    "equipment",
    String.raw`\bricamb|\bmotor[ei]\b|motoriduttor|\bpomp[ae]\b|\bvalvol[ae]\b|\belettrov|cuscinett|\bcinghi[ae]\b|\briduttor|\bventilator|\bbatteri[ae]\b|\balimentator|\bpunzon|\bguaina\b|raffrescator|\bcompressor|\butensil|\bgirante\b|\bnippl|squadrett|soffiatric|\bmanometr|\bmanom\b|\braccord|\bracc\b|\bconnettor|\bxvr\b|\bsfiato\b|\btubo\b|calza trecciata|materiale( vario)?( di)? consumo`,
  ),
];

/** Products to compare and negotiate. The word that comes first in the line decides. */
const GOODS: Rule[] = [
  rule("packaging", String.raw`\bscatol|\bscat\b|\bsc americana\b|\bcarton[ei]\b|\bimball|\betichett|film estensibile|\bnastr[oi]\b|\bpallet\b|\bbancal[ei]\b|\bplt\b|\bbust[ae]\b|\bsacchett|carta paglia|\bastucc|\bespositor|\breggia\b|pluriball|termoretraibil`),
  rule("component", String.raw`\bstoppin|\btrecciolin|\btubolare\b|\bfondell|\bfermagli|\bcontenitor|\bbicch|\bciotol|\bcoperchi|\btapp[oi]\b|\bfiammett|\bvasett|\bbarattol|\bcapsul|\bcandelier`),
  rule("direct_material", String.raw`\bparaffin|\bcer[ae]\b|\bwax\b|\bstearin|\bfragranz|\bprofum|\bessenz[ae]\b|\bcolorant|\bpigment|\bacido\b|\badditiv|\bcandel|\btealight|\bnightlight|\blumin[io]\b|\bceri\b|\bvin[oi]\b|\bosti[ae]\b|\bparticol[ae]\b|\bincens[oi]\b|\bcarboncin`),
];

/** "Scatole di carboncini", "cartoni da 50 fermagli": the container is not what was bought. */
const CONTAINER_OF = String.raw`^(?:\S+ ){0,1}(scatol\w*|carton\w*|confezion\w*|conf|sacch\w*|bust\w*) (?:di|da|n|con) `;

/** Generic words for an amount that is not a product: advances, discounts, credits, plain "expenses". */
const GENERIC: Rule[] = [
  rule("other", String.raw`\bacconto\b|\banticipo\b|down payment|pagamento anticipato|\bcaparra\b|\bsconto\b|\baccredito\b|\bstorno\b|\babbuono\b|arrotondament`),
  rule("other", String.raw`^(?:compar\w* )?(spes[ae]|addebito|costi|costo|contributo)\b`),
];

/** What a supplier's own name says about its lines: a carrier's lines are transport even when they mention a pallet. */
const CARRIER = rule("logistics", String.raw`trasport|spedizion|groupage|logistic|\bexpress\b|corrier|\bcargo\b|\bfreight\b`);
/** Weaker: used only when the line itself names no product. */
const SERVICE_FIRM = rule("service", String.raw`\bstudio\b|consult|\bassociati\b|\bfinancial\b|\brental\b|\bleasing\b|\bbanc[ao]\b|\bbank\b|assicuraz`);

const first = (rules: Rule[], text: string) => rules.find((r) => r.pattern.test(text))?.kind ?? null;

/** The kind of product a line's words name: the first one mentioned, skipping "boxes of …". */
export function goodsFromWords(text: string | null | undefined): ProductKind | null {
  const s = normalizeKey(text).replace(new RegExp(CONTAINER_OF), "");
  let best: { kind: ProductKind; at: number } | null = null;
  for (const r of GOODS) {
    const at = s.search(r.pattern);
    if (at >= 0 && (!best || at < best.at)) best = { kind: r.kind, at };
  }
  return best?.kind ?? null;
}

export const genericCharge = (text: string | null | undefined) => first(GENERIC, normalizeKey(text));
export const kindFromSupplierName = (name: string | null | undefined) => first([CARRIER, SERVICE_FIRM], normalizeKey(name));

export interface Classification {
  kind: ProductKind;
  /** words: the line says it · supplier: what this supplier sells · none: nobody knows yet. */
  by: "words" | "supplier" | "none";
}

/**
 * The kind of one line, on its own evidence. `supplierKind` is what the rest
 * of the supplier's lines are (when they agree), used only where the line's
 * own words say nothing.
 */
export function classify(input: { text: string | null; category?: string | null; supplierName?: string | null; supplierKind?: ProductKind | null }): Classification {
  const s = normalizeKey([input.text, input.category].filter(Boolean).join(" "));
  const supplier = normalizeKey(input.supplierName);
  const charge = first(CHARGES, s);
  if (charge) return { kind: charge, by: "words" };
  if (CARRIER.pattern.test(supplier)) return { kind: "logistics", by: "supplier" };
  const spend = first(SPEND, s);
  if (spend) return { kind: spend, by: "words" };
  // An advance, a discount, plain "expenses": never the product, even when the line names one.
  // On a utility or service bill it is part of that spend; on a goods invoice it is a charge of its own.
  if (genericCharge(input.text)) return input.supplierKind && !isStrategic(input.supplierKind) ? { kind: input.supplierKind, by: "supplier" } : { kind: "other", by: "words" };
  const goods = goodsFromWords(input.text);
  if (goods) return { kind: goods, by: "words" };
  if (SERVICE_FIRM.pattern.test(supplier)) return { kind: "service", by: "supplier" };
  if (input.supplierKind) return { kind: input.supplierKind, by: "supplier" };
  return { kind: "needs_review", by: "none" };
}

/**
 * What a supplier mostly sells, from the lines whose words are clear: at least
 * half of its spend must be classified, and one kind must be most of that.
 * Null when the supplier's lines don't agree — nothing is assumed then.
 */
export function dominantKind(lines: { kind: ProductKind | null; amount: number }[]): ProductKind | null {
  const total = lines.reduce((s, l) => s + Math.abs(l.amount), 0);
  const byKind = new Map<ProductKind, number>();
  let classified = 0;
  for (const l of lines) {
    if (!l.kind || l.kind === "other" || l.kind === "needs_review") continue;
    classified += Math.abs(l.amount);
    byKind.set(l.kind, (byKind.get(l.kind) ?? 0) + Math.abs(l.amount));
  }
  if (total <= 0 || classified / total < 0.5) return null;
  const [best] = [...byKind.entries()].sort((a, b) => b[1] - a[1]);
  return best && best[1] / classified >= 0.7 ? best[0] : null;
}
