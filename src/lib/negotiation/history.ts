/**
 * The history of an estimate: each time what the software answers changes —
 * a quote arrives, a benchmark is added, the user corrects a factor — the new
 * answer is kept next to the old ones, so one can see the estimate firm up as
 * evidence comes in. The estimate itself is always worked out fresh; what is
 * stored is only what was said then.
 *
 * A stored estimate rests on the buyer's own prices: it is private to the
 * account that owns them (`data-class.ts`).
 */
import * as f from "../format";
import { say, type Said } from "../i18n";
import type { Confidence } from "../sourcing/types";
import type { AnchorKind, DimensionKey } from "./config";
import { publicOnly, type PriceDataClass } from "./data-class";
import type { AnchorRole, InputStatus, JudgementKey, Level, Negotiation, NegotiationStatus, Strength } from "./engine";

export interface EstimateSnapshot {
  unit: string;
  step: number;
  upside: { perUnit: number; pct: number; annual: number | null; volume: number | null; volumeStatus: InputStatus } | null;
  scores: Record<DimensionKey, number>;
  /** The supplier relationship leverage as it was read then. Absent on estimates kept before it existed. */
  relationship?: { score: number; breadth: Level; bundle: Level } | null;
  /** The evidence the estimate used, each with what kind of price it is. */
  anchors: { key: string; kind: AnchorKind; dataClass: PriceDataClass; label: string; value: number; role: AnchorRole }[];
  /** The factors a person corrected. */
  judgements: Partial<Record<JudgementKey, Level>>;
  /** What changed since the estimate before, in a stored message. */
  change: Said;
}

export interface EstimateRecord {
  status: NegotiationStatus;
  current: number | null;
  low: number | null;
  high: number | null;
  target: number | null;
  confidence: Confidence | null;
  strength: Strength;
  /** What the user would see: two estimates with the same signature are the same estimate. */
  signature: string;
  snapshot: EstimateSnapshot;
}

const used = (n: Negotiation) => n.anchors.filter((a) => a.role !== "not_used");
const corrected = (n: Negotiation) => Object.fromEntries(Object.values(n.judgements).filter((j) => j.user).map((j) => [j.key, j.user!.level])) as Partial<Record<JudgementKey, Level>>;

/** The visible answer, as one string: a new record is kept only when this changes. */
export function signatureOf(n: Negotiation): string {
  return JSON.stringify([n.status, n.current, n.range?.low ?? null, n.range?.high ?? null, n.target, n.confidence, n.strength, used(n).map((a) => `${a.key}:${a.role}`).sort(), Object.entries(corrected(n)).sort()]);
}

/** Why this estimate differs from the one before, by what entered or left it. */
function changeSince(n: Negotiation, previous: EstimateRecord | null): Said {
  if (!previous) return say("First estimate.");
  const before = new Map(previous.snapshot.anchors.map((a) => [a.key, a]));
  const now = used(n);
  const added = now.filter((a) => !before.has(a.key));
  const quotes = added.filter((a) => a.kind === "quote");
  if (quotes.length === 1) return say("After the quote of {supplier}.", { supplier: quotes[0].label });
  if (quotes.length > 1) return say("After {n} new quotes.", { n: quotes.length });
  const bought = added.find((a) => a.kind === "other_supplier");
  if (bought) return say("After a purchase from {supplier}.", { supplier: bought.label });
  // Names of sources are kept as they are; a label the software words itself is not stored in one language.
  const named = added.filter((a) => a.kind !== "own_history");
  if (named.length) return say("After new evidence: {label}.", { label: named.map((a) => a.label).join(", ") });
  if (added.length) return say("After a lower price found in your own invoices.");
  if (n.current != null && previous.current != null && n.current !== previous.current) return say("After a new price paid: {price}.", { price: `${f.price(n.current)}/${n.unit}` });
  if (JSON.stringify(Object.entries(corrected(n)).sort()) !== JSON.stringify(Object.entries(previous.snapshot.judgements).sort())) return say("After your correction of a factor.");
  if (previous.snapshot.anchors.some((a) => !now.some((x) => x.key === a.key))) return say("Evidence no longer counted.");
  return say("Recalculated on the data on file.");
}

/** What is kept of an estimate. */
export function estimateRecord(n: Negotiation, previous: EstimateRecord | null): EstimateRecord {
  return {
    status: n.status,
    current: n.current,
    low: n.range?.low ?? null,
    high: n.range?.high ?? null,
    target: n.target,
    confidence: n.confidence,
    strength: n.strength,
    signature: signatureOf(n),
    snapshot: {
      unit: n.unit,
      step: n.step,
      upside: n.upside,
      scores: Object.fromEntries(n.dimensions.map((d) => [d.key, Math.round(d.score * 10) / 10])) as Record<DimensionKey, number>,
      relationship: n.relationship ? { score: Math.round(n.relationship.score * 10) / 10, breadth: n.relationship.breadth, bundle: n.relationship.bundle } : null,
      anchors: used(n).map((a) => ({ key: a.key, kind: a.kind, dataClass: a.dataClass, label: a.label, value: a.value, role: a.role })),
      judgements: corrected(n),
      change: changeSince(n, previous),
    },
  };
}

/**
 * What of a stored estimate could ever be shown outside the account that
 * owns it: no price paid, no offer received, no range and no target — they
 * all rest on private prices. Only the evidence that was public to begin
 * with: what a supplier publishes, and aggregate references.
 */
export function publicView(record: EstimateRecord): { anchors: EstimateSnapshot["anchors"] } {
  return { anchors: publicOnly(record.snapshot.anchors) };
}
