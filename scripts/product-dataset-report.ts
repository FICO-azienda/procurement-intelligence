/**
 * npx tsx scripts/product-dataset-report.ts [n]
 *
 * The procurement product data of the n largest priority products (default 5),
 * as the app sees it: spend, fields filled in automatically, confirmed,
 * estimated, missing, readiness and the next data action. Reads the database
 * only. With the local database, stop `npm run dev` first.
 */
import { getDb } from "../src/db";
import { FIELDS, FIELD_KEYS } from "../src/lib/dataset/fields";
import { readDataset, readLearning, readOpportunityStates } from "../src/lib/data";
import { analyze } from "../src/lib/intel/engine";
import { catalogueOf } from "../src/lib/catalog/spend";
import { todayISO } from "../src/lib/analytics";
import { priorityProducts, readProfiles } from "../src/server/product-data";

async function main() {
  const n = Number(process.argv[2] ?? 5);
  const db = await getDb();
  const [data, learning, states] = await Promise.all([readDataset(db), readLearning(db), readOpportunityStates(db)]);
  const intel = analyze(catalogueOf(data), learning.supplierProducts, states, todayISO());
  const priority = priorityProducts(intel);
  const total = intel.products.reduce((s, p) => s + p.metrics.annualSpend, 0);
  const top = priority.slice(0, n);
  const profiles = await readProfiles(db, top.map((p) => p.product.id));
  console.log(`Priority products: ${priority.length} (${Math.round((priority.reduce((s, p) => s + p.metrics.annualSpend, 0) / total) * 100)}% of product spend). Top ${top.length}:\n`);
  for (const [i, p] of top.entries()) {
    const pr = profiles.get(p.product.id)!;
    const list = (status: string) => FIELD_KEYS.filter((k) => pr.fields[k].status === status).map((k) => `${FIELDS[k].label}${pr.fields[k].display ? ` = ${pr.fields[k].display}` : ""}`);
    console.log(`#${i + 1} ${p.product.name} — spend ${Math.round(p.metrics.annualSpend)} EUR (${((p.metrics.annualSpend / total) * 100).toFixed(1)}%)`);
    console.log(`  Readiness: ${Object.entries(pr.readiness).map(([d, r]) => `${d}=${r.level}`).join(", ")}`);
    console.log(`  Confirmed (${pr.counts.confirmed}):\n    - ${list("confirmed").join("\n    - ")}`);
    console.log(`  Estimated (${pr.counts.estimated}):\n    - ${FIELD_KEYS.filter((k) => pr.fields[k].status === "estimated").map((k) => `${FIELDS[k].label} = ${pr.fields[k].display} [${pr.fields[k].method ?? ""}]`).join("\n    - ")}`);
    console.log(`  Missing (${pr.counts.missing}): ${FIELD_KEYS.filter((k) => pr.fields[k].status === "missing").map((k) => FIELDS[k].label + (FIELDS[k].important ? "*" : "")).join(", ")}`);
    console.log(`  Sourcing missing: ${pr.readiness.sourcing.missing.join(", ") || "-"} ${pr.readiness.sourcing.other.join(" ")}`);
    console.log(`  True cost missing: ${pr.readiness.true_cost.missing.join(", ") || "-"}`);
    console.log(`  Next: ${pr.next.label}\n`);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
