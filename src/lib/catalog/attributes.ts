/**
 * What a product name says about the product, read with patterns that can't
 * mean anything else: a size written "420x310x240", a diameter after "Ø", a
 * capacity in ml, a weight in kg, a pack of "500 pz", a colour or a material
 * written in full. Abbreviations nobody could be sure of (TR, BIA, XXF) are
 * left alone: they stay in the name, as written.
 *
 * Nothing here is stored: the name and its aliases are the source.
 */
import type { Msg } from "../i18n";

export type AttributeKey = "size" | "diameter" | "capacity" | "weight" | "thickness" | "pack" | "colour" | "material";

export const ATTRIBUTE_LABEL: Record<AttributeKey, Msg> = {
  size: "Size",
  diameter: "Diameter",
  capacity: "Capacity",
  weight: "Weight",
  thickness: "Thickness",
  pack: "Pack",
  colour: "Colour",
  material: "Material",
};

export interface Attribute {
  key: AttributeKey;
  /** As written on the document, tidied. */
  value: string;
}

const N = String.raw`\d+(?:[.,]\d+)?`;
const COLOURS = /\b(bianc[oa]|ross[oa]|blu|giall[oa]|verde|ner[oa]|trasparente|neutr[oa]|white|red|blue|yellow|green|black|transparent)\b/i;
const MATERIALS = /\b(vetro|alluminio|policarbonato|polipropilene|pp|legno|cartone|bamb[uù]`?|metallic[oi]|metallo|plastica|carta patinata|pvc|pet|cotone|glass|aluminium|wood|cotton)\b/i;

const PATTERNS: { key: AttributeKey; re: RegExp; value: (m: RegExpExecArray) => string }[] = [
  { key: "size", re: new RegExp(String.raw`([Øø]\s*)?(${N})\s*[x×]\s*(${N})(?:\s*[x×]\s*(${N}))?\s*(mm|cm|mtl|mt)?\b`, "i"), value: (m) => `${m[1] ? "Ø " : ""}${[m[2], m[3], m[4]].filter(Boolean).join(" x ")}${m[5] ? ` ${m[5].toLowerCase()}` : ""}` },
  { key: "diameter", re: new RegExp(String.raw`(?:[Øø]|\bdiam(?:etro)?\.?|\bD(?=\d))\s*(${N})(?!\s*[x×]\s*\d)\s*(mm|cm)?`, "i"), value: (m) => `${m[1]}${m[2] ? ` ${m[2].toLowerCase()}` : ""}` },
  { key: "capacity", re: new RegExp(String.raw`\b(${N})\s*(ml|cl|cc|lt)\b|\bcc\.?\s*(${N})\b`, "i"), value: (m) => (m[1] ? `${m[1]} ${m[2].toLowerCase()}` : `${m[3]} cc`) },
  { key: "weight", re: new RegExp(String.raw`\b(${N})\s*(kg|gr|g)\b|\b(kg|gr)\.?\s*(${N})\b`, "i"), value: (m) => (m[1] ? `${m[1]} ${m[2].toLowerCase()}` : `${m[4]} ${m[3].toLowerCase()}`) },
  { key: "thickness", re: new RegExp(String.raw`(?:\bsp\.|\bspessore)\s*(${N})\s*(my|mm|cm)?`, "i"), value: (m) => `${m[1]}${m[2] ? ` ${m[2].toLowerCase()}` : ""}` },
  { key: "pack", re: new RegExp(String.raw`\b(\d+)\s*(?:pz|pezzi|pcs)\b|\bconf\.?\s*(\d+)\b`, "i"), value: (m) => m[1] ?? m[2] },
  { key: "colour", re: COLOURS, value: (m) => m[1].toLowerCase() },
  { key: "material", re: MATERIALS, value: (m) => (m[1].length <= 3 ? m[1].toUpperCase() : m[1].toLowerCase().replace("`", "")) },
];

export function attributesOf(text: string | null | undefined): Attribute[] {
  const s = text ?? "";
  const out: Attribute[] = [];
  for (const p of PATTERNS) {
    const m = p.re.exec(s);
    if (m) out.push({ key: p.key, value: p.value(m) });
  }
  return out;
}

/** How many pieces, cartons or packs a line was about: a note on the delivery, not a feature of the product. */
const PACK_NOTES = [
  /\(\s*\d+\s*cart\.?[^)]*\)?/gi,
  /\bx\s*\d+\s*(?:pz|pezzi)\b\.?/gi,
  /\b\d+\s*(?:ct|cart|cartoni|pz|pezzi|pcs|conf|scat|scatole)\b\.?(?:\s*x\s*scat\w*\.?)?/gi,
  /\b(?:conf|ct|cart)\.?\s*\d+\b(?:\s*(?:pz|pezzi)\b\.?)?/gi,
];

/** The text with its packing notes taken out: "Ø 35x200 mm 60 pz. x scat" → "Ø 35x200 mm". */
export function withoutPackNotes(text: string | null | undefined): string {
  let s = text ?? "";
  for (const re of PACK_NOTES) s = s.replace(re, " ");
  return s.replace(/\s+/g, " ").trim();
}
