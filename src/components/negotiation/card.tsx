import Link from "next/link";
import { FieldStatusTag } from "@/components/dataset/product-data";
import { PriceTypeTag } from "@/components/sourcing/tags";
import { Disclosure, Table, Td, Th, cx } from "@/components/ui";
import * as f from "@/lib/format";
import { said, type T } from "@/lib/i18n";
import type { AnchorKind } from "@/lib/negotiation/config";
import { DATA_CLASS } from "@/lib/negotiation/data-class";
import { ANCHOR_ROLE_LABEL, DIMENSION_LABEL, LEVEL_LABEL, STRENGTH_LABEL, roundTo, type ImproveKind, type Strength } from "@/lib/negotiation/engine";
import { FACTOR_GROUPS, FACTOR_GROUP_LABEL, type FactorInput, type ProductNegotiation } from "@/lib/negotiation/input";
import { RELATIONSHIP_PART_LABEL } from "@/lib/negotiation/relationship";
import { NEGOTIATION_CONFIG } from "@/lib/negotiation/config";
import type { PriceType } from "@/lib/sourcing/types";
import type { EstimateRow } from "@/server/negotiation";
import { JudgementForm } from "./judgement-form";

/** Every price shows its kind the same way everywhere: the evidence of an estimate too. */
const PRICE_TYPE: Record<AnchorKind, PriceType> = { quote: "quote", other_supplier: "actual", published_price: "indicative", benchmark: "direct_benchmark", trade: "trade_benchmark", estimate: "estimate", own_history: "actual" };

const STRENGTH_TONE: Record<Strength, string> = { low: "bg-wash text-ink-2", medium: "bg-caution-wash text-caution", high: "bg-down-wash text-down", very_high: "bg-down-wash text-down" };
const CONFIDENCE_TONE = { low: "text-caution", medium: "text-ink", high: "text-down" } as const;
const tagClass = "inline-flex h-[18px] items-center rounded-[4px] px-1.5 text-[10.5px] font-semibold tracking-[0.04em] uppercase whitespace-nowrap";

const price = (n: number, unit: string) => `${f.price(n)}/${unit}`;
export const rangeOf = (low: number, high: number, unit: string) => (low === high ? price(low, unit) : `${f.price(low)}–${f.price(high)}/${unit}`);
/** A score in words: the figures behind it are the engine's own business. */
const wordOf = (score: number): Strength => (score >= NEGOTIATION_CONFIG.strength.veryHigh ? "very_high" : score >= NEGOTIATION_CONFIG.strength.high ? "high" : score >= NEGOTIATION_CONFIG.strength.medium ? "medium" : "low");

/** Where each thing that would improve the estimate is done. */
function improveHref(kind: ImproveKind, productId: string): string | null {
  switch (kind) {
    case "add_purchase":
      return null;
    case "find_suppliers":
    case "customs_code":
    case "complete_true_cost":
    case "confirm_match":
      return `/sourcing/${productId}`;
    case "first_quote":
    case "second_quote":
      return `/sourcing/${productId}#shortlist`;
    case "describe_product":
      return `/sourcing/${productId}#specification`;
    case "delivery_basis":
    case "payment_terms":
    case "confirm_volume":
      return `/products/${productId}?complete=1#product-data`;
    case "your_knowledge":
      return "#your-knowledge";
  }
}

function Figure({ label, children, note }: { label: string; children: React.ReactNode; note?: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[12px] text-ink-3">{label}</dt>
      <dd className="mt-0.5 text-[17px] leading-tight font-semibold tracking-[-0.01em]">{children}</dd>
      {note && <div className="mt-0.5 text-[12px] text-ink-3">{note}</div>}
    </div>
  );
}

/**
 * Negotiation intelligence for one product: what is paid, what could
 * realistically be paid, the target to aim for and how sure that is — then,
 * on demand, why. With too little evidence it says so, and what to get.
 */
export function NegotiationCard({ n, history, t, className }: { n: ProductNegotiation; history: EstimateRow[]; t: T; className?: string }) {
  const unit = n.unit;
  const used = n.anchors.filter((a) => a.role !== "not_used");
  const counts = { confirmed: n.inputs.filter((x) => x.status === "confirmed").length, estimated: n.inputs.filter((x) => x.status === "estimated").length, missing: n.inputs.filter((x) => x.status === "missing").length };
  // An annualized volume is an estimate: three significant figures say all it knows.
  const yearly = n.upside?.volume ?? null;
  const volume = yearly != null ? `${f.number(n.upside!.volumeStatus === "estimated" && yearly > 0 ? roundTo(yearly, 10 ** (Math.floor(Math.log10(yearly)) - 2)) : Math.round(yearly), 0)} ${unit}` : null;
  return (
    <section id="negotiation" className={cx("scroll-mt-20 rounded-xl border border-rule bg-canvas", className)}>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-5 pt-4 pb-3 sm:px-6">
        <div className="min-w-0">
          <h2 className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[14px] font-semibold tracking-[-0.005em]">
            {t("Negotiation intelligence")}
            <span className={cx(tagClass, "border border-dashed border-ink/40 font-semibold text-ink-3")}>{t("Estimate")}</span>
          </h2>
          <p className="mt-0.5 max-w-[78ch] text-[12.5px] text-ink-3">{t("What you could realistically pay for this product, given your volumes, the alternatives and the price evidence on file. An estimate of the software: not a market price, not a quote, not a saving.")}</p>
        </div>
      </div>

      {n.status === "not_enough_data" ? (
        <div className="px-5 pb-4 sm:px-6">
          <div className="text-[17px] font-semibold tracking-[-0.01em]">{t("Not enough data")}</div>
          <p className="mt-1 max-w-[78ch] text-[13px] text-ink-2">{n.reason}</p>
          <p className="mt-1 text-[13px] font-medium">{n.current == null ? t("Add or import a purchase of this product.") : t("Get one comparable quote to estimate a negotiation range.")}</p>
          {n.current != null && (
            <p className="mt-2 text-[12.5px] text-ink-3">
              {t("Current price: {price}.", { price: price(n.current, unit) })}
            </p>
          )}
        </div>
      ) : (
        <dl className="grid gap-x-8 gap-y-4 px-5 pb-4 sm:px-6 @xl:grid-cols-2 @4xl:grid-cols-5">
          <Figure label={t("Current price")} note={t("From your invoices")}>
            <span className="num">{price(n.current!, unit)}</span>
          </Figure>
          <Figure label={t("Estimated achievable range")} note={n.status === "no_upside" ? t("No room below what you pay") : t("From the lowest end to the cautious end")}>
            <span className="num">{rangeOf(n.range!.low, n.range!.high, unit)}</span>
          </Figure>
          <Figure label={t("Suggested target")} note={n.status === "no_upside" ? t("Hold the price") : t("Realistic, not the lowest end")}>
            <span className="num text-ledger">{price(n.target!, unit)}</span>
          </Figure>
          <Figure
            label={t("Potential negotiation upside")}
            note={
              n.upside ? (
                <>
                  {n.upside.annual != null ? t("About {amount} a year · theoretical", { amount: f.moneyApprox(n.upside.annual) }) : t("Theoretical: no yearly volume on file")}
                  {volume && <span className="block">{n.upside.volumeStatus === "estimated" ? t("on {volume} a year, an estimate", { volume }) : t("on {volume} a year", { volume })}</span>}
                </>
              ) : (
                t("Not estimated")
              )
            }
          >
            {n.upside ? <span className="num">{`${price(n.upside.perUnit, unit)} · ${f.number(n.upside.pct, 1)}%`}</span> : <span className="text-ink-3">—</span>}
          </Figure>
          <Figure label={t("Confidence")} note={n.confidenceWhy}>
            <span className={CONFIDENCE_TONE[n.confidence!]}>{t(LEVEL_LABEL[n.confidence!])}</span>
          </Figure>
        </dl>
      )}

      {/* Who is at the table: the buyer's power in one word, and what it mostly rests on. */}
      <div className="border-t border-rule px-5 py-4 sm:px-6">
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
          <h3 className="text-[13px] font-semibold">{t("Buyer negotiation power")}</h3>
          <span className={cx("inline-flex h-[20px] items-center rounded-full px-2 text-[11.5px] font-semibold", STRENGTH_TONE[n.strength])}>{t(STRENGTH_LABEL[n.strength])}</span>
          <span className="text-[12.5px] text-ink-3">{t("Leverage at the table: it moves where the estimate falls, it is never a discount by itself.")}</span>
        </div>
        {n.drivers.length > 0 && (
          <>
            <div className="mt-2.5 text-[12px] text-ink-3">{t("Main drivers")}</div>
            <ul className="mt-1 grid gap-x-8 gap-y-1 text-[13px] text-ink-2 @3xl:grid-cols-2">
              {n.drivers.map((line) => (
                <li key={line} className="flex gap-2">
                  <span aria-hidden className="font-semibold text-down">
                    +
                  </span>
                  <span>{line}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      <Disclosure className="mx-5 mb-3 sm:mx-6" title={<span className="whitespace-nowrap">{t("View leverage analysis")}</span>} description={t("What you buy from this supplier in all, and what that weighs")}>
        <LeverageAnalysis n={n} t={t} />
      </Disclosure>

      <Disclosure className="mx-5 mb-5 sm:mx-6" title={<span className="whitespace-nowrap">{t("View analysis")}</span>} description={n.status === "not_enough_data" ? t("What is on file, what is missing and how to get an estimate") : t("Why this range, the evidence behind it and how to improve it")}>
        <div className="space-y-6">
          {n.how.length > 0 && (
            <div>
              <h3 className="text-[13px] font-semibold">{t("Why this range?")}</h3>
              <ul className="mt-1.5 list-disc space-y-1 pl-5 text-[13px] text-ink-2">
                {n.how.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="grid gap-x-8 gap-y-4 @3xl:grid-cols-2">
            <div>
              <h3 className="text-[13px] font-semibold">{t("Positive factors")}</h3>
              {n.positives.length ? (
                <ul className="mt-1.5 space-y-1 text-[13px] text-ink-2">
                  {n.positives.map((line) => (
                    <li key={line} className="flex gap-2">
                      <span aria-hidden className="font-semibold text-down">
                        +
                      </span>
                      <span>{line}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1.5 text-[13px] text-ink-3">{t("Nothing on file works in your favour yet.")}</p>
              )}
            </div>
            <div>
              <h3 className="text-[13px] font-semibold">{t("Constraints")}</h3>
              {n.limits.length ? (
                <ul className="mt-1.5 space-y-1 text-[13px] text-ink-2">
                  {n.limits.map((line) => (
                    <li key={line} className="flex gap-2">
                      <span aria-hidden className="font-semibold text-up">
                        −
                      </span>
                      <span>{line}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1.5 text-[13px] text-ink-3">{t("Nothing on file holds the negotiation back.")}</p>
              )}
            </div>
          </div>

          <div>
            <h3 className="text-[13px] font-semibold">
              {t("Buyer negotiation power")}{" "}
              <span className={cx("ml-1 inline-flex h-[20px] items-center rounded-full px-2 text-[11.5px] font-semibold", STRENGTH_TONE[n.strength])}>{t(STRENGTH_LABEL[n.strength])}</span>
            </h3>
            <p className="mt-1 text-[12.5px] text-ink-3">{t("Six readings of what is on file, weighed for this kind of product. They move where the range and the target fall; they are not a price.")}</p>
            <dl className="mt-2 grid gap-x-6 gap-y-1.5 text-[13px] @2xl:grid-cols-2 @4xl:grid-cols-3">
              {n.dimensions.map((d) => (
                <div key={d.key} className="flex items-baseline justify-between gap-3 border-b border-rule pb-1">
                  <dt className="text-ink-2">{t(DIMENSION_LABEL[d.key])}</dt>
                  <dd className="font-medium">{t(STRENGTH_LABEL[wordOf(d.score)])}</dd>
                </div>
              ))}
            </dl>
          </div>

          <div>
            <h3 className="text-[13px] font-semibold">{t("Evidence")}</h3>
            {n.anchors.length ? (
              <div className="mt-2 overflow-hidden rounded-lg border border-rule">
                <Table>
                  <thead>
                    <tr>
                      <Th>{t("Evidence")}</Th>
                      <Th align="right">{t("Price")}</Th>
                      <Th align="right" className="hidden @2xl:table-cell">
                        {t("Your price against this evidence")}
                      </Th>
                      <Th>{t("How it counts")}</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {n.anchors.map((a) => (
                      <tr key={a.key} className={a.role === "not_used" ? "text-ink-3" : undefined}>
                        <Td className="whitespace-normal!">
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            <PriceTypeTag type={PRICE_TYPE[a.kind]} />
                            <span className="font-medium">{a.label}</span>
                          </div>
                          <div className="mt-0.5 text-[12px] text-ink-3">
                            {[a.source, a.date ? f.date(a.date) : null, DATA_CLASS[a.dataClass].visibility === "account" ? t("private to your company") : t("public source")].filter(Boolean).join(" · ")}
                            {a.sourceUrl && (
                              <>
                                {" · "}
                                <a href={a.sourceUrl} target="_blank" rel="noreferrer" className="text-ledger hover:underline">
                                  {t("source")}
                                </a>
                              </>
                            )}
                          </div>
                        </Td>
                        <Td align="right" className="num">
                          {rangeOf(roundTo(a.low, n.step), roundTo(a.high, n.step), unit)}
                        </Td>
                        <Td align="right" className="num hidden @2xl:table-cell">
                          {a.gapPct == null ? "—" : Math.abs(a.gapPct) < 0.5 ? t("in line") : a.gapPct > 0 ? t("{pct}% above", { pct: Math.round(a.gapPct) }) : t("{pct}% below", { pct: Math.round(-a.gapPct) })}
                        </Td>
                        <Td className="whitespace-normal!">
                          <span className="font-medium">{t(ANCHOR_ROLE_LABEL[a.role])}</span>
                          <div className="text-[12px] text-ink-3">{a.how}</div>
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </div>
            ) : (
              <p className="mt-1.5 text-[13px] text-ink-3">{t("Only what you pay today: no quote, benchmark or published price is on file for this product.")}</p>
            )}
            {used.length > 0 && <p className="mt-1.5 text-[12px] text-ink-3">{t("A reference is counted for a part of its distance from your price, by how comparable it is and how strong your position is. A real offer on true cost counts in full.")}</p>}
            {n.warnings.map((w) => (
              <p key={w} className="mt-1.5 text-[12.5px] text-caution">
                {w}
              </p>
            ))}
          </div>

          {n.improve.length > 0 && (
            <div>
              <h3 className="text-[13px] font-semibold">{t("Missing information: to improve this estimate")}</h3>
              <ol className="mt-1.5 list-decimal space-y-1 pl-5 text-[13px] text-ink-2">
                {n.improve.map((x) => {
                  const href = improveHref(x.kind, n.productId);
                  return (
                    <li key={x.kind}>
                      {href ? (
                        <Link href={href} className="text-ledger hover:underline">
                          {x.label}
                        </Link>
                      ) : (
                        x.label
                      )}
                    </li>
                  );
                })}
              </ol>
            </div>
          )}

          <details className="group rounded-lg border border-rule">
            <summary className="cursor-pointer list-none px-4 py-2.5 text-[13px] font-semibold select-none hover:bg-well [&::-webkit-details-marker]:hidden">
              {t("Inputs used")} <span className="font-normal text-ink-3">{t("{confirmed} confirmed, {estimated} estimated, {missing} missing", counts)}</span>
            </summary>
            <div className="border-t border-rule">
              <Table>
                <tbody>
                  {FACTOR_GROUPS.flatMap((group) => [
                    <tr key={group}>
                      <td colSpan={3} className="h-8 border-b border-rule bg-wash/60 px-5 text-[12px] font-semibold tracking-[0.04em] text-ink-3 uppercase">
                        {t(FACTOR_GROUP_LABEL[group])}
                      </td>
                    </tr>,
                    ...n.inputs.filter((x) => x.group === group).map((x) => <InputRow key={`${group}:${x.key}`} x={x} />),
                  ])}
                </tbody>
              </Table>
            </div>
          </details>

          <div id="your-knowledge" className="scroll-mt-20">
            <h3 className="text-[13px] font-semibold">{t("What you know better than the software")}</h3>
            <p className="mt-0.5 mb-3 text-[12.5px] text-ink-3">{t("Correct a factor and say why: the estimate is worked out again with it, and what the software had estimated stays on file.")}</p>
            <JudgementForm productId={n.productId} judgements={n.judgements} />
          </div>

          {history.length > 0 && (
            <div>
              <h3 className="text-[13px] font-semibold">{t("How the estimate has changed")}</h3>
              <ul className="mt-1.5 divide-y divide-rule text-[13px]">
                {history.map((h) => (
                  <li key={h.id} className="flex flex-wrap items-baseline gap-x-4 gap-y-0.5 py-1.5">
                    <span className="num w-[84px] shrink-0 text-ink-3">{f.date(h.createdAt.slice(0, 10))}</span>
                    <span className="num font-medium">
                      {h.status === "not_enough_data" || h.low == null || h.high == null ? t("Not enough data") : rangeOf(h.low, h.high, h.snapshot.unit)}
                      {h.status === "range" && h.target != null && <span className="font-normal text-ink-3"> · {t("target {price}", { price: f.price(h.target) })}</span>}
                    </span>
                    {h.confidence && <span className="text-ink-2">{t("confidence {level}", { level: t(LEVEL_LABEL[h.confidence]).toLowerCase() })}</span>}
                    <span className="text-ink-3">{said(t, h.snapshot.change)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <p className="text-[12px] text-ink-3">{t("Built on your own invoices and quotes: private to your company. Only what a supplier publishes itself, or an aggregate benchmark, is ever a price that can be shown about a supplier to anyone else.")}</p>
        </div>
      </Disclosure>
    </section>
  );
}

/** One line for another page: the estimate in short, and where the analysis is. */
export function NegotiationLine({ n, t }: { n: ProductNegotiation; t: T }) {
  const href = `/products/${n.productId}#negotiation`;
  return (
    <p className="text-[13px] text-ink-2">
      <span className="font-medium text-ink">{t("Negotiation estimate")}:</span>{" "}
      {n.status === "range" && n.upside
        ? t("achievable range {range}, suggested target {target} ({confidence} confidence). Potential negotiation upside {upside}: theoretical, not a saving.", {
            range: rangeOf(n.range!.low, n.range!.high, n.unit),
            target: price(n.target!, n.unit),
            confidence: t(LEVEL_LABEL[n.confidence!]).toLowerCase(),
            upside: n.upside.annual != null ? t("about {amount} a year", { amount: f.moneyApprox(n.upside.annual) }) : `${price(n.upside.perUnit, n.unit)}`,
          })
        : n.status === "no_upside"
          ? t("no room below what you pay is estimated from the evidence on file.")
          : t("not enough data — get one comparable quote to estimate a negotiation range.")}{" "}
      <Link href={href} className="font-medium text-ledger hover:underline">
        {t("View analysis")}
      </Link>
    </p>
  );
}

/** One input with its status, where it comes from and how it was worked out. */
function InputRow({ x }: { x: FactorInput }) {
  return (
    <tr>
      <Td className="whitespace-normal! text-ink-2">{x.label}</Td>
      <Td className="whitespace-normal!">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <FieldStatusTag status={x.status} />
          <span className={x.value ? "font-medium" : "text-ink-4"}>{x.value ?? "—"}</span>
        </div>
      </Td>
      <Td className="hidden whitespace-normal! text-[12px] text-ink-3 @2xl:table-cell">
        {[x.source, x.sourceDate ? f.date(x.sourceDate) : null].filter(Boolean).join(" · ")}
        {x.method && <div>{x.method}</div>}
      </Td>
    </tr>
  );
}

const score = (n: number) => f.number(n, 1);

/**
 * The relationship with the supplier, read apart: everything bought from it,
 * what lies beyond this product, and what that weighs in the buyer's power.
 * Leverage to use at the table — never a discount worked out from it.
 */
function LeverageAnalysis({ n, t }: { n: ProductNegotiation; t: T }) {
  const rel = n.relationship;
  if (!rel) return <p className="text-[13px] text-ink-3">{t("No current supplier on file for this product: there is no relationship to read yet.")}</p>;
  const { effect } = rel;
  const before = wordOf(n.strengthScore - effect.power);
  return (
    <div className="space-y-6">
      <div>
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h3 className="text-[13px] font-semibold">{t("Supplier relationship leverage")}</h3>
          <span className="num text-[17px] font-semibold tracking-[-0.01em]">{t("{score} out of 10", { score: score(rel.score) })}</span>
          <span className={cx("inline-flex h-[20px] items-center rounded-full px-2 text-[11.5px] font-semibold", STRENGTH_TONE[rel.level])}>{t(LEVEL_LABEL[rel.level])}</span>
        </div>
        <p className="mt-1 text-[12.5px] text-ink-3">{t("A reading of the invoices by rule, not a measure: thresholds are starting assumptions. Buying more products from a supplier does not by itself mean a lower price.")}</p>
      </div>

      <div className="overflow-hidden rounded-lg border border-rule">
        <Table>
          <tbody>{n.inputs.filter((x) => x.group === "relationship").map((x) => <InputRow key={x.key} x={x} />)}</tbody>
        </Table>
      </div>

      <div>
        <h3 className="text-[13px] font-semibold">{t("How the score is made")}</h3>
        <div className="mt-2 overflow-hidden rounded-lg border border-rule">
          <Table>
            <tbody>
              {rel.parts.map((p) => (
                <tr key={p.key}>
                  <Td className="whitespace-normal! text-ink-2">{t(RELATIONSHIP_PART_LABEL[p.key])}</Td>
                  <Td className="whitespace-normal!">{p.key === "breadth" ? `${t(LEVEL_LABEL[rel.breadth])} · ${p.fact}` : p.key === "bundle" ? `${t(LEVEL_LABEL[rel.bundle])} · ${p.fact}` : p.fact}</Td>
                  <Td align="right" className="font-medium">{t("{score} out of 10", { score: score(p.score) })}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
        <p className="mt-1.5 text-[12px] text-ink-3">{t("Confidence of this reading: {level}.", { level: t(LEVEL_LABEL[rel.confidence]).toLowerCase() })} {rel.confidenceWhy}</p>
      </div>

      <div className="grid gap-x-8 gap-y-4 @3xl:grid-cols-2">
        <div>
          <h3 className="text-[13px] font-semibold">{t("Why")}</h3>
          <ul className="mt-1.5 space-y-1 text-[13px] text-ink-2">
            {rel.positives.length ? (
              rel.positives.map((line) => (
                <li key={line} className="flex gap-2">
                  <span aria-hidden className="font-semibold text-down">
                    +
                  </span>
                  <span>{line}</span>
                </li>
              ))
            ) : (
              <li className="text-ink-3">{t("Nothing in the relationship adds to this product's own volume.")}</li>
            )}
          </ul>
        </div>
        <div>
          <h3 className="text-[13px] font-semibold">{t("Limiting factors")}</h3>
          <ul className="mt-1.5 space-y-1 text-[13px] text-ink-2">
            {rel.limits.map((line) => (
              <li key={line} className="flex gap-2">
                <span aria-hidden className="font-semibold text-up">
                  −
                </span>
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div>
        <h3 className="text-[13px] font-semibold">{t("What it changes in your negotiation power")}</h3>
        <p className="mt-1 text-[13px] text-ink-2">
          {effect.power >= 0.05
            ? before === n.strength
              ? t("Against buying only this product from the supplier, the relationship lifts your leverage as a buyer from {from} to {to} out of 10. Your negotiation power stays {after}: it was there already on the product's own volume.", { from: score(effect.buyerAlone), to: score(effect.buyerWith), after: t(STRENGTH_LABEL[n.strength]).toLowerCase() })
              : t("Against buying only this product from the supplier, the relationship lifts your leverage as a buyer from {from} to {to} out of 10. Your negotiation power is {after}; without it, it would be {before}.", {
                  from: score(effect.buyerAlone),
                  to: score(effect.buyerWith),
                  after: t(STRENGTH_LABEL[n.strength]).toLowerCase(),
                  before: t(STRENGTH_LABEL[before]).toLowerCase(),
                })
            : t("This product is all, or nearly all, of what you buy from the supplier: the relationship adds nothing to its own volume. Your leverage as a buyer is {to} out of 10.", { to: score(effect.buyerWith) })}
        </p>
        <p className="mt-1 text-[12px] text-ink-3">{t("The spend on this product is counted once, as its volume. The relationship adds only what lies beyond it: the spend on the other products, how many they are, how regular the orders.")}</p>
      </div>
    </div>
  );
}
