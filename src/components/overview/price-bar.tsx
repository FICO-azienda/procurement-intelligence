import * as f from "@/lib/format";
import type { DecisionAlternative } from "@/lib/intel/decision";

/**
 * Where the price you pay sits against the quotes on file. A reading aid, not
 * a chart: one band (the range of quotes), one marker above (you), one below
 * (the alternative the saving refers to, or the lowest quote).
 */
/** Half-width of the scale, as a share of the price in the middle. */
const MIN_HALF_SPAN = 0.12;

export function PriceBar({ current, low, high, best, unit }: { current: number; low: number; high: number; best: DecisionAlternative | null; unit: string }) {
  const alt = best?.priceEUR ?? low;
  const lo = Math.min(current, low);
  const hi = Math.max(current, high);
  // The scale never zooms in so far that a 2% gap looks like a chasm.
  const mid = (lo + hi) / 2;
  const half = Math.max(((hi - lo) / 2) * 1.25, mid * MIN_HALF_SPAN) || 1;
  const [min, max] = [mid - half, mid + half];
  const at = (v: number) => ((v - min) / (max - min)) * 100;
  // Keep labels inside the bar: anchor them to the side they are closest to.
  const anchor = (p: number) => (p < 22 ? "translateX(0)" : p > 78 ? "translateX(-100%)" : "translateX(-50%)");
  const [you, other, from, to] = [at(current), at(alt), at(low), at(high)];
  const altLabel = best ? best.supplierName : "Lowest quote";

  return (
    <div
      role="img"
      aria-label={`You pay ${f.priceShort(current)} per ${unit}. Quotes on file from ${f.priceShort(low)} to ${f.priceShort(high)}.`}
      className="relative mt-8 mb-7 h-1.5 rounded-full bg-wash"
    >
      <div className="absolute inset-y-0 min-w-1.5 rounded-full bg-ink/20" style={{ left: `${from}%`, width: `${Math.max(0, to - from)}%` }} />
      <div className="absolute -top-1 h-3.5 w-0.5 -translate-x-1/2 rounded-full bg-ink" style={{ left: `${you}%` }} />
      <div className="num absolute -top-[22px] text-[11.5px] font-semibold whitespace-nowrap" style={{ left: `${you}%`, transform: anchor(you) }}>
        You pay {f.priceShort(current)}
      </div>
      <div className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-canvas bg-ledger" style={{ left: `${other}%` }} />
      <div className="num absolute top-[11px] max-w-full truncate text-[11.5px] whitespace-nowrap text-ink-3" style={{ left: `${other}%`, transform: anchor(other) }}>
        {altLabel} {f.priceShort(alt)}
      </div>
    </div>
  );
}
