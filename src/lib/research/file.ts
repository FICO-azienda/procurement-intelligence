/**
 * Research done outside the app — by a person, an agency, another tool —
 * loaded with its sources. A file lists the possible suppliers found and the
 * price references read, each with the page it comes from and the products
 * it is about. What it loads are candidates and references to review: never
 * suppliers, never prices paid.
 */
import { z } from "zod";
import type { Msg } from "../i18n";

const text = z.string().trim().min(1);
const url = z.string().trim().regex(/^https?:\/\/[^\s.]+\.[^\s]+$/i, "Not a web address" satisfies Msg);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Dates are written YYYY-MM-DD" satisfies Msg);

export const researchFile = z.object({
  /** How the research was done, in the researcher's words: "Web research". */
  source: text.default("Web research"),
  researchedAt: day,
  /** What the research looked at and what it left out: the searches made, the sources read, and the gaps — so that nobody takes it for complete. */
  coverage: z.object({ queries: z.array(text).default([]), sources: z.array(text).default([]), gaps: z.array(text).default([]) }).nullish(),
  candidates: z
    .array(
      z.object({
        /** The products it could supply: their id, code or exact name. */
        products: z.array(text).min(1),
        name: text,
        country: text.nullish(),
        website: url.nullish(),
        /** The page that shows this company sells the product. Required: no page, no candidate. */
        sourceUrl: url,
        sourceTitle: text.nullish(),
        sourceLevel: z.enum(["supplier_official", "official_data", "licensed_data", "external"]).default("external"),
        companyType: z.enum(["manufacturer", "distributor", "wholesaler"]).nullish(),
        matchedProduct: text.nullish(),
        matchExplanation: text.nullish(),
        technicalCompatibility: z.enum(["high", "partial", "not"]).nullish(),
        confidence: z.enum(["high", "medium", "low"]).nullish(),
        notes: text.nullish(),
      }),
    )
    .default([]),
  benchmarks: z
    .array(
      z.object({
        product: text,
        type: z.enum(["direct_benchmark", "trade_benchmark"]).default("direct_benchmark"),
        label: text,
        low: z.number().positive(),
        high: z.number().positive().nullish(),
        currency: z.string().trim().length(3).default("EUR"),
        unit: text,
        sourceName: text,
        sourceUrl: url.nullish(),
        sourceDate: day,
        sourceLevel: z.enum(["official_data", "licensed_data", "external"]).default("external"),
        comparability: z.enum(["comparable", "partial", "not"]).default("partial"),
        notes: text.nullish(),
      }),
    )
    .default([]),
});

export type ResearchFile = z.infer<typeof researchFile>;

/** The file's content, or why it can't be read: the first thing wrong, with where it is. */
export function parseResearchFile(raw: string): { ok: true; file: ResearchFile } | { ok: false; error: "not_json" } | { ok: false; error: "invalid"; where: string; message: string } {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false, error: "not_json" };
  }
  const parsed = researchFile.safeParse(json);
  if (parsed.success) return { ok: true, file: parsed.data };
  const issue = parsed.error.issues[0];
  return { ok: false, error: "invalid", where: issue.path.join(".") || "file", message: issue.message };
}
