/**
 * The catalogue's categories, in two levels, and the words that name each one:
 * "Waxes and paraffin › Paraffin", "Packaging › Cardboard boxes".
 *
 * A starting list, written for a candle maker and for the packaging every
 * manufacturer buys. To teach a new word, add it to its subcategory; to add a
 * category, add it here — nothing else in the app lists them. The category of
 * a product is stored as text, so a company can also write its own.
 */
import { normalizeKey } from "../import/normalize/text";
import type { Msg } from "../i18n";
import type { ProductKind } from "./kinds";

export interface Word {
  /** Tested on the normalised text (lower case, no accents, no punctuation). */
  pattern: string;
  /** What the word has in common across its spellings: "contenitor" for contenitore, contenitori. */
  stem: string;
  /** How to write it out when the document abbreviates it ("bicch" → "Bicchiere"). */
  as?: string;
}

export interface Subcategory {
  key: string;
  label: Msg;
  /** One of them, to put in front of a name that says no noun ("Label 50x70 …"). */
  noun: Msg;
  words: Word[];
  /** The customs heading (HS, 6 digits) its products usually fall under: a suggestion for trade statistics, to confirm product by product. */
  customs?: string;
  /**
   * Its words name something that can be several different things ("wax"): when nothing else tells which, the product
   * is not classified here — the user is offered these subcategories, and may say "I don't know yet".
   */
  ask?: string[];
}

export interface Category {
  key: string;
  label: Msg;
  /** What its products are for the company's spend. */
  kind: ProductKind;
  /** How to research its products, when the general rules (lib/research/strategy.ts) would read them wrong: finished goods bought by weight are not a raw material. */
  research?: "commodity" | "standard" | "custom";
  subs: Subcategory[];
}

const w = (stem: string, pattern = String.raw`\b${stem}\w*`, as?: string): Word => ({ pattern, stem, as });

export const TAXONOMY: Category[] = [
  {
    key: "wax",
    label: "Waxes and paraffin",
    kind: "direct_material",
    subs: [
      { key: "paraffin", label: "Paraffin", noun: "Paraffin", words: [w("paraffin")], customs: "271220" },
      { key: "vegetable_wax", label: "Vegetable wax", noun: "Vegetable wax", words: [w("vegetal", String.raw`\bcer[ae] (?:di )?(?:soia|vegetal\w*|colza|palma|cocco)\b|\b(?:soy|soja|rapeseed|palm|coconut|vegetable) wax\b|\bsoia\b`)] },
      { key: "wax_blend", label: "Candle wax blend", noun: "Wax blend", words: [w("blend", String.raw`\bwax blend\b|\bmiscela (?:di )?cer[ae]\b|\bcandle compound\b`)] },
      { key: "wax", label: "Wax", noun: "Wax", words: [w("cera", String.raw`\bcer[ae]\b`), w("wax", String.raw`\bwax\b`), w("stearin")], ask: ["paraffin", "wax_blend", "vegetable_wax"] },
    ],
  },
  {
    key: "fragrance",
    label: "Fragrances and colours",
    kind: "direct_material",
    subs: [
      { key: "fragrance", label: "Fragrances", noun: "Fragrance", words: [w("fragranz"), w("profum"), w("essenz", String.raw`\bessenz[ae]\b`), w("parfum", String.raw`\bparfums?\b`)] },
      { key: "dye", label: "Dyes and pigments", noun: "Dye", words: [w("colorant"), w("pigment")] },
    ],
  },
  {
    key: "raw",
    label: "Other raw materials",
    kind: "direct_material",
    subs: [{ key: "chemical", label: "Chemicals and additives", noun: "Chemical", words: [w("acido", String.raw`\bacido\b`), w("additiv")] }],
  },
  {
    key: "wick",
    label: "Wicks and wick parts",
    kind: "component",
    subs: [
      { key: "wick", label: "Wicks", noun: "Wick", words: [w("stoppin"), w("trecciolin"), w("tubolar")] },
      { key: "wick_holder", label: "Wick holders and clips", noun: "Wick holder", words: [w("fondell"), w("fermagli")] },
    ],
  },
  {
    key: "container",
    label: "Containers",
    kind: "component",
    subs: [
      { key: "candle_container", label: "Candle containers", noun: "Container", words: [w("contenitor"), w("fiammett"), w("coperchi"), w("tapp", String.raw`\btapp[oi]\b`), w("capsul")] },
      { key: "glass", label: "Glass", noun: "Glass", words: [w("bicchier", String.raw`\bbicch\w*`, "Bicchiere"), w("vasett"), w("barattol"), w("vetr", String.raw`\bvetr[oi]\b`)] },
      { key: "ceramic", label: "Terracotta and ceramic", noun: "Bowl", words: [w("ciotol"), w("terracott"), w("ceramic")] },
    ],
  },
  {
    key: "packaging",
    label: "Packaging",
    kind: "packaging",
    subs: [
      {
        key: "cardboard",
        label: "Cardboard boxes",
        noun: "Box",
        words: [w("scatol", String.raw`\bscatol\w*|\bscat\b|\bsc(?= americana\b)`, "Scatola"), w("carton", String.raw`\bcarton[ei]\b`), w("astucc"), w("espositor"), w("imball")],
      },
      { key: "film", label: "Film and tape", noun: "Film", words: [w("film", String.raw`\bfilm\b`), w("nastr", String.raw`\bnastr[oi]\b`), w("reggia", String.raw`\breggia\b`), w("pluriball"), w("termoretraibil")] },
      { key: "paper", label: "Paper and bags", noun: "Paper", words: [w("carta", String.raw`\bcarta (?:paglia|velina|kraft|da imball\w*|da pacchi)\b`), w("bust", String.raw`\bbust[ae]\b`), w("sacchett")] },
      { key: "pallet", label: "Pallets", noun: "Pallet", words: [w("pallet", String.raw`\bpallets?\b|\bplt\b`, "Pallet"), w("bancal", String.raw`\bbancal[ei]\b`)] },
    ],
  },
  {
    key: "label",
    label: "Labels and printing",
    kind: "packaging",
    subs: [{ key: "label", label: "Labels", noun: "Label", words: [w("etichett"), w("label", String.raw`\blabels?\b`)] }],
  },
  {
    key: "finished",
    label: "Finished goods",
    kind: "direct_material",
    research: "standard",
    subs: [
      { key: "candle", label: "Candles", noun: "Candle", words: [w("candel", String.raw`\bcandel[ae]\b`), w("ceri", String.raw`\bceri\b`), w("lumin", String.raw`\blumin[io]\b`)] },
      { key: "tealight", label: "Tealights and nightlights", noun: "Tealight", words: [w("tealight", String.raw`\btealights?\b`), w("nightlight", String.raw`\bnightlights?\b`)] },
      {
        key: "church",
        label: "Church supplies",
        noun: "Church item",
        words: [w("osti", String.raw`\bosti[ae]\b`), w("particol", String.raw`\bparticol[ae]\b`), w("vin", String.raw`\bvin[oi]\b`), w("incens", String.raw`\bincens[oi]\b`), w("carboncin")],
      },
      { key: "accessory", label: "Candle holders and accessories", noun: "Candle holder", words: [w("candelier"), w("lantern")] },
    ],
  },
];

export interface SubRef {
  category: Category;
  sub: Subcategory;
}

const SUBS = new Map<string, SubRef>(TAXONOMY.flatMap((category) => category.subs.map((sub) => [sub.key, { category, sub }] as const)));
export const subByKey = (key: string | null | undefined): SubRef | null => (key ? (SUBS.get(key) ?? null) : null);
export const allSubs = (): SubRef[] => [...SUBS.values()];

/** "Boxes of charcoal", "cartons of 50,000 clips": the container is not what was bought. */
const CONTAINER_OF = /^(?:\S+ ){0,1}(scatol\w*|carton\w*|confezion\w*|conf|sacch\w*|bust\w*) (?:di|da|n|con) /;

export interface WordHit extends SubRef {
  word: Word;
  /** Where the word is in the normalised text, and how long. */
  at: number;
  length: number;
}

const COMPILED = allSubs().flatMap((ref) => ref.sub.words.map((word) => ({ ...ref, word, re: new RegExp(word.pattern) })));

/** The category a text names: the first of the known words it contains. Null when it names none. */
export function categorize(text: string | null | undefined): WordHit | null {
  const s = normalizeKey(text);
  const skip = CONTAINER_OF.exec(s)?.[0].length ?? 0;
  const body = s.slice(skip);
  let best: WordHit | null = null;
  for (const c of COMPILED) {
    const m = c.re.exec(body);
    if (m && (!best || skip + m.index < best.at)) best = { category: c.category, sub: c.sub, word: c.word, at: skip + m.index, length: m[0].length };
  }
  return best;
}
