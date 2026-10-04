/**
 * Product codes as invoices write them. Electronic invoices give every code a
 * type ("AswArtFor:290691", "EAN:8032532918890", "Codice Art. cliente:VESB.126"),
 * several per line ("Ns.Codice:52947 | TARIC:84129080"). The type says whose
 * code it is — the supplier's, ours, a barcode, or a customs class that
 * identifies nothing we buy.
 */
import { tidy } from "./text";

export interface ProductCodes {
  /** The supplier's own article code. */
  supplier: string | null;
  /** Our code, when the supplier prints it on the invoice. */
  own: string | null;
  /** Barcode (EAN / GTIN). */
  ean: string | null;
  /** What the goods are, when the invoice says it next to the codes ("Commodity: Energia Elettrica"). */
  commodity: string | null;
}

/** Classes and attributes, not article codes. */
const NOT_A_CODE = /^(taric|hs|hscod|hscode|nc|cpv|carb|origine|origin|commodity|intrastat|ssc|aic)$/i;
const BARCODE = /^(ean|gtin|barcode|ean13|ean 13|upc)$/i;
const OURS = /cli|cust|buyer|acquirente|committente/i;
/** Fillers some systems print when there is no code: 9999999999, 0000, "-". */
const PLACEHOLDER = /^([09]+|-+|n\/?[ad]\.?|nd)$/i;

/** One code or several typed ones → whose code each is. A plain code is taken as `fallback`. */
export function readCodes(raw: string | null | undefined, fallback: "supplier" | "own" = "supplier"): ProductCodes {
  const out: ProductCodes = { supplier: null, own: null, ean: null, commodity: null };
  const text = tidy(raw);
  if (!text) return out;
  for (const part of text.split(/\s*\|\s*/)) {
    const m = /^([^:]{1,40}):\s*(.+)$/.exec(part);
    const type = m ? tidy(m[1]) : "";
    const value = tidy(m ? m[2] : part);
    if (value && /^commodity$/i.test(type)) out.commodity ??= value;
    if (!value || PLACEHOLDER.test(value) || NOT_A_CODE.test(type)) continue;
    if (BARCODE.test(type) || (!type && /^\d{13,14}$/.test(value) && text.includes("|"))) out.ean ??= value;
    else if (type && OURS.test(type)) out.own ??= value;
    else if (type) out.supplier ??= value;
    else out[fallback] ??= value;
  }
  return out;
}
