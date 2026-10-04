/**
 * What a research comes to, in five to seven plain lines: what is paid, who
 * else might supply it and how sure that is, what outside evidence says and
 * how far it can be trusted, whether that amounts to anything, and the next
 * step. Each line states what is on file; "nothing reliable was found" is a
 * conclusion like any other.
 *
 * The lines are stored messages (say()): kept with the run, read back in the
 * reader's language. Their values are names, prices and counts — never a
 * sentence in one language.
 */
import * as f from "../format";
import { say, type Msg, type Said } from "../i18n";
import { perUnit, rangeText, type MarketView } from "../sourcing/market";

type NextKind = MarketView["next"]["kind"];

const NEXT: Record<NextKind, Msg> = {
  add_purchases: "Next step: add or import purchases for this product.",
  decide: "Next step: decide with the validated quote in hand.",
  validate: "Next step: ask for comparable quotes and check the specifications, to confirm the gap.",
  firm_up: "Next step: get a second comparable quote, to make the range reliable.",
  keep_updated: "Next step: nothing to chase — keep the quotes up to date.",
  record_quotes: "Next step: record the quotes as they arrive.",
  request_quotes: "The next useful step is a targeted request for quotation to the recommended suppliers, not a wider search.",
  find_suppliers: "Next step: find alternative suppliers and ask them for a quote.",
};

export function researchSummary(view: MarketView): Said[] {
  const out: Said[] = [];
  const unit = view.unit;
  const current = view.currentPrice;

  // 1. What is paid.
  if (current != null && view.currentSupplier) out.push(say("You buy {product} from {supplier} at {price}: {spend} in the last 12 months.", { product: view.name, supplier: view.currentSupplier.name, price: perUnit(current, unit), spend: f.moneyApprox(view.history.annualSpend) }));
  else out.push(say("There is no purchase price on record for {product} yet.", { product: view.name }));

  // 2. Who else might supply it: how many were found, how many are worth a request.
  const funnel = view.screening;
  const { found, plausible, recommended, quotes } = funnel.counts;
  if (!found) out.push(say("No alternative supplier has been identified yet."));
  else {
    out.push(
      recommended
        ? say("Potential companies found: {n}. After screening what is on file, {k} appear relevant and {r} are recommended for a request for quotation.", { n: found, k: plausible, r: recommended })
        : say("Potential companies found: {n}. After screening what is on file, none is solid enough to be worth a request yet.", { n: found }),
    );
    const checked = funnel.shortlist.map((x) => x.candidate).filter((c) => c.specCheck);
    const specs = [...new Set(checked.flatMap((c) => [...c.specCheck!.confirmed, ...c.specCheck!.missing]))];
    const confirming = checked.filter((c) => c.specCheck!.confirmed.length > 0 && c.specCheck!.missing.length === 0).length;
    if (specs.length && confirming) out.push(say("Of the recommended ones, {k} state the exact specification ({spec}) on their site.", { k: confirming, spec: specs.join(", ") }));
    else if (specs.length) out.push(say("None of the recommended ones publicly confirms the exact specification ({spec}): it has to be asked.", { spec: specs.join(", ") }));
  }

  // 3. What outside evidence says.
  const range = view.range;
  const trade = view.observations.find((o) => o.type === "trade_benchmark" && o.low != null && o.recent);
  if (range && current != null && range.reliable) {
    const text = rangeText(range.low, range.high, unit);
    if (view.position === "below") out.push(say("Comparable evidence on file is at {range}: your price is below it.", { range: text }));
    else if (view.position === "in_line") out.push(say("Comparable evidence on file is at {range}: your price is in line with it.", { range: text }));
    else out.push(say("Comparable evidence on file is at {range}: your price is {low}% to {high}% above it.", { range: text, low: Math.round(view.gapPct!.low), high: Math.round(view.gapPct!.high) }));
  } else if (range && current != null && !range.indirect) {
    const first = view.observations.find((o) => o.used)!;
    const params = { source: first.sourceName ?? first.label, range: rangeText(range.low, range.high, unit), pct: Math.round(Math.abs(view.gapPct!.high)) };
    out.push(
      view.gapPct!.high > 0.5
        ? say("One external reference ({source}) indicates {range}: your price is about {pct}% above it, but it does not confirm the same specification and delivery terms.", params)
        : say("One external reference ({source}) indicates {range}: your price is not above it.", params),
    );
  } else if (!trade) out.push(say("No reliable benchmark was found: there is no public price for this product on file."));
  if (trade && !(range?.reliable ?? false)) out.push(say("Trade statistics ({source}) put imports at {range} on average: everything under the customs code, valued at the border — an indication, not a price for this product.", { source: trade.sourceName ?? trade.label, range: rangeText(trade.low!, trade.high!, unit) }));

  // 4. Whether it amounts to anything.
  if (view.opportunity && view.opportunity.high > 0) {
    out.push(
      view.opportunity.low > 0 && f.moneyApprox(view.opportunity.low) !== f.moneyApprox(view.opportunity.high)
        ? say("At your annual volume the theoretical gap is {low}–{high} a year: it becomes a saving only if comparable quotes confirm it.", { low: f.moneyApprox(view.opportunity.low), high: f.moneyApprox(view.opportunity.high) })
        : say("At your annual volume the theoretical gap is up to {high} a year: it becomes a saving only if comparable quotes confirm it.", { high: f.moneyApprox(view.opportunity.high) }),
    );
  } else if ((range && !range.reliable) || trade) out.push(say("This is not enough to claim a saving."));
  else if (found && !quotes && !view.observations.some((o) => o.type === "quote")) out.push(say("No supplier has provided a comparable price yet."));

  // 5. What to do.
  out.push(say(view.next.kind === "find_suppliers" && found ? "Next step: look for better candidates — none on file is worth a request yet." : NEXT[view.next.kind]));
  return out;
}
